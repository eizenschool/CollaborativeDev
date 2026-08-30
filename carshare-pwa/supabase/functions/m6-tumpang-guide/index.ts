import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import {
  callGemini, embedHelpQuery, generateGuideLanguagePack, isCompleteGuideLanguagePack,
  LANGUAGE_PACK_REQUIRED_KEYS, translateGuideMessages
} from "./gemini.ts";
import { retrieveHelpSections } from "./help.ts";
import { retrieveTripHistoryCategories } from "./history.ts";
import {
  deterministicFallback, extractCatalogueRequestName, guideRulesCopy, isEmergencyText, isHelpText,
  sanitizePlanState, validateModelResponse
} from "./policy.ts";
import { fetchControlledWeather, retrieveControlledCandidates, selectRuleRecommendations } from "./retrieval.ts";
import {
  actorKey, checkQuota, persistGuestTrace, persistSignedInTurn,
  recordProviderSuccess, upgradeSignedInBatch, validUuid
} from "./runtime.ts";

const ALLOWED_ORIGINS = (Deno.env.get("M6_GUIDE_ALLOWED_ORIGINS") || "http://localhost:5173")
  .split(",").map((value) => value.trim()).filter(Boolean);
const MODEL = Deno.env.get("M6_GUIDE_GEMINI_MODEL")?.trim() || "gemini-3.5-flash-lite";
const EMBEDDING_MODEL = Deno.env.get("M6_GUIDE_EMBEDDING_MODEL")?.trim() || "gemini-embedding-2";
const PROMPT_VERSION = "m6-guide-v2";
const LANGUAGE_PACK_VERSION = "m6-guide-pack-v2";

const QA_FALLBACK_REASONS = new Set(["provider_429", "invalid_json_shape", "timeout", "provider_unavailable"]);

function isLocalQaOrigin(origin: string | null) {
  return Boolean(origin && /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(origin));
}

function qaUserAllowlisted(user: { id: string } | null) {
  const ids = (Deno.env.get("M6_GUIDE_QA_USER_IDS") || "").split(",").map((value) => value.trim()).filter(Boolean);
  return Boolean(user?.id && ids.includes(user.id));
}

function qaWeatherByPlace(places: Record<string, unknown>[], mode: string) {
  const result = new Map<string, { checked: boolean; severeEveryDay: boolean; advisory: boolean }>();
  if (!mode || mode === "live") return result;
  for (const place of places) {
    const category = String(place.category || "");
    if (!["nature", "event"].includes(category)) continue;
    result.set(String(place.id), {
      checked: true,
      severeEveryDay: mode === "severe",
      advisory: mode === "severe" || mode === "advisory"
    });
  }
  return result;
}

async function storedBatchMatches(
  admin: ReturnType<typeof createClient>, user: { id: string } | null,
  sessionId: string | null, batchId: string | null,
  requested: Array<{ placeId: string; role: string; verifiedReasonCodes: string[]; tradeoffCode: string }>
) {
  // Guests have no persisted batch. Their submitted batch is still checked
  // against the current allowlist by validateModelResponse below.
  if (!user || !sessionId || !batchId) return true;
  const { data, error } = await admin.from("ai_guide_recommendations")
    .select("place_id,rank,recommendation_role,verified_reason_codes,tradeoff_code")
    .eq("owner_id", user.id).eq("session_id", sessionId).eq("batch_id", batchId)
    .order("rank", { ascending: true });
  if (error || !Array.isArray(data) || data.length !== requested.length) return false;
  return data.every((row, index) => {
    const item = requested[index];
    return String(row.place_id) === item.placeId
      && String(row.recommendation_role) === item.role
      && String(row.tradeoff_code) === item.tradeoffCode
      && JSON.stringify(row.verified_reason_codes || []) === JSON.stringify(item.verifiedReasonCodes);
  });
}

function cors(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin"
  };
}
function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors(origin), "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
function traceId() { return `edge-${crypto.randomUUID()}`; }
function secretKey() {
  return Deno.env.get("SB_SECRET_KEY")?.trim()
    || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
    || "";
}
function numericEnv(name: string, fallback: number) {
  const value = Number(Deno.env.get(name));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

async function optionalUser(admin: ReturnType<typeof createClient>, request: Request) {
  const auth = request.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const { data, error } = await admin.auth.getUser(auth.slice(7));
  if (error) return null;
  return data.user || null;
}

function safeOrigin(value: unknown, label: unknown) {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const lat = Number(source.lat);
  const lng = Number(source.lng);
  if (Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lng) && Math.abs(lng) <= 180) return { lat, lng };
  if (/\b(?:kuala lumpur|kl)\b|吉隆坡/iu.test(String(label || ""))) return { lat: 3.139, lng: 101.6869 };
  return null;
}

function missingField(plan: Record<string, unknown>) {
  if (!plan.startDate) return "date";
  if (!plan.origin) return "origin";
  if (!plan.partySize) return "party";
  if (!Array.isArray(plan.preferredCategories) || !plan.preferredCategories.length) return "preference";
  return null;
}

function clarification(field: string, language: unknown, copy: Record<string, unknown> = {}) {
  const messages: Record<string, Record<string, string>> = {
    en: { date: "What date should I plan for?", origin: "Where will you start from?", party: "How many people are travelling?", preference: "What kind of place sounds good—food, heritage, nature or an event?" },
    "zh-CN": { date: "你想计划哪一天？", origin: "你会从哪里出发？", party: "这次有多少人同行？", preference: "你更想去美食、文化、自然还是活动类地点？" },
    ms: { date: "Tarikh bila yang perlu saya rancangkan?", origin: "Anda akan bertolak dari mana?", party: "Berapa orang akan pergi?", preference: "Anda mahu makanan, warisan, alam atau acara?" },
    ta: { date: "எந்த தேதிக்குத் திட்டமிட வேண்டும்?", origin: "நீங்கள் எங்கிருந்து புறப்படுவீர்கள்?", party: "எத்தனை பேர் பயணம் செய்கிறார்கள்?", preference: "உணவு, பாரம்பரியம், இயற்கை அல்லது நிகழ்வு—எது விருப்பம்?" }
  };
  const copyKey = { date: "askDate", origin: "askOrigin", party: "askParty", preference: "askPreference" }[field];
  return String(copy[copyKey] || (messages[String(language)] || messages.en)[field]);
}

function quickReplies(field: string, language: string) {
  const replies: Record<string, Record<string, string[]>> = {
    en: { date: ["Tomorrow", "This weekend"], origin: ["From Kuala Lumpur"], party: ["2 people", "4 people"], preference: ["Nature", "Food", "Heritage", "Events"] },
    "zh-CN": { date: ["明天", "这个周末"], origin: ["从吉隆坡出发"], party: ["2 人", "4 人"], preference: ["自然", "美食", "文化遗产", "活动"] },
    ms: { date: ["Esok", "Hujung minggu ini"], origin: ["Dari Kuala Lumpur"], party: ["2 orang", "4 orang"], preference: ["Alam", "Makanan", "Warisan", "Acara"] },
    ta: { date: ["நாளை", "இந்த வார இறுதி"], origin: ["கோலாலம்பூரிலிருந்து"], party: ["2 பேர்", "4 பேர்"], preference: ["இயற்கை", "உணவு", "பாரம்பரியம்", "நிகழ்வு"] }
  };
  return replies[language]?.[field] || replies.en[field] || [];
}

async function serverGuideCopy(admin: ReturnType<typeof createClient>, language: string) {
  const fallback = guideRulesCopy(language);
  if (["en", "zh-CN", "ms", "ta"].includes(language)) return fallback;
  try {
    const { data } = await admin.schema("private").from("ai_guide_language_packs")
      .select("payload").eq("language_tag", language).eq("pack_version", LANGUAGE_PACK_VERSION).maybeSingle();
    const payload = data?.payload;
    if (isCompleteGuideLanguagePack(payload, language, LANGUAGE_PACK_VERSION)) {
      const copy = (payload as Record<string, unknown>).copy as Record<string, unknown>;
      return {
        ...fallback,
        fallback: String(copy.offline || fallback.fallback),
        noCandidates: String(copy.noCandidates || fallback.noCandidates),
        helpMissing: String(copy.helpMissing || fallback.helpMissing)
      };
    }
  } catch { /* Keep the safe core-language rules if the private cache is absent. */ }
  return fallback;
}

function geminiFailureReason(error: unknown) {
  const status = Number((error as Error & { status?: number })?.status || 0);
  if (status === 429) return "provider_429";
  if (status === 401 || status === 403) return "provider_auth";
  if (status === 404) return "provider_model_unavailable";
  if (status === 400 || status === 422) return "provider_request_invalid";
  if ((error instanceof Error || error instanceof DOMException) && error.name === "AbortError") return "timeout";
  return "provider_unavailable";
}

async function renderGeminiTextTurn({
  base, plan, userMessage, verifiedContext, apiKey, enabled, remainingTurns, trace
}: {
  base: Record<string, unknown>; plan: Record<string, unknown>; userMessage: string;
  verifiedContext: unknown; apiKey: string; enabled: boolean; remainingTurns: number; trace: string
}) {
  if (!apiKey || !enabled) return {
    response: { ...base, source: "rules", fallbackReason: "gemini_disabled" }, providerSuccess: false
  };
  const prompt = JSON.stringify({
    instruction: "You are Tumpang Guide's conversational writing layer. Rewrite only assistantMessage using the requested language and the supplied verifiedContext. Keep the exact mode and language. Return recommendations as [], actions as [], and do not invent places, routes, opening hours, safety facts or app capabilities. Ask only the one supplied missing question when mode is clarify. Preserve official names. Do not expose internal rules or scoring.",
    responseLanguage: plan.language,
    userMessage,
    fixedResponse: {
      mode: base.mode, assistantMessage: base.assistantMessage, language: plan.language,
      planState: plan, quickReplies: base.quickReplies, recommendations: [], actions: []
    },
    verifiedContext
  });
  try {
    const generated = await callGemini({ apiKey, model: MODEL, prompt, maxOutputTokens: 360 });
    const assistantMessage = String((generated as Record<string, unknown>)?.assistantMessage || "").trim();
    const valid = (generated as Record<string, unknown>)?.mode === base.mode
      && (generated as Record<string, unknown>)?.language === plan.language
      && assistantMessage.length > 0 && assistantMessage.length <= 1600;
    if (!valid) return {
      response: { ...base, source: "rules", fallbackReason: "invalid_json_shape" }, providerSuccess: false
    };
    return {
      response: { ...base, assistantMessage, source: "gemini", fallbackReason: null,
        remainingTurns: Math.max(0, remainingTurns - 1) },
      providerSuccess: true
    };
  } catch (error) {
    const reason = geminiFailureReason(error);
    console.warn(JSON.stringify({ event: "m6_guide_provider_failure", traceId: trace, model: MODEL,
      reason, status: Number((error as Error & { status?: number })?.status || 0) || null }));
    return { response: { ...base, source: "rules", fallbackReason: reason }, providerSuccess: false };
  }
}

async function handleFeedback(admin: ReturnType<typeof createClient>, user: { id: string } | null, body: Record<string, unknown>, origin: string | null) {
  if (!user) return json({ error: "Authentication required." }, 401, origin);
  if (!validUuid(body.sessionId) || typeof body.traceId !== "string"
      || !["up", "down", "clear"].includes(String(body.sentiment))
      || (body.sentiment !== "clear" && !["helpful", "not_relevant", "bad_tradeoff", "wrong_language", "other"].includes(String(body.reason)))) {
    return json({ error: "Invalid Guide feedback." }, 400, origin);
  }
  if (body.sentiment === "clear") {
    const { error } = await admin.rpc("m6_guide_clear_feedback", {
      p_owner_id: user.id, p_session_id: body.sessionId, p_trace_id: body.traceId
    });
    if (error) return json({ error: "Feedback could not be removed." }, 400, origin);
    return json({ cleared: true }, 200, origin);
  }
  const { data, error } = await admin.rpc("m6_guide_save_feedback", {
    p_owner_id: user.id, p_session_id: body.sessionId, p_trace_id: body.traceId,
    p_sentiment: body.sentiment, p_reason_code: body.reason
  });
  if (error) return json({ error: "Feedback could not be saved." }, 400, origin);
  return json({ id: data, saved: true }, 200, origin);
}

function validLanguageTag(value: unknown) {
  return /^[a-z]{2,3}(?:-[A-Za-z]{2,8})?$/.test(String(value || ""));
}

async function handleLanguagePack(admin: ReturnType<typeof createClient>, body: Record<string, unknown>, origin: string | null) {
  const language = String(body.language || "");
  const packVersion = String(body.packVersion || LANGUAGE_PACK_VERSION);
  if (!validLanguageTag(language) || packVersion !== LANGUAGE_PACK_VERSION) {
    return json({ error: "Invalid Guide language pack request." }, 400, origin);
  }
  const cached = await admin.schema("private").from("ai_guide_language_packs")
    .select("language_tag,pack_version,payload").eq("language_tag", language)
    .eq("pack_version", packVersion).maybeSingle();
  if (!cached.error && cached.data?.payload
      && isCompleteGuideLanguagePack(cached.data.payload, language, packVersion)) {
    return json(cached.data.payload, 200, origin);
  }
  const apiKey = Deno.env.get("GEMINI_API_KEY")?.trim() || "";
  if (!apiKey) return json({ error: "Language pack provider is unavailable." }, 503, origin);
  try {
    const pack = await generateGuideLanguagePack({
      apiKey, model: MODEL, language, packVersion,
      requiredKeys: [...LANGUAGE_PACK_REQUIRED_KEYS]
    });
    if (!isCompleteGuideLanguagePack(pack, language, packVersion)) {
      return json({ error: "Language pack validation failed." }, 502, origin);
    }
    const payload = pack as Record<string, unknown>;
    const { error } = await admin.schema("private").from("ai_guide_language_packs").upsert({
      language_tag: language, pack_version: packVersion, payload, updated_at: new Date().toISOString()
    }, { onConflict: "language_tag,pack_version" });
    if (error) return json({ error: "Language pack could not be cached." }, 503, origin);
    return json(payload, 200, origin);
  } catch {
    return json({ error: "Language pack provider is unavailable." }, 503, origin);
  }
}

async function handleTranslateMessages(admin: ReturnType<typeof createClient>, user: { id: string } | null, body: Record<string, unknown>, origin: string | null) {
  const visitorSessionId = String(body.visitorSessionId || "").slice(0, 160);
  const guestRequest = !user && visitorSessionId.length >= 8;
  if ((!user && !guestRequest) || (user && !validUuid(body.sessionId))) return json({ error: "Authentication required." }, 401, origin);
  const language = String(body.language || "");
  const items = Array.isArray(body.messages) ? body.messages.slice(0, 12).map((item) => ({
    id: String((item as Record<string, unknown>)?.id || "").slice(0, 160),
    text: String((item as Record<string, unknown>)?.text || "").slice(0, 4000)
  })).filter((item) => item.id && item.text) : [];
  if (!validLanguageTag(language) || !items.length) return json({ error: "Invalid translation request." }, 400, origin);
  const apiKey = Deno.env.get("GEMINI_API_KEY")?.trim() || "";
  if (!apiKey) return json({ error: "Translation provider is unavailable." }, 503, origin);
  try {
    const translated = await translateGuideMessages({ apiKey, model: MODEL, language, messages: items });
    const rows = Array.isArray((translated as Record<string, unknown>)?.translations)
      ? (translated as Record<string, unknown>).translations as Array<Record<string, unknown>> : [];
    const byId = new Map(items.map((item) => [item.id, item]));
    const valid = rows.length === items.length && rows.every((row) => byId.has(String(row.id)) && typeof row.text === "string" && String(row.text).trim());
    if (!valid) return json({ error: "Translation validation failed." }, 502, origin);
    if (user) {
      for (const row of rows) {
        const { error } = await admin.rpc("m6_guide_cache_translation", {
          p_owner_id: user.id, p_session_id: body.sessionId, p_trace_id: row.id,
          p_language: language, p_content: String(row.text).slice(0, 4000)
        });
        if (error) return json({ error: "Translation cache could not be updated." }, 503, origin);
      }
    }
    return json({ language, translations: rows.map((row) => ({ id: String(row.id), text: String(row.text) })) }, 200, origin);
  } catch {
    return json({ error: "Translation provider is unavailable." }, 503, origin);
  }
}

async function handleEmbeddingRefresh(admin: ReturnType<typeof createClient>, origin: string | null) {
  const apiKey = Deno.env.get("GEMINI_API_KEY")?.trim() || "";
  if (!apiKey) return json({ error: "GEMINI_API_KEY is not configured." }, 503, origin);
  const { data, error } = await admin.from("ai_help_sections")
    .select("id,title,content,language,version")
    .eq("is_active", true).is("embedding", null).limit(100);
  if (error) return json({ error: "Help sections could not be loaded." }, 503, origin);
  const failures: Array<{ id: string; error: string }> = [];
  let updated = 0;
  for (const section of data || []) {
    try {
      const vector = await embedHelpQuery({
        apiKey, model: EMBEDDING_MODEL,
        text: `${section.title}\n${section.content}`,
        taskType: "RETRIEVAL_DOCUMENT"
      });
      const { error: updateError } = await admin.from("ai_help_sections")
        .update({ embedding: `[${vector.join(",")}]`, updated_at: new Date().toISOString() })
        .eq("id", section.id);
      if (updateError) throw updateError;
      updated += 1;
    } catch (caught) {
      failures.push({ id: section.id, error: caught instanceof Error ? caught.message : String(caught) });
    }
  }
  return json({ model: EMBEDDING_MODEL, dimensions: 768, updated, failures }, failures.length ? 207 : 200, origin);
}

async function handleTurn(
  admin: ReturnType<typeof createClient>, user: { id: string } | null,
  body: Record<string, unknown>, origin: string | null, qaAllowed = false
) {
  if (typeof body.message !== "string" || !body.message.trim() || body.message.length > 1200) {
    return json({ error: "A message up to 1200 characters is required." }, 400, origin);
  }
  const started = performance.now();
  const plan = sanitizePlanState(body.planState) as Record<string, unknown>;
  const trace = traceId();
  const message = body.message.trim();
  const qa = qaAllowed && body.qa && typeof body.qa === "object" && !Array.isArray(body.qa)
    ? body.qa as Record<string, unknown> : {};
  const rulesCopy = await serverGuideCopy(admin, String(plan.language));

  if (isEmergencyText(message)) {
    const emergency = plan.language === "zh-CN"
      ? "这听起来可能是紧急情况。我会停止旅游推荐。如有人处于即时危险，请拨打 999，并在可用时使用 Trusted Family／SOS。"
      : plan.language === "ms"
        ? "Ini kedengaran seperti kecemasan. Saya menghentikan cadangan perjalanan. Hubungi 999 jika sesiapa dalam bahaya dan gunakan Trusted Family/SOS jika tersedia."
        : plan.language === "ta"
          ? "இது அவசரநிலை போல உள்ளது. பயணப் பரிந்துரைகளை நிறுத்துகிறேன். உடனடி ஆபத்து இருந்தால் 999 அழைக்கவும்; கிடைத்தால் Trusted Family/SOS பயன்படுத்தவும்."
          : "This sounds urgent. I am stopping travel recommendations. Call 999 if anyone is in immediate danger, and use Trusted Family/SOS where available.";
    const emergencyLabels = plan.language === "zh-CN" ? ["拨打 999", "Trusted Family"] : plan.language === "ms" ? ["Hubungi 999", "Trusted Family"] : plan.language === "ta" ? ["999 அழைக்கவும்", "Trusted Family"] : ["Call 999", "Trusted Family"];
    return json({
      mode: "emergency",
      assistantMessage: emergency,
      language: plan.language, planState: plan, quickReplies: [], recommendations: [],
      actions: [
        { type: "call_emergency", label: emergencyLabels[0], href: "tel:999", requiresConfirmation: false },
        { type: "open_profile", label: emergencyLabels[1], href: "/profile", requiresConfirmation: false }
      ], remainingTurns: user ? 20 : 5, fallbackReason: null, source: "rules", batchId: null, traceId: trace
    }, 200, origin);
  }

  const key = await actorKey(user?.id || null, body.visitorSessionId, Deno.env.get("M6_GUIDE_VISITOR_PEPPER") || "m6-guide-local");
  let quota: Awaited<ReturnType<typeof checkQuota>>;
  try {
    quota = await checkQuota(admin, key, user?.id || null, {
      globalLimit: numericEnv("M6_GUIDE_GLOBAL_DAILY_CAP", 1000),
      burstLimit: numericEnv("M6_GUIDE_ACTOR_BURST_CAP", 4),
      globalBurstLimit: numericEnv("M6_GUIDE_GLOBAL_BURST_CAP", 40)
    });
  } catch {
    // A missing or temporarily unavailable quota RPC must not become an
    // opaque 500. The browser can then use its verified live-catalogue rules
    // fallback, while Gemini remains disabled until server-side quota is
    // healthy again. Never bypass quota to make the provider appear available.
    return json({
      mode: "fallback", assistantMessage: rulesCopy.fallback,
      language: plan.language, planState: plan, quickReplies: rulesCopy.quickReplies,
      recommendations: [], actions: [], remainingTurns: user ? 20 : 5,
      fallbackReason: "quota_unavailable", source: "rules", batchId: null, traceId: trace
    }, 503, origin);
  }
  if (!quota.allowed) return json({
    mode: "fallback", assistantMessage: quota.reason === "burst_limit" ? guideRulesCopy(plan.language).burst : guideRulesCopy(plan.language).quota,
    language: plan.language, planState: plan, quickReplies: [], recommendations: [], actions: [],
    remainingTurns: quota.remaining, fallbackReason: quota.reason, traceId: trace
  }, 429, origin);

  const apiKey = Deno.env.get("GEMINI_API_KEY")?.trim() || "";
  const enabled = Deno.env.get("M6_TUMPANG_GUIDE_GEMINI_ENABLED") === "true";
  if (isHelpText(message)) {
    const help = await retrieveHelpSections(admin, message, String(plan.language), { apiKey, embeddingModel: EMBEDDING_MODEL });
    const base = {
      mode: "help",
      assistantMessage: help.sections.length
        ? help.sections.map((section) => section.content).join(" ")
        : rulesCopy.helpMissing,
      language: plan.language, planState: plan,
      quickReplies: rulesCopy.quickReplies,
      recommendations: [], actions: [], remainingTurns: quota.remaining,
      fallbackReason: help.source === "missing" ? "help_source_missing" : null, source: "rules", batchId: null, traceId: trace,
      helpSource: help.source
    };
    const rendered = await renderGeminiTextTurn({ base, plan, userMessage: message,
      verifiedContext: { helpSections: help.sections }, apiKey, enabled, remainingTurns: quota.remaining, trace });
    return await finalize(admin, user, body, rendered.response, [], started, rendered.providerSuccess, key, quota.globalKey, origin);
  }

  const requestedName = extractCatalogueRequestName(message);
  if (requestedName) {
    const base = {
      mode: "catalogue_missing",
      assistantMessage: `${requestedName}: ${rulesCopy.catalogueMissing}`,
      language: plan.language, planState: plan, quickReplies: [], recommendations: [],
      actions: [{ type: "request_catalogue", label: plan.language === "zh-CN" ? "申请审核地点" : plan.language === "ms" ? "Minta semakan katalog" : plan.language === "ta" ? "பட்டியல் மதிப்பாய்வைக் கோருங்கள்" : "Request catalogue review", requestedName, requiresConfirmation: true }],
      remainingTurns: quota.remaining, fallbackReason: null, source: "rules", batchId: null, traceId: trace
    };
    const rendered = await renderGeminiTextTurn({ base, plan, userMessage: message,
      verifiedContext: { requestedName, catalogueStatus: "not_present_in_verified_catalogue" },
      apiKey, enabled, remainingTurns: quota.remaining, trace });
    return await finalize(admin, user, body, rendered.response, [], started, rendered.providerSuccess, key, quota.globalKey, origin);
  }

  const missing = missingField(plan);
  if (missing) {
    const base = {
      mode: "clarify", assistantMessage: clarification(missing, plan.language, rulesCopy), language: plan.language,
      planState: plan, quickReplies: quickReplies(missing, String(plan.language)), recommendations: [], actions: [],
      remainingTurns: quota.remaining, fallbackReason: null, source: "rules", batchId: null, traceId: trace
    };
    const rendered = await renderGeminiTextTurn({ base, plan, userMessage: message,
      verifiedContext: { missingField: missing, requiredQuestion: base.assistantMessage },
      apiKey, enabled, remainingTurns: quota.remaining, trace });
    return await finalize(admin, user, body, rendered.response, [], started, rendered.providerSuccess, key, quota.globalKey, origin);
  }

  const [{ data: places, error: placeError }, { data: rides }, { data: attributes }, { data: interests }] = await Promise.all([
    admin.from("places").select("id,source_place_id,name,category,rating,review_count,state,lifecycle_state,lat,lng").in("lifecycle_state", ["Active", "Provisional", "Stale"]),
    admin.from("rides").select("destination_place_id,departure_at,seats_total,seats_available,status").in("status", ["Published", "Matched"]),
    admin.from("place_travel_attributes").select("place_id,price_level,indoor_outdoor,suitable_for_children,suitable_for_groups,has_restroom,has_parking,wheelchair_accessible,opening_hours,field_provenance,review_soft_signals,review_signals_observed_at"),
    admin.from("place_interest").select("place_id,user_id,travel_date").gte("travel_date", plan.startDate).lte("travel_date", plan.endDate)
  ]);
  if (placeError) return json({ error: "Catalogue retrieval failed." }, 503, origin);
  const originCoordinates = safeOrigin(body.originCoordinates, (plan.origin as Record<string, unknown> | null)?.label);
  const weatherMode = String(qa.weather || "live");
  const weather = weatherMode !== "live"
    ? qaWeatherByPlace((places || []) as Record<string, unknown>[], weatherMode)
    : await fetchControlledWeather(places || [], String(plan.startDate), String(plan.endDate));
  let historyCategories: string[] = [];
  try {
    historyCategories = await retrieveTripHistoryCategories(
      admin, user?.id || null, places || [], Boolean(plan.tripHistoryConsent)
    );
  } catch {
    // Trip History is an optional signal. A missing or temporarily unavailable
    // ride-history table must not turn an otherwise valid catalogue request into
    // a 500 or prevent the Guide from using the remaining non-history signals.
    historyCategories = [];
  }
  const candidates = retrieveControlledCandidates(places || [], rides || [], attributes || [], interests || [], plan, {
    weatherByPlace: weather, historyCategories, origin: originCoordinates
  });
  if (!candidates.length) {
    const response = deterministicFallback([], plan, quota.remaining, "no_verified_candidates", trace, [], null, rulesCopy);
    return await finalize(admin, user, body, response, [], started, false, key, quota.globalKey, origin);
  }

  const shownPlaceIds = Array.isArray(body.shownPlaceIds) ? body.shownPlaceIds.slice(0, 100).map(String) : [];
  const requestedRetry = Array.isArray(body.retryRecommendations)
    ? body.retryRecommendations.slice(0, 3) as Array<{ placeId?: unknown; role?: unknown; verifiedReasonCodes?: unknown; tradeoffCode?: unknown }>
    : [];
  const retryBatchId = validUuid(body.retryBatchId) ? String(body.retryBatchId) : null;
  const retryValidationValue = {
    mode: "recommend", assistantMessage: "retry", language: plan.language, planState: plan,
    quickReplies: [], recommendations: requestedRetry, actions: [], remainingTurns: quota.remaining, traceId: trace
  };
  let retryValidation = retryBatchId && requestedRetry.length
    ? validateModelResponse(retryValidationValue, candidates, requestedRetry as Array<{ placeId: string; role: string; verifiedReasonCodes: string[]; tradeoffCode: string }>)
    : { valid: false, reason: "no_retry_batch" };
  if (retryValidation.valid && user && validUuid(body.sessionId)) {
    const stored = await storedBatchMatches(
      admin,
      user,
      String(body.sessionId),
      retryBatchId,
      requestedRetry as Array<{ placeId: string; role: string; verifiedReasonCodes: string[]; tradeoffCode: string }>
    );
    if (!stored) retryValidation = { valid: false, reason: "retry_batch_not_found" };
  }
  const batchId = retryValidation.valid ? retryBatchId : crypto.randomUUID();
  const ruleBatch = retryValidation.valid ? requestedRetry as Array<{ placeId: string; role: string; verifiedReasonCodes: string[]; tradeoffCode: string }>
    : selectRuleRecommendations(candidates, {
    shownPlaceIds, recommendationMode: String(plan.recommendationMode || "default")
  });

  const qaLatencyMs = qaAllowed ? Math.max(0, Number(qa.latencyMs) || 0) : 0;
  if (qaLatencyMs >= 10_000) {
    const response = deterministicFallback(candidates, plan, quota.remaining, "timeout", trace, ruleBatch, batchId);
    return await finalize(admin, user, body, response, candidates, started, false, key, quota.globalKey, origin);
  }
  if (qaLatencyMs > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(qaLatencyMs, 9_000)));

  const forcedFallback = String(qa.forceFallback || "");
  if (qaAllowed && (QA_FALLBACK_REASONS.has(forcedFallback) || qa.rejectUnknownPlace === true)) {
    const reason = qa.rejectUnknownPlace === true ? "place_not_allowlisted"
      : forcedFallback === "invalid_json" ? "invalid_json_shape" : forcedFallback;
    const response = deterministicFallback(candidates, plan, quota.remaining, reason, trace, ruleBatch, batchId);
    (response as Record<string, unknown>).validation = qa.rejectUnknownPlace === true
      ? { valid: false, reason, rejectedPlaceId: "qa-place-outside-catalogue" }
      : { valid: false, reason };
    return await finalize(admin, user, body, response, candidates, started, false, key, quota.globalKey, origin);
  }

  if (!apiKey || !enabled) {
    const response = deterministicFallback(candidates, plan, quota.remaining, "gemini_disabled", trace, ruleBatch, batchId, rulesCopy);
    return await finalize(admin, user, body, response, candidates, started, false, key, quota.globalKey, origin);
  }

  const recentMessages = Array.isArray(body.recentMessages) ? body.recentMessages.slice(-12).map((item) => ({
    role: (item as Record<string, unknown>)?.role === "assistant" ? "assistant" : "user",
    text: String((item as Record<string, unknown>)?.text || "").slice(0, 1200)
  })) : [];
  const categoryCounts = historyCategories.reduce((counts: Record<string, number>, category) => {
    counts[category] = (counts[category] || 0) + 1; return counts;
  }, {});
  const prompt = JSON.stringify({
    instruction: `You are Tumpang Guide's writing layer. The server has already selected the immutable recommendation batch below. Return the same recommendation objects byte-for-byte: never add, remove, reorder or change a placeId, role, reason code or trade-off. Explain why each supplied verified fact matters to this traveller. Ask at most one clarification. Do not expose scoring arithmetic. Do not make emergency, dispute, legal or support decisions. Preserve official place names exactly. No web or map search is available. Write every human-facing sentence in the requested response language identified by responseLanguage. Do not mix English UI labels into another language; only preserve official place names, brand names, Place IDs, dates, numbers and other explicitly protected names.`,
    responseLanguage: plan.language,
    promptVersion: PROMPT_VERSION,
    planState: { ...plan, tripHistoryConsent: Boolean(user && plan.tripHistoryConsent) },
    tripHistorySummary: plan.tripHistoryConsent && user ? { completedCategoryCounts: categoryCounts } : null,
    recentMessages, userMessage: message,
    recommendations: ruleBatch,
    candidates: ruleBatch.map((item) => {
      const candidate = candidates.find((row) => String(row.id) === String(item.placeId)) || {};
      return { placeId: candidate.id, name: candidate.name, category: candidate.category, state: candidate.state,
        hasRide: candidate.hasRide, availableSeats: candidate.availableSeats, verifiedReasonCodes: candidate.reasonCodes,
        tradeoffFacts: { distanceKm: candidate.distanceKm, reviewCount: candidate.review_count, weatherAdvisory: candidate.weatherAdvisory } };
    }),
    allowedActions: []
  });

  try {
    const generated = await callGemini({ apiKey, model: MODEL, prompt });
    // Do not overwrite the provider language before validation. Doing so would
    // make an English model response look valid during a Chinese/Malay/Tamil
    // session and would leave the user with a half-translated conversation.
    const trusted = { ...generated, planState: plan };
    const languageMatches = String((generated as Record<string, unknown>)?.language || "") === String(plan.language);
    const validation = languageMatches
      ? validateModelResponse(trusted, candidates, ruleBatch)
      : { valid: false, reason: "response_language_mismatch" };
    if (!validation.valid || trusted.mode !== "recommend") {
      const response = deterministicFallback(candidates, plan, quota.remaining, validation.reason || "invalid_mode", trace, ruleBatch, batchId, rulesCopy);
      (response as Record<string, unknown>).validation = validation;
      return await finalize(admin, user, body, response, candidates, started, false, key, quota.globalKey, origin);
    }
    const response = { ...trusted, recommendations: ruleBatch, actions: [], source: "gemini", batchId,
      remainingTurns: Math.max(0, quota.remaining - 1), fallbackReason: null, traceId: trace };
    return await finalize(admin, user, body, response, candidates, started, true, key, quota.globalKey, origin);
  } catch (error) {
    const reason = geminiFailureReason(error);
    console.warn(JSON.stringify({ event: "m6_guide_provider_failure", traceId: trace, model: MODEL,
      reason, status: Number((error as Error & { status?: number })?.status || 0) || null }));
    const response = deterministicFallback(candidates, plan, quota.remaining, reason, trace, ruleBatch, batchId, rulesCopy);
    return await finalize(admin, user, body, response, candidates, started, false, key, quota.globalKey, origin);
  }
}

async function finalize(
  admin: ReturnType<typeof createClient>, user: { id: string } | null,
  requestBody: Record<string, unknown>, response: Record<string, unknown>, candidates: Record<string, unknown>[],
  started: number, providerSuccess: boolean, key: string, globalKey: string, origin: string | null
) {
  const latency = Math.max(0, Math.round(performance.now() - started));
  const candidateIds = candidates.map((item) => String(item.id)).filter(validUuid);
  const validation = response.validation && typeof response.validation === "object" ? response.validation : { valid: true };
  let persistenceWarning = false;
  try {
    if (user) {
      // The first authenticated turn has no client session yet. Generate the
      // identifier in the Edge runtime and pass it into the RPC instead of
      // relying on an unqualified database-side gen_random_uuid() call while a
      // SECURITY DEFINER function has an empty search_path.
      const sessionId = validUuid(requestBody.sessionId)
        ? String(requestBody.sessionId)
        : crypto.randomUUID();
      const persistencePayload = {
        p_owner_id: user.id,
        p_session_id: sessionId,
        p_language: response.language,
        p_plan_state: response.planState,
        p_user_message: requestBody.message,
        p_assistant_response: response,
        p_recommendations: response.recommendations,
        p_prompt_version: PROMPT_VERSION,
        p_model_name: providerSuccess ? MODEL : "rules",
        p_batch_id: response.batchId || null,
        p_trace_id: response.traceId,
        p_latency_ms: latency,
        p_fallback_reason: response.fallbackReason,
        p_validation_result: validation,
        p_candidate_place_ids: candidateIds
      };
      const retryBatch = validUuid(requestBody.retryBatchId) ? String(requestBody.retryBatchId) : null;
      if (retryBatch && validUuid(requestBody.sessionId)) {
        try {
          const upgraded = await upgradeSignedInBatch(admin, {
            p_owner_id: user.id,
            p_session_id: requestBody.sessionId,
            p_batch_id: retryBatch,
            p_language: response.language,
            p_plan_state: response.planState,
            p_assistant_response: response,
            p_prompt_version: PROMPT_VERSION,
            p_model_name: providerSuccess ? MODEL : "rules",
            p_trace_id: response.traceId,
            p_latency_ms: latency,
            p_fallback_reason: response.fallbackReason,
            p_validation_result: validation,
            p_candidate_place_ids: candidateIds
          });
          response.sessionId = upgraded ? requestBody.sessionId : await persistSignedInTurn(admin, persistencePayload);
        } catch {
          // Migration 080 may be deployed after the function. Keep the old
          // persistence path usable during that rollout window.
          response.sessionId = await persistSignedInTurn(admin, persistencePayload);
        }
      } else {
        response.sessionId = await persistSignedInTurn(admin, persistencePayload);
      }
    } else {
      await persistGuestTrace(admin, {
        p_trace_id: response.traceId,
        p_mode: response.mode,
        p_prompt_version: PROMPT_VERSION,
        p_model_name: providerSuccess ? MODEL : "rules",
        p_latency_ms: latency,
        p_fallback_reason: response.fallbackReason,
        p_validation_result: validation,
        p_candidate_place_ids: candidateIds,
        p_shown_place_ids: Array.isArray(response.recommendations)
          ? response.recommendations.map((item) => String((item as Record<string, unknown>).placeId)).filter(validUuid) : []
      });
    }
  } catch {
    // A provider response is still useful when an optional trace/history RPC
    // is unavailable during deployment. Keep the provider source truthful and
    // let the client warn the user that this turn was not persisted.
    persistenceWarning = true;
  }
  if (providerSuccess) {
    try {
      await recordProviderSuccess(admin, key, globalKey);
    } catch {
      persistenceWarning = true;
    }
  }
  if (persistenceWarning) response.persistenceWarning = true;
  return json(response, 200, origin);
}

async function handle(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ error: "Origin is not allowed." }, 403, origin);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return json({ error: "A JSON request body is required." }, 400, origin);
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = secretKey();
  if (!url || !key) return json({ error: "Server database access is not configured." }, 503, origin);
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  if (body.operation === "refresh_help_embeddings") {
    if (request.headers.get("apikey") !== key) return json({ error: "Server authorization required." }, 403, origin);
    return handleEmbeddingRefresh(admin, origin);
  }
  const user = await optionalUser(admin, request);
  if (body.operation === "language_pack") {
    return handleLanguagePack(admin, body, origin);
  }
  if (body.operation === "feedback") return handleFeedback(admin, user, body, origin);
  if (body.operation === "translate_messages") return handleTranslateMessages(admin, user, body, origin);
  return handleTurn(admin, user, body, origin, isLocalQaOrigin(origin) || qaUserAllowlisted(user));
}

export default { fetch: async (request: Request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (request.method !== "POST") return json({ error: "POST required" }, 405, origin);
  try { return await handle(request); }
  catch (error) { return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500, origin); }
} };
