import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import {
  embedHelpQuery, isCompleteGuideLanguagePack,
  LANGUAGE_PACK_NESTED_KEYS, LANGUAGE_PACK_REQUIRED_KEYS, LANGUAGE_PACK_SCHEMA, TRANSLATION_SCHEMA
} from "./gemini.ts";
import {
  callProviderChain, GUIDE_RENDER_SCHEMA,
  mergeProviderIntent, preserveSmallTalkPlan, providerOrder, RECOMMENDATION_COPY_SCHEMA,
  resolveClarificationField, VERIFIED_GUIDE_CAPABILITIES
} from "./providers.ts";
import { retrieveTripHistoryCategories } from "./history.ts";
import { fetchGroundedPlaceInfo, matchCataloguePlaces } from "./placeInfo.ts";
import { transcribeGuideAudio } from "./transcription.ts";
import { chooseGuideTool, toolMode } from "./agent.ts";
import { sanitizePublicGuidePayload } from "./publicPayload.ts";
import { claimGuideTurn, completeGuideTurn, failGuideTurn, providerInCooldown, recordProviderAttempt } from "./reliability.ts";
import {
  ambiguousCatalogueMessage, catalogueMissingMessage, namedPlaceResponseLanguage, selfContradictedInfoBrushOff
} from "./guideCatalogueTemplates.ts";
import {
  assertNoCardsOrActionsFromSearch, detectSelfContradictedInfoRecommendation, extractCatalogueRequestName,
  guideRulesCopy, isEmergencyText, isOrdinaryDiscomfortText, sanitizePlanState, validateModelResponse
} from "./policy.ts";
import { fetchControlledWeather, retrieveControlledCandidates, selectRuleRecommendations } from "./retrieval.ts";
import { fetchTravelInfo } from "./travelInfo.ts";
import {
  DEFAULT_MALAYSIA_CITY, fetchGuideForecast, geocodeMalaysianPlace, malaysiaToday,
  matchMalaysianCityInText, resolveForecastWindow, resolveMalaysianCity
} from "./weather.ts";
import { estimateGuideRoute } from "./routeInfo.ts";
import {
  routeAnswerText, routeDestinationClarifyText, routeDestinationUnknownText, routeOriginClarifyText,
  weatherAnswerText, weatherHorizonText, weatherLocationClarifyText, weatherServiceDownText
} from "./guideForecastTemplates.ts";
import {
  actorKey, checkQuota, persistGuestTrace, persistSignedInTurn,
  recordProviderSuccess, upgradeSignedInBatch, validUuid
} from "./runtime.ts";

const ALLOWED_ORIGINS = (Deno.env.get("M6_GUIDE_ALLOWED_ORIGINS") || "http://localhost:5173")
  .split(",").map((value) => value.trim()).filter(Boolean);
const MODEL = Deno.env.get("M6_GUIDE_GEMINI_MODEL")?.trim() || "gemini-3.7-flash";
const EMBEDDING_MODEL = Deno.env.get("M6_GUIDE_EMBEDDING_MODEL")?.trim() || "gemini-embedding-2-preview";
const PROMPT_VERSION = "m6-guide-agent-v3";
const LANGUAGE_PACK_VERSION = "m6-guide-pack-v5";
const EDGE_VERSION = "m6-guide-agent-v3.1.1-2026-09-01.3";

const QA_FALLBACK_REASONS = new Set(["provider_429", "invalid_json_shape", "timeout", "provider_unavailable"]);
const PROVIDERS = providerOrder();

function boundedTimeout(name: string, fallback: number) {
  // Keep operational tuning below the hosted Edge request ceiling. The
  // browser deadline is deliberately longer than the longest normal place
  // research path, but never allows an accidental secret to request minutes
  // of work from one invocation.
  // The documented defaults are reliability floors. Older deployed secrets
  // such as the former 12s intent timeout must not silently reintroduce the
  // exact premature-abort bug after this function is redeployed.
  return Math.min(120_000, Math.max(fallback, numericEnv(name, fallback)));
}

const TIMEOUTS = Object.freeze({
  intent: boundedTimeout("M6_GUIDE_INTENT_TIMEOUT_MS", 24_000),
  render: boundedTimeout("M6_GUIDE_RENDER_TIMEOUT_MS", 24_000),
  languagePack: boundedTimeout("M6_GUIDE_LANGUAGE_PACK_TIMEOUT_MS", 40_000),
  translations: boundedTimeout("M6_GUIDE_TRANSLATION_TIMEOUT_MS", 36_000),
  recommendationCopy: boundedTimeout("M6_GUIDE_RECOMMENDATION_COPY_TIMEOUT_MS", 24_000),
  placeGemini: boundedTimeout("M6_GUIDE_PLACE_GEMINI_TIMEOUT_MS", 18_000),
  placeGroq: boundedTimeout("M6_GUIDE_PLACE_GROQ_TIMEOUT_MS", 32_000),
  weather: boundedTimeout("M6_GUIDE_WEATHER_TIMEOUT_MS", 4_000),
  // Shorter than the forecast itself on purpose: this is one resolution tier
  // that falls through on failure, not the answer, so it must never spend the
  // turn's budget waiting.
  geocode: boundedTimeout("M6_GUIDE_GEOCODE_TIMEOUT_MS", 2_500)
});

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
  const rawPayload = body && typeof body === "object" && !Array.isArray(body)
    ? { ...(body as Record<string, unknown>), edgeVersion: EDGE_VERSION } as Record<string, unknown>
    : body;
  const routeGuardHandled = Boolean(rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)
    && (rawPayload as Record<string, unknown>).__namedPlaceGuardHandled === true);
  const payload = sanitizePublicGuidePayload(rawPayload);
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    delete (payload as Record<string, unknown>).__namedPlaceGuardHandled;
  }
  return new Response(JSON.stringify(payload), {
    status, headers: { ...cors(origin), "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store", "x-tumpang-guide-version": EDGE_VERSION,
      ...(routeGuardHandled ? { "x-tumpang-guide-route-guard": "1" } : {}) }
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

function guideAiEnabled() {
  // Keep an explicit maintenance off switch, but do not make a correctly
  // configured deployment depend on a second feature-flag secret. Previously
  // a missing M6_TUMPANG_GUIDE_AI_ENABLED silently bypassed both providers
  // even when their server-side keys were present.
  if (Deno.env.get("M6_TUMPANG_GUIDE_AI_ENABLED") === "false") return false;
  if (Deno.env.get("M6_TUMPANG_GUIDE_GEMINI_ENABLED") === "false") {
    return Boolean(Deno.env.get("GROQ_API_KEY")?.trim());
  }
  return Deno.env.get("M6_TUMPANG_GUIDE_AI_ENABLED") === "true"
    || Deno.env.get("M6_TUMPANG_GUIDE_GEMINI_ENABLED") === "true"
    || Boolean(Deno.env.get("GEMINI_API_KEY")?.trim() || Deno.env.get("GROQ_API_KEY")?.trim());
}

async function optionalUser(admin: ReturnType<typeof createClient>, request: Request) {
  const auth = request.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const { data, error } = await admin.auth.getUser(auth.slice(7));
  if (error || !data.user) {
    const failure = new Error("The signed-in session is no longer valid.") as Error & { status?: number; code?: string };
    failure.status = 401;
    failure.code = "auth_session_invalid";
    throw failure;
  }
  return data.user || null;
}

async function liveFactCacheKey(placeName: unknown, language: unknown, message: unknown) {
  const input = `${String(placeName).trim().toLocaleLowerCase()}|${String(language)}|${String(message).trim().toLocaleLowerCase()}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readLiveFactCache(admin: ReturnType<typeof createClient>, cacheKey: string) {
  try {
    const { data } = await admin.schema("private").from("ai_guide_live_fact_cache")
      .select("facts,sources,checked_at,expires_at").eq("cache_key", cacheKey)
      .gt("expires_at", new Date().toISOString()).maybeSingle();
    if (!data) return null;
    return { ...((data.facts || {}) as Record<string, unknown>), sources: data.sources || [],
      checkedAt: data.checked_at, cacheStatus: "database_hit" };
  } catch { return null; }
}

async function writeLiveFactCache(admin: ReturnType<typeof createClient>, cacheKey: string,
  placeName: string, language: string, value: Record<string, unknown>) {
  try {
    const { sources = [], checkedAt = new Date().toISOString(), ...facts } = value;
    await admin.schema("private").from("ai_guide_live_fact_cache").upsert({
      cache_key: cacheKey, place_name: placeName.slice(0, 180), language_tag: language.slice(0, 24),
      facts, sources, checked_at: checkedAt, expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      updated_at: new Date().toISOString()
    }, { onConflict: "cache_key" });
  } catch { /* Cache availability never changes the answer contract. */ }
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
  if (!plan.origin) return "origin";
  if (!Array.isArray(plan.preferredCategories) || !plan.preferredCategories.length) return "preference";
  return null;
}

function quickReplies(field: string, language: string) {
  void field; void language;
  return [];
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
  const rows = Array.isArray((error as Error & { failures?: unknown[] })?.failures)
    ? (error as Error & { failures: Array<Record<string, unknown>> }).failures : [];
  const placeRows = Array.isArray((error as Error & { providerFailures?: unknown[] })?.providerFailures)
    ? (error as Error & { providerFailures: Array<Record<string, unknown>> }).providerFailures : [];
  const statuses = [Number((error as Error & { status?: number })?.status || 0),
    ...rows.map((row) => Number(row?.status || 0)),
    ...placeRows.map((row) => Number(row?.status || 0))].filter(Boolean);
  const details = [error instanceof Error ? error.message : String(error || ""),
    ...rows.map((row) => String(row?.message || "")),
    ...placeRows.map((row) => String(row?.reason || ""))].join(" ").toLowerCase();
  if (statuses.some((status) => status === 401 || status === 403)) return "provider_auth";
  if (statuses.includes(429) || /\b429\b|quota|rate limit/u.test(details)) return "provider_429";
  if (statuses.includes(404)) return "provider_model_unavailable";
  if (statuses.some((status) => status === 400 || status === 422)) return "provider_request_invalid";
  if ((error instanceof Error || error instanceof DOMException) && error.name === "AbortError"
      || /abort|timed?\s*out|timeout/u.test(details)) return "timeout";
  return "provider_unavailable";
}

function safeProviderFailures(error: unknown) {
  const rows = (error as Error & { failures?: unknown })?.failures;
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 2).map((item) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      provider: String(row.provider || "unknown").slice(0, 16),
      status: Number(row.status) || 0,
      code: String(row.code || "").slice(0, 80),
      message: String(row.message || "").slice(0, 360)
    };
  });
}

function safePlaceContext(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 4).map((item) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      placeId: validUuid(row.placeId) ? String(row.placeId) : "",
      name: String(row.name || "").trim().slice(0, 120),
      role: ["best_match", "practical_alternative", "wildcard", "place_info"].includes(String(row.role || ""))
        ? String(row.role) : ""
    };
  }).filter((row) => row.placeId && row.name);
}

// The client echoes back exactly what a weather/route clarify response set
// on `response.pendingClarification` (see the weather/route branches below).
// This is never trusted as an instruction to change routing by itself - it
// only becomes structured input to the same, single chooseGuideTool call
// that already owns the routing decision (agent.ts's pendingClarificationRule).
// Validated narrowly: an unrecognised tool/field, or a value shape that
// doesn't match, is simply dropped rather than forwarded.
function safePendingClarification(value: unknown) {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const tool = String(row.tool || "");
  if (tool === "get_weather_forecast" && row.field === "locationName") {
    return { tool, field: "locationName" };
  }
  if (tool === "get_route_estimate" && ["destinationName", "originLabel"].includes(String(row.field || ""))) {
    const result: Record<string, unknown> = { tool, field: String(row.field) };
    const knownDestination = String(row.destinationName || "").trim().slice(0, 160);
    if (knownDestination) result.destinationName = knownDestination;
    return result;
  }
  return null;
}

function aiUnavailableMessage(language: unknown) {
  const messages: Record<string, string> = {
    en: "I could not complete a reliable AI response. Your travel brief is unchanged—please retry.",
    "zh-CN": "AI 暂时无法可靠地完成这次回答。你的旅行概要没有改变，请重试。",
    ms: "AI tidak dapat melengkapkan jawapan yang boleh dipercayai buat masa ini. Ringkasan perjalanan anda tidak berubah—sila cuba lagi.",
    ta: "AI இப்போது நம்பகமான பதிலை முடிக்க முடியவில்லை. உங்கள் பயணச் சுருக்கம் மாற்றப்படவில்லை—மீண்டும் முயலுங்கள்."
  };
  return messages[String(language)] || messages.en;
}

function unavailableTurn(base: Record<string, unknown>, plan: Record<string, unknown>, remainingTurns: number, reason: string, responseLanguage = String(base.responseLanguage || plan.language || "en")) {
  const answerLanguage = String(responseLanguage || plan.language || "en");
  return {
    ...base,
    mode: "fallback",
    assistantMessage: aiUnavailableMessage(answerLanguage),
    language: answerLanguage,
    responseLanguage: answerLanguage,
    detectedLanguage: answerLanguage,
    uiLanguageChange: null,
    conversationFocus: "none",
    planState: plan,
    quickReplies: [],
    recommendations: [],
    actions: [],
    remainingTurns,
    fallbackReason: reason,
    source: "unavailable",
    retryable: true,
    batchId: null
  };
}

async function renderProviderTextTurn({
  admin, base, plan, userMessage, verifiedContext, enabled, remainingTurns, trace, provider, deadlineAt, responseLanguage,
  clientTurnId
}: {
  admin: ReturnType<typeof createClient>;
  base: Record<string, unknown>; plan: Record<string, unknown>; userMessage: string;
  verifiedContext: unknown; enabled: boolean; remainingTurns: number; trace: string;
  provider?: "gemini" | "groq"; deadlineAt?: number; responseLanguage?: string; clientTurnId?: string
}) {
  const outputLanguage = String(responseLanguage || base.responseLanguage || plan.language || "en");
  if (!enabled) return {
    response: unavailableTurn(base, plan, remainingTurns, "ai_disabled", outputLanguage), providerSuccess: false
  };
  // `scaffold` deliberately omits assistantMessage: base.assistantMessage is
  // internal placeholder/instructional text (e.g. "Ask one natural question
  // for the verified missing field."), never user-facing copy. Earlier this
  // scaffold included that text under the same key the model must return
  // (assistantMessage), with no instruction explaining what the scaffold was
  // for - a provider under load would sometimes just echo it back verbatim,
  // and the validation below never caught it, so the internal placeholder
  // reached the chat as if it were a real reply. Keeping mode/language/plan
  // context here is still useful for phrasing; the placeholder text is not.
  const scaffoldEcho = String(base.assistantMessage || "").trim().toLowerCase();
  const prompt = JSON.stringify({
    instruction: "You are Tumpang Guide. Write ONE new, concise, friendly assistantMessage in responseLanguage, based only on verifiedContext. Do not copy, translate or lightly reword any other text in this prompt - scaffold is internal state to preserve (its mode and language must be returned unchanged), not example wording. If verifiedContext.askForExactlyOneField is set, your assistantMessage must be exactly one natural question asking specifically about that field and nothing else. Return recommendations and actions as empty arrays. Never invent places, routes, opening hours, safety facts or app capabilities. Preserve official names. Do not expose internal rules, scoring, or any field name from this prompt.",
    responseLanguage: outputLanguage,
    userMessage,
    scaffold: {
      mode: base.mode, language: outputLanguage,
      planState: plan, quickReplies: base.quickReplies, recommendations: [], actions: []
    },
    verifiedContext
  });
  try {
    const owner = provider || (["gemini", "groq"].includes(String(base.source))
      ? String(base.source) as "gemini" | "groq" : PROVIDERS.primary);
    const result = await callProviderChain({
      prompt, responseSchema: GUIDE_RENDER_SCHEMA, maxOutputTokens: 360,
       primary: owner, secondary: owner,
       timeoutMs: deadlineAt ? providerBudgetMs(deadlineAt, TIMEOUTS.render) : Math.min(45_000, TIMEOUTS.render),
       admin, stage: "turn_render", traceId: trace, clientTurnId
    });
    const generated = result.value;
    const assistantMessage = String((generated as Record<string, unknown>)?.assistantMessage || "").trim();
    // Defence in depth, not the fix itself: the prompt no longer sends the
    // placeholder text at all, but a provider could still coincidentally (or
    // from training-data leakage) reproduce it - fail closed to the existing
    // honest "AI unavailable, please retry" turn instead of accepting it.
    const isPlaceholderEcho = scaffoldEcho.length > 0 && assistantMessage.toLowerCase() === scaffoldEcho;
    const valid = (generated as Record<string, unknown>)?.mode === base.mode
      && (generated as Record<string, unknown>)?.language === outputLanguage
      && assistantMessage.length > 0 && assistantMessage.length <= 1600
      && !isPlaceholderEcho;
    if (!valid) throw new Error("Provider output failed Guide render validation.");
    return {
      response: { ...base, assistantMessage, source: result.provider, providerModel: result.model, fallbackReason: null,
        remainingTurns: Math.max(0, remainingTurns - 1), responseLanguage: outputLanguage },
      providerSuccess: true
    };
  } catch (error) {
    const reason = geminiFailureReason(error);
    console.warn(JSON.stringify({ event: "m6_guide_provider_failure", traceId: trace, model: "provider-chain",
      reason, status: Number((error as Error & { status?: number })?.status || 0) || null,
      providerFailures: safeProviderFailures(error) }));
    throw error;
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
  try {
    const prompt = JSON.stringify({
      instruction: "Create a complete Tumpang Guide UI language pack. Return JSON only with a copy object containing every requested top-level and nested key. Every value must be a natural translation. The legacy key retryGemini must mean Retry AI because either Gemini or Groq may respond. Keep placeholders unchanged and preserve official product/place names.",
      language, packVersion, requiredTopLevelKeys: [...LANGUAGE_PACK_REQUIRED_KEYS],
      requiredNestedKeys: LANGUAGE_PACK_NESTED_KEYS
    });
    const result = await callProviderChain({
      prompt, responseSchema: LANGUAGE_PACK_SCHEMA, maxOutputTokens: 1800, strict: false,
      primary: PROVIDERS.primary, secondary: PROVIDERS.secondary, timeoutMs: TIMEOUTS.languagePack,
      validate: (value) => isCompleteGuideLanguagePack(value, language, packVersion),
      admin, stage: "language_pack"
    });
    const pack = result.value;
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
  const cacheTranslations = body.cacheTranslations !== false;
  const items = Array.isArray(body.messages) ? body.messages.slice(0, 12).map((item) => ({
    id: String((item as Record<string, unknown>)?.id || "").slice(0, 160),
    text: String((item as Record<string, unknown>)?.text || "").slice(0, 4000)
  })).filter((item) => item.id && item.text) : [];
  if (!validLanguageTag(language) || !items.length) return json({ error: "Invalid translation request." }, 400, origin);
  try {
    const prompt = JSON.stringify({
      instruction: "Translate each Tumpang Guide assistant message into the requested language. Return exactly the same ids. Preserve official place/product names, numbers and dates. Do not add commentary.",
      language, messages: items
    });
    const translated = (await callProviderChain({
      prompt, responseSchema: TRANSLATION_SCHEMA, maxOutputTokens: 2200, timeoutMs: TIMEOUTS.translations,
      primary: PROVIDERS.primary, secondary: PROVIDERS.secondary,
      admin, stage: "translation"
    })).value;
    const rows = Array.isArray((translated as Record<string, unknown>)?.translations)
      ? (translated as Record<string, unknown>).translations as Array<Record<string, unknown>> : [];
    const byId = new Map(items.map((item) => [item.id, item]));
    const valid = rows.length === items.length && rows.every((row) => byId.has(String(row.id)) && typeof row.text === "string" && String(row.text).trim());
    if (!valid) return json({ error: "Translation validation failed." }, 502, origin);
    if (user && cacheTranslations) {
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

async function extractProviderIntent({
  message, plan, responseLanguage, recentMessages, today, placeContext, provider, timeoutMs, signedIn, pendingClarification
}: {
  message: string; plan: Record<string, unknown>;
  responseLanguage: string;
  recentMessages: Array<{ role: string; text: string }>; today: string;
  placeContext: Array<{ placeId: string; name: string; role?: string }>;
  provider: "gemini" | "groq";
  timeoutMs: number;
  signedIn: boolean;
  pendingClarification: Record<string, unknown> | null;
}) {
  const choice = await chooseGuideTool(provider, {
    message, responseLanguage, planState: plan, recentMessages, today, verifiedPlaceContext: placeContext, signedIn,
    // Structured continuation context - not a routing override. chooseGuideTool
    // still makes the one, sole routing decision; this just gives it a
    // machine-readable signal (instead of having to infer purely from free-text
    // recentMessages) about which field a just-asked weather/route clarifying
    // question is waiting on, since a bare one-word reply like "KLCC" carries
    // no signal of its own.
    ...(pendingClarification ? { pendingClarification } : {})
  }, { timeoutMs: Math.min(timeoutMs, TIMEOUTS.intent) });
  const args = choice.args || {};
  const detectedLanguage = String(args.language || responseLanguage || plan.language || "en").trim();
  const modelLanguageConfidence = Number(args.languageConfidence);
  const languageConfidence = Number.isFinite(modelLanguageConfidence) && modelLanguageConfidence > 0
    ? Math.max(0, Math.min(1, modelLanguageConfidence)) : .85;
  const supplied = (value: unknown) => value !== "" && value !== 0 && value !== "unspecified"
    && (!Array.isArray(value) || value.length > 0);
  // Travel-Brief fields (dates, origin, party, preferences) may only ever be
  // written by search_catalogue. A weather or route question that happens to
  // declare a startDate/originLabel parameter must never silently rewrite
  // the traveller's trip plan as a side effect of asking "will it rain
  // tomorrow?" - that was a real bug caught before shipping the weather/route
  // tools (see Phase 8.0 of the plan).
  const isCatalogueSearch = choice.toolName === "search_catalogue";
  const confidence = {
    origin: isCatalogueSearch && supplied(args.originLabel) ? .9 : 0,
    party: isCatalogueSearch && supplied(args.partySize) ? .9 : 0,
    date: isCatalogueSearch && supplied(args.startDate) ? .9 : 0,
    preference: isCatalogueSearch && supplied(args.preferredCategories) ? .9 : 0,
    budget: 0, indoorPreference: 0, accessibilityRequired: 0, children: 0,
    recommendationMode: isCatalogueSearch && supplied(args.recommendationMode) ? .9 : 0,
    requestedMode: 1,
    language: languageConfidence
  };
  const extraction = {
    intentPatch: {
      originLabel: isCatalogueSearch ? (args.originLabel || "") : "",
      partySize: isCatalogueSearch ? (args.partySize || 0) : 0,
      startDate: isCatalogueSearch ? (args.startDate || "") : "",
      endDate: isCatalogueSearch ? (args.endDate || "") : "",
      preferredCategories: isCatalogueSearch ? (args.preferredCategories || []) : [],
      budget: "unspecified",
      indoorPreference: "unspecified", accessibilityRequired: false, children: false,
      recommendationMode: isCatalogueSearch ? (args.recommendationMode || "unspecified") : "unspecified",
      requestedMode: toolMode(choice.toolName),
      // get_travel_info's relatedPlaceName reuses requestedPlaceName's slot -
      // both mean "the catalogue place this tool result concerns," never a
      // place this call may itself introduce.
      requestedPlaceName: args.requestedPlaceName || args.relatedPlaceName || "",
      requestedAction: args.requestedAction || "unspecified"
    },
    confidence, needsConfirmation: [], nextQuestionField: args.nextQuestionField || "unspecified",
    language: detectedLanguage, languageConfidence,
    switchLanguage: args.switchLanguage === true, assistantMessage: args.assistantMessage || ""
  };
  const model = provider === "gemini"
    ? Deno.env.get("M6_GUIDE_GEMINI_MODEL")?.trim() || "gemini-3.7-flash"
    : Deno.env.get("M6_GUIDE_GROQ_MODEL")?.trim() || "openai/gpt-oss-20b";
  const merged = mergeProviderIntent(plan, extraction);
  return {
    ...merged,
    provider, providerModel: model, toolName: choice.toolName,
    responseLanguage: String(merged.responseLanguage || merged.detectedLanguage || plan.language || "en"),
    topic: String(args.topic || "").trim().slice(0, 200),
    // Tool-scoped values for the two deterministic tools. These deliberately
    // never touch `plan` - see the isCatalogueSearch guard above.
    weatherLocationName: String(args.locationName || "").trim().slice(0, 160),
    weatherStartDate: String(args.startDate || "").trim().slice(0, 10),
    weatherEndDate: String(args.endDate || "").trim().slice(0, 10),
    routeDestinationName: String(args.destinationName || "").trim().slice(0, 160),
    routeOriginLabel: String(args.originLabel || "").trim().slice(0, 80),
    ...(choice.toolName === "change_interface_language" ? {
      uiLanguageChange: String(args.language || "").trim()
    } : {})
  };
}

function emergencyResponse(plan: Record<string, unknown>, remainingTurns: number, trace: string, source: string, providerModel: string | null = null, intentConfidence: unknown = null, responseLanguage = String(plan.language || "en")) {
  const language = String(responseLanguage || plan.language || "en");
  const assistantMessage = language === "zh-CN"
    ? "这听起来可能是紧急情况。我会停止旅游推荐。如有人处于即时危险，请拨打 999，并在可用时使用 Trusted Family／SOS。"
    : language === "ms"
      ? "Ini kedengaran seperti kecemasan. Saya menghentikan cadangan perjalanan. Hubungi 999 jika sesiapa dalam bahaya dan gunakan Trusted Family/SOS jika tersedia."
      : language === "ta"
        ? "இது அவசரநிலை போல உள்ளது. பயணப் பரிந்துரைகளை நிறுத்துகிறேன். உடனடி ஆபத்து இருந்தால் 999 அழைக்கவும்; கிடைத்தால் Trusted Family/SOS பயன்படுத்தவும்."
        : "This sounds urgent. I am stopping travel recommendations. Call 999 if anyone is in immediate danger, and use Trusted Family/SOS where available.";
  const labels = language === "zh-CN" ? ["拨打 999", "Trusted Family"]
    : language === "ms" ? ["Hubungi 999", "Trusted Family"]
      : language === "ta" ? ["999 அழைக்கவும்", "Trusted Family"] : ["Call 999", "Trusted Family"];
  return {
    mode: "emergency", assistantMessage, language, responseLanguage: language, planState: plan,
    quickReplies: [], recommendations: [], actions: [
      { type: "call_emergency", label: labels[0], href: "tel:999", requiresConfirmation: false },
      { type: "open_profile", label: labels[1], href: "/profile", requiresConfirmation: false }
    ], remainingTurns, fallbackReason: null, source, providerModel, intentConfidence,
    batchId: null, traceId: trace
  };
}

async function namedPlaceGuardResponse({
  admin, user, body, plan, trace, started, quota, origin, kind, language, choices = []
}: {
  admin: ReturnType<typeof createClient>; user: { id: string } | null;
  body: Record<string, unknown>; plan: Record<string, unknown>; trace: string;
  started: number; quota: { remaining: number; globalKey: string }; origin: string | null;
  kind: "missing" | "ambiguous"; language: string; choices?: string[];
}) {
  const mode = kind === "missing" ? "catalogue_missing" : "clarify";
  const response: Record<string, unknown> = {
    mode,
    assistantMessage: kind === "missing" ? catalogueMissingMessage(language) : ambiguousCatalogueMessage(language),
    language,
    responseLanguage: language,
    detectedLanguage: language,
    uiLanguageChange: null,
    conversationFocus: kind === "missing" ? "none" : "place",
    planState: plan,
    quickReplies: kind === "ambiguous" ? choices : [],
    recommendations: [], actions: [], sources: [], toolResults: [],
    remainingTurns: quota.remaining, fallbackReason: null, fallbackUsed: false,
    source: "catalogue_guard", batchId: null, traceId: trace,
    clientTurnId: validUuid(body.clientTurnId) ? body.clientTurnId : null,
    supersedesTraceId: null,
    // Consumed by handleTurn for private audit classification, then removed
    // by json() before the payload is sent to the browser.
    __namedPlaceGuardHandled: true
  };
  if (!user) {
    try {
      await persistGuestTrace(admin, {
        p_trace_id: trace, p_mode: mode, p_prompt_version: PROMPT_VERSION,
        p_model_name: "catalogue_guard", p_latency_ms: Math.max(0, Math.round(performance.now() - started)),
        p_fallback_reason: kind === "missing" ? "catalogue_missing" : "catalogue_ambiguous",
        p_validation_result: { valid: true, reason: kind }, p_candidate_place_ids: [], p_shown_place_ids: []
      });
    } catch {
      response.persistenceWarning = true;
    }
  }
  return json(response, 200, origin);
}

function providerBudgetMs(deadlineAt: number, requestedMs = 45_000) {
  const remaining = Math.floor(deadlineAt - Date.now() - 250);
  if (!Number.isFinite(remaining) || remaining < 1_000) {
    const error = new DOMException("The provider turn exceeded its 45 second budget.", "AbortError");
    throw error;
  }
  return Math.min(requestedMs, remaining);
}

type GuideTurnQuota = Awaited<ReturnType<typeof checkQuota>>;
type GuideTurnContext = { key: string; quota: GuideTurnQuota };

async function handleTurnAttempt(
  admin: ReturnType<typeof createClient>, user: { id: string } | null,
  body: Record<string, unknown>, origin: string | null, turnContext: GuideTurnContext, qaAllowed = false
) {
  if (typeof body.message !== "string" || !body.message.trim() || body.message.length > 1200) {
    return json({ error: "A message up to 1200 characters is required." }, 400, origin);
  }
  const started = performance.now();
  let plan = sanitizePlanState(body.planState) as Record<string, unknown>;
  const planBeforeIntent = sanitizePlanState(plan) as Record<string, unknown>;
  const trace = traceId();
  const message = body.message.trim();
  const ownedProvider = body.__ownedProvider === "groq" ? "groq" : "gemini";
  const providerDeadlineAt = Number(body.__providerDeadlineAt) || Date.now() + 45_000;
  const qa = qaAllowed && body.qa && typeof body.qa === "object" && !Array.isArray(body.qa)
    ? body.qa as Record<string, unknown> : {};
  let rulesCopy = await serverGuideCopy(admin, String(plan.language));

  const { key, quota } = turnContext;

  const enabled = guideAiEnabled();
  const recentMessages = Array.isArray(body.recentMessages) ? body.recentMessages.slice(-12).map((item) => ({
    role: (item as Record<string, unknown>)?.role === "assistant" ? "assistant" : "user",
    text: String((item as Record<string, unknown>)?.text || "").slice(0, 1200)
  })) : [];
  // Only previously generated public venue facts may be forwarded to the
  // grounded-search provider for de-duplication. Never forward earlier user
  // messages or the rest of the conversation through this path.
  const previousPublicFacts = [...recentMessages].reverse().find((item) =>
    item.role === "assistant" && item.text.startsWith("Previous public venue facts for ")
  )?.text.slice(0, 1200) || "";
  const placeContext = safePlaceContext(body.placeContext);
  const pendingClarification = safePendingClarification(body.pendingClarification);
  const conversationFocus = ["place", "recommendation_batch", "capabilities", "action", "emergency", "none"]
    .includes(String(body.conversationFocus || "")) ? String(body.conversationFocus) : "none";
  type ExtractedGuideIntent = Awaited<ReturnType<typeof extractProviderIntent>> & { responseLanguage?: string };
  let intent: ExtractedGuideIntent | null = null;

  if (!enabled) {
    const answerLanguage = namedPlaceResponseLanguage(message, plan.language);
    return json({
      mode: "fallback", assistantMessage: aiUnavailableMessage(answerLanguage),
      language: answerLanguage, responseLanguage: answerLanguage, planState: plan, quickReplies: [], recommendations: [], actions: [],
      remainingTurns: quota.remaining, fallbackReason: "ai_disabled", source: "unavailable",
      retryable: true, batchId: null, traceId: trace
    }, 200, origin);
  }

  try {
    intent = await extractProviderIntent({
      message, plan, responseLanguage: namedPlaceResponseLanguage(message, plan.language),
      recentMessages,
      today: String(qa.today || malaysiaToday()),
      placeContext, provider: ownedProvider,
      timeoutMs: providerBudgetMs(providerDeadlineAt), signedIn: Boolean(user), pendingClarification
    });
    plan = intent.plan;
    rulesCopy = await serverGuideCopy(admin, String(plan.language));
    // Unconditional, every turn - not just on failure. Nothing else records
    // what the routing decision actually was, so a live "why did this go to
    // the wrong tool" question was previously unanswerable from the logs.
    console.log(JSON.stringify({
      event: "m6_guide_routing_decision", traceId: trace, toolName: intent.toolName,
      requestedMode: intent.requestedMode, weatherLocationName: intent.weatherLocationName || null,
      routeDestinationName: intent.routeDestinationName || null, routeOriginLabel: intent.routeOriginLabel || null,
      pendingClarificationSent: pendingClarification, provider: intent.provider
    }));
  } catch (error) {
    const reason = geminiFailureReason(error);
    console.warn(JSON.stringify({ event: "m6_guide_intent_failure", traceId: trace, reason,
      providerFailures: safeProviderFailures(error) }));
    throw error;
  }

  // Keep the Travel Brief/UI language in `plan.language`, while the current
  // answer follows the language detected in this message.
  const responseLanguage = String(intent.responseLanguage || intent.detectedLanguage || plan.language || "en");

  if (intent.requestedMode === "emergency" && Number((intent.confidence as Record<string, unknown>)?.requestedMode || 0) >= .8) {
    // AI decides whether this is an emergency. The narrow deterministic check
    // only prevents ordinary discomfort from receiving the full SOS treatment;
    // it never promotes a normal message into emergency mode by itself.
    if (isOrdinaryDiscomfortText(message) && !isEmergencyText(message)) {
      const language = responseLanguage;
      const assistantMessage = language === "zh-CN"
        ? "听起来你有些不舒服。要暂停行程、改到更轻松的室内地点，还是更改日期？如果症状严重或迅速恶化，请及时寻求专业医疗帮助。"
        : language === "ms"
          ? "Nampaknya anda kurang sihat. Mahu hentikan rancangan seketika, pilih tempat dalaman yang lebih santai, atau tukar tarikh? Dapatkan bantuan perubatan jika gejala serius atau semakin teruk dengan cepat."
          : language === "ta"
            ? "உங்களுக்கு உடல்நிலை சரியில்லாதது போல் தெரிகிறது. பயணத்தை இடைநிறுத்தவா, எளிதான உள்ளரங்க இடத்தைத் தேர்வுசெய்யவா, அல்லது தேதியை மாற்றவா? அறிகுறிகள் கடுமையாகவோ வேகமாக மோசமடைந்தாலோ மருத்துவ உதவியை நாடுங்கள்."
            : "It sounds like you are feeling unwell. Would you like to pause the plan, choose an easier indoor place, or change the date? Seek medical help if symptoms are severe or worsening quickly.";
      const response = {
        mode: "clarify", assistantMessage: intent.assistantMessage || assistantMessage, language, responseLanguage: language, planState: plan, quickReplies: [], recommendations: [], actions: [],
        remainingTurns: Math.max(0, quota.remaining - 1), fallbackReason: null, source: intent.provider,
        providerModel: intent.providerModel, intentConfidence: intent.confidence, batchId: null, traceId: trace
      };
      return await finalize(admin, user, body, response, [], started, true, key, quota.globalKey, origin);
    }
    const response = emergencyResponse(plan, quota.remaining, trace, intent.provider, intent.providerModel, intent.confidence, responseLanguage);
    return await finalize(admin, user, body, response, [], started, true, key, quota.globalKey, origin);
  }

  if (intent.requestedMode === "small_talk") {
    // Casual conversation may switch the interface language, but it must not
    // silently turn affection, greetings or jokes into Travel Brief fields.
    const smallTalkPlan = preserveSmallTalkPlan(planBeforeIntent, plan);
    const language = responseLanguage;
    if (!String(intent.assistantMessage || "").trim()) {
      return json(unavailableTurn({ traceId: trace }, smallTalkPlan, quota.remaining, "missing_ai_message", responseLanguage), 200, origin);
    }
    const response = {
      mode: "small_talk", assistantMessage: intent.assistantMessage,
      language, responseLanguage, uiLanguageChange: intent.uiLanguageChange || null,
      planState: smallTalkPlan, quickReplies: [], recommendations: [], actions: [],
      remainingTurns: Math.max(0, quota.remaining - 1), fallbackReason: null,
      source: intent.provider, providerModel: intent.providerModel, intentConfidence: intent.confidence,
      contractVersion: "m6-guide-small-talk-v1", batchId: null, traceId: trace
    };
    return await finalize(admin, user, body, response, [], started, true, key, quota.globalKey, origin);
  }

  if (intent.requestedMode === "action") {
    const actionType = String(intent.requestedAction || "");
    const requiresPlace = ["record_interest", "register_ride_alert"].includes(actionType);
    const requestedName = String(intent.requestedPlaceName || "").trim().toLocaleLowerCase();
    const target = requiresPlace
      ? placeContext.find((item) => item.name.trim().toLocaleLowerCase() === requestedName)
        || (!requestedName && placeContext.length === 1 ? placeContext[0] : null)
      : null;
    const missingRequirement = !["record_interest", "register_ride_alert", "save_preferences"].includes(actionType)
      ? "unsupported_action"
      : requiresPlace && !target ? "verified_place_target"
        : requiresPlace && !plan.startDate ? "travel_date"
          : actionType === "save_preferences" && !(plan.preferredCategories as unknown[])?.length ? "travel_preferences"
            : "";

    if (missingRequirement) {
      const base = {
        mode: "clarify", assistantMessage: "More information is required before this action can be prepared.",
        language: plan.language, planState: plan, quickReplies: [], recommendations: [], actions: [],
        remainingTurns: quota.remaining, fallbackReason: null, source: "unavailable", batchId: null, traceId: trace
      };
      const rendered = await renderProviderTextTurn({ admin, base, plan, userMessage: message,
        verifiedContext: { requestedAction: actionType || "unknown", missingRequirement,
          verifiedPlaceContext: placeContext.map(({ placeId: _placeId, ...item }) => item) },
        enabled, remainingTurns: quota.remaining, trace, provider: intent.provider, deadlineAt: providerDeadlineAt,
        responseLanguage });
      return await finalize(admin, user, body, rendered.response, [], started, rendered.providerSuccess, key, quota.globalKey, origin);
    }

    const pendingAction = {
      type: actionType,
      label: actionType,
      ...(target ? { placeId: target.placeId, placeName: target.name, travelDate: plan.startDate } : {}),
      requiresConfirmation: true
    };
    const base = {
      mode: "action", assistantMessage: "This verified app action is ready for confirmation.",
      language: plan.language, planState: plan, quickReplies: [], recommendations: [], actions: [],
      remainingTurns: quota.remaining, fallbackReason: null, source: "unavailable", batchId: null, traceId: trace
    };
    const rendered = await renderProviderTextTurn({ admin, base, plan, userMessage: message,
      verifiedContext: { status: "ready_for_user_confirmation", requestedAction: actionType,
        target: target ? { officialName: target.name, travelDate: plan.startDate } : { preferredCategories: plan.preferredCategories } },
      enabled, remainingTurns: quota.remaining, trace, provider: intent.provider, deadlineAt: providerDeadlineAt,
      responseLanguage });
    if (rendered.providerSuccess) rendered.response.actions = [pendingAction];
    return await finalize(admin, user, body, rendered.response,
      target ? [{ id: target.placeId, name: target.name }] : [], started, rendered.providerSuccess, key, quota.globalKey, origin);
  }

  if (intent.requestedMode === "place_info") {
    // The model has already chosen get_place_information and supplied a
    // name; this is grounding/validating that choice against the verified
    // catalogue (a tool result), not a routing decision.
    const requestedName = String(intent.requestedPlaceName || "").trim();
    const { data: catalogue, error: catalogueError } = await admin.from("places")
      .select("id,source_place_id,name,category,description,description_is_template,rating,review_count,state,lifecycle_state,lat,lng")
      .in("lifecycle_state", ["Active", "Provisional", "Stale"]);
    if (catalogueError) {
      console.error(JSON.stringify({ event: "m6_guide_catalogue_failure", traceId: trace,
        stage: "place_info_match", code: String(catalogueError.code || "database_error").slice(0, 80) }));
      return json(unavailableTurn({ traceId: trace }, plan, quota.remaining, "catalogue_unavailable", namedPlaceResponseLanguage(message, plan.language)), 503, origin);
    }
    const matches = matchCataloguePlaces((catalogue || []) as Record<string, unknown>[], requestedName);
    const top = matches[0]; const second = matches[1];
    const ambiguous = Boolean(top && second && (Number(top.matchScore) < .9 || Number(top.matchScore) - Number(second.matchScore) < .12));
    const responseLanguage = String(intent.responseLanguage || namedPlaceResponseLanguage(message, plan.language));
    if (!top) {
      return await namedPlaceGuardResponse({
        admin, user, body, plan: planBeforeIntent, trace, started, quota, origin,
        kind: "missing", language: responseLanguage
      });
    }
    if (ambiguous) {
      const choices = matches.slice(0, 4).map((place) => `${place.name} · ${place.state}`);
      const base = {
        mode: "clarify", assistantMessage: "More than one verified catalogue place matches this name.",
        language: plan.language, planState: plan, quickReplies: choices, recommendations: [], actions: [],
        remainingTurns: quota.remaining, fallbackReason: null, source: "unavailable",
        batchId: null, traceId: trace
      };
      const rendered = await renderProviderTextTurn({ admin, base, plan, userMessage: message,
        verifiedContext: { result: "ambiguous_catalogue_match", choices },
        enabled, remainingTurns: quota.remaining, trace, provider: intent.provider, deadlineAt: providerDeadlineAt,
        responseLanguage });
      return await finalize(admin, user, body, rendered.response, matches.slice(0, 4), started, rendered.providerSuccess, key, quota.globalKey, origin);
    }
    const { data: attribute } = await admin.from("place_travel_attributes")
      .select("price_level,indoor_outdoor,suitable_for_children,suitable_for_groups,has_restroom,has_parking,wheelchair_accessible,opening_hours,typical_visit_minutes,field_provenance")
      .eq("place_id", top.id).maybeSingle();
    let placeInfo: Record<string, unknown>;
    let source = intent.provider; let providerModel = intent.providerModel; let fallbackReason: string | null = null;
    try {
      const factKey = await liveFactCacheKey(top.name, responseLanguage, message);
      const grounded = await readLiveFactCache(admin, factKey) || await fetchGroundedPlaceInfo({
        place: top, language: responseLanguage, userMessage: message, plan, previousPublicFacts,
        provider: intent.provider,
        geminiTimeoutMs: providerBudgetMs(providerDeadlineAt), groqTimeoutMs: providerBudgetMs(providerDeadlineAt),
        admin, traceId: trace
      });
      if (grounded.cacheStatus !== "database_hit") await writeLiveFactCache(admin, factKey,
        String(top.name), responseLanguage, grounded as Record<string, unknown>);
      placeInfo = { placeId: top.id, officialName: top.name, state: top.state, category: top.category,
        ...grounded, typicalVisitMinutes: Number(attribute?.typical_visit_minutes) || null };
      source = String(grounded.provider); providerModel = String(grounded.model);
    } catch (error) {
      if (intent.provider === "gemini") throw error;
      fallbackReason = "live_place_info_unavailable";
      placeInfo = {
        placeId: top.id, officialName: top.name, state: top.state, category: top.category,
        summary: String(top.description || `${top.name} is a verified catalogue place in ${top.state}.`),
        highlights: [], audience: [],
        practicalNotes: [], typicalVisitMinutes: Number(attribute?.typical_visit_minutes) || null,
        sources: [], checkedAt: new Date().toISOString(), sourceStatus: "database_only"
      };
      const providerFailures = error && typeof error === "object"
        && Array.isArray((error as { providerFailures?: unknown[] }).providerFailures)
        ? (error as { providerFailures: unknown[] }).providerFailures : [];
      console.warn(JSON.stringify({ event: "m6_guide_place_info_search_failure", traceId: trace,
        reason: geminiFailureReason(error), providerFailures, placeId: top.id }));
    }
    // A detail follow-up about a place already introduced earlier in this
    // conversation (as either a place_info spotlight or a recommendation
    // card) does not need the full spotlight card again - placeContext is
    // exactly "places the client has already shown" (built client-side from
    // the most recent place-focused message; see TumpangGuidePage.jsx). The
    // client renders this inline as text instead of another full card. The
    // underlying facts already avoid repeating previousPublicVenueFacts
    // (placeInfo.ts's promptFor/groqResearchPrompt), so the answer itself
    // stays specific to this question regardless of this flag.
    placeInfo.followUp = placeContext.some((item) => String(item.placeId) === String(top.id));
    const response = {
      mode: "place_info", assistantMessage: String(intent.assistantMessage || "I found current public information for this catalogue place."), language: responseLanguage, responseLanguage,
      planState: plan,
      quickReplies: [], recommendations: [], actions: [], placeInfo,
      remainingTurns: Math.max(0, quota.remaining - 1), fallbackReason, source, providerModel,
      intentProvider: intent.provider, intentConfidence: intent.confidence,
      contractVersion: "m6-guide-place-info-v1", conversationFocus: "place", batchId: null, traceId: trace
    };
    return await finalize(admin, user, body, response, [top], started, true, key, quota.globalKey, origin);
  }

  if (intent.toolName === "get_weather_forecast") {
    // Dispatches on the tool the model actually chose, not on the shared
    // "travel_info" mode all three tools produce - reading toolName here
    // consumes stage-3's decision, it never overrides it.
    //
    // Weather is a standalone factual question, not part of trip planning -
    // it must never require the traveller to answer a Travel-Brief-style
    // question (an origin/starting point) just to get an answer. So the
    // ONLY reason this ever asks a clarifying question is genuine ambiguity
    // between multiple catalogue venues sharing a name; anything else
    // (no place named, or a place that matches neither the catalogue nor
    // Malaysia's major cities) answers immediately with the best available
    // default and says so, rather than blocking on a question.
    const wantedLocation = String(intent.weatherLocationName || "").trim();
    // A clarifying question may be asked at most ONCE per exchange. If this
    // turn is already the answer to one, asking again is guaranteed to loop
    // forever - the reply runs through exactly the same resolution code that
    // just failed on it. Production caught precisely that: asked "which
    // place?", answered "melaka", asked "which place?" again, verbatim.
    const alreadyAskedForLocation = pendingClarification?.tool === "get_weather_forecast";
    let resolvedLocation: { name: string; state: string; lat: number; lng: number } | null = null;
    let clarifyChoices: string[] = [];
    if (wantedLocation) {
      const exact = placeContext.find((item) => item.name.trim().toLocaleLowerCase() === wantedLocation.toLocaleLowerCase());
      if (exact) {
        const { data: row } = await admin.from("places").select("id,name,state,lat,lng").eq("id", exact.placeId).maybeSingle();
        if (row) resolvedLocation = { name: String(row.name), state: String(row.state), lat: Number(row.lat), lng: Number(row.lng) };
      }
      // A named major city or state capital IS the answer, not a choice
      // between venues - so it must resolve BEFORE catalogue matching, not
      // after it. matchCataloguePlaces scores any venue whose name merely
      // *contains* the query at .92 (placeInfo.ts), so "Melaka" ties with
      // every catalogue venue in Melaka and "KL" with every venue whose name
      // starts "KL ...". Two .92 ties fail the confidence test, and what is
      // actually an unambiguous city question got read as venue ambiguity -
      // the exact reason the live clarify loop never terminated.
      if (!resolvedLocation) resolvedLocation = resolveMalaysianCity(wantedLocation);
      if (!resolvedLocation) {
        const { data: catalogue, error: catalogueError } = await admin.from("places")
          .select("id,name,state,category,lifecycle_state,lat,lng")
          .in("lifecycle_state", ["Active", "Provisional", "Stale"]);
        if (catalogueError) {
          return json(unavailableTurn({ traceId: trace }, plan, quota.remaining, "catalogue_unavailable", responseLanguage), 503, origin);
        }
        const matches = matchCataloguePlaces((catalogue || []) as Record<string, unknown>[], wantedLocation);
        const top = matches[0]; const second = matches[1];
        const confident = Boolean(top && (!second || (Number(top.matchScore) >= .9 && Number(top.matchScore) - Number(second.matchScore) >= .12)));
        if (top && confident) resolvedLocation = { name: String(top.name), state: String(top.state), lat: Number(top.lat), lng: Number(top.lng) };
        // Only a genuine tie between multiple catalogue venues is worth
        // asking about - a single loose/no match falls through below
        // instead of treating "found nothing" the same as "found several".
        else if (matches.length >= 2 && Number(matches[0].matchScore) >= .55 && Number(matches[1].matchScore) >= .55) {
          clarifyChoices = matches.slice(0, 4).map((place) => `${place.name} · ${place.state}`);
        }
      }
      // A tie between venues that all sit inside one city the traveller
      // actually named ("melaka city centre", "somewhere around KL") is a
      // city-level question, not a choice between venues - answer the city
      // rather than asking which landmark they meant.
      if (!resolvedLocation && clarifyChoices.length) {
        const looseCity = matchMalaysianCityInText(wantedLocation);
        if (looseCity) { resolvedLocation = looseCity; clarifyChoices = []; }
      }
      // Last resolution tier before giving up on the name: a free, keyless
      // lookup covering every Malaysian town, not just the fifteen the table
      // above happens to list. Deliberately after the catalogue tie check -
      // a genuine ambiguity between two same-named venues is still worth one
      // question, and geocoding would silently pick one of them instead.
      if (!resolvedLocation && !clarifyChoices.length) {
        resolvedLocation = await geocodeMalaysianPlace(wantedLocation, { timeoutMs: TIMEOUTS.geocode });
      }
    }
    if (clarifyChoices.length && !alreadyAskedForLocation) {
      // Deliberately NOT run through renderProviderTextTurn. Real production
      // logs caught the rewrite silently changing what question was being
      // asked - "which place should I check the forecast for?" came back
      // rephrased as "where are you starting from?", a different question
      // with no validation catching the drift (the render step only checks
      // mode/language/length, never that the meaning survived). A precise
      // one-line clarifying question needs to stay exactly what it says,
      // more than it needs AI-added warmth.
      const base = {
        mode: "clarify", assistantMessage: weatherLocationClarifyText(responseLanguage),
        language: responseLanguage, responseLanguage, planState: plan,
        quickReplies: clarifyChoices, recommendations: [], actions: [],
        remainingTurns: quota.remaining, fallbackReason: null, source: "rules", batchId: null, traceId: trace,
        pendingClarification: { tool: "get_weather_forecast", field: "locationName" }
      };
      return await finalize(admin, user, body, base, [], started, true, key, quota.globalKey, origin);
    }
    let locationWasAssumed = false;
    const unrecognizedLocationName = !resolvedLocation && wantedLocation ? wantedLocation : null;
    if (!resolvedLocation) {
      const originCoords = safeOrigin(body.originCoordinates, (plan.origin as Record<string, unknown> | null)?.label);
      resolvedLocation = originCoords
        ? { name: String((plan.origin as Record<string, unknown> | null)?.label || "your location"), state: "", lat: originCoords.lat, lng: originCoords.lng }
        : { name: DEFAULT_MALAYSIA_CITY.name, state: DEFAULT_MALAYSIA_CITY.state, lat: DEFAULT_MALAYSIA_CITY.lat, lng: DEFAULT_MALAYSIA_CITY.lng };
      locationWasAssumed = true;
    }

    const today = malaysiaToday();
    const window = resolveForecastWindow(
      String(intent.weatherStartDate || ""), String(intent.weatherEndDate || ""),
      plan.startDate ? String(plan.startDate) : null, plan.endDate ? String(plan.endDate) : null, today
    );

    let deterministicText: string;
    let travelInfoPayload: Record<string, unknown>;
    let fallbackReason: string | null = null;
    if (window.entirelyBeyondHorizon) {
      deterministicText = weatherHorizonText(responseLanguage, resolvedLocation.name, resolvedLocation.state, window.startDate);
      travelInfoPayload = { category: "weather", locationName: resolvedLocation.name, requestedStartDate: window.startDate, entirelyBeyondHorizon: true };
      fallbackReason = "forecast_beyond_horizon";
    } else {
      try {
        const forecast = await fetchGuideForecast({
          latitude: resolvedLocation.lat, longitude: resolvedLocation.lng, locationName: resolvedLocation.name,
          startDate: window.startDate, endDate: window.endDate, timeoutMs: TIMEOUTS.weather
        });
        const merged = {
          ...forecast, clampedToHorizon: window.clampedToHorizon,
          clampedFromPast: window.clampedFromPast, datesWereAssumed: window.datesWereAssumed,
          locationWasAssumed, unrecognizedLocationName
        };
        deterministicText = weatherAnswerText(responseLanguage, merged);
        travelInfoPayload = { category: "weather", ...merged };
      } catch (error) {
        console.warn(JSON.stringify({ event: "m6_guide_weather_service_failure", traceId: trace,
          reason: error instanceof Error ? error.message : String(error) }));
        deterministicText = weatherServiceDownText(responseLanguage, resolvedLocation.name, resolvedLocation.state, Number(window.startDate.slice(5, 7)));
        travelInfoPayload = { category: "weather", locationName: resolvedLocation.name, serviceUnavailable: true };
        fallbackReason = "weather_service_unavailable";
      }
    }

    const base = {
      mode: "travel_info", assistantMessage: deterministicText,
      language: responseLanguage, responseLanguage, planState: plan,
      quickReplies: [], recommendations: [], actions: [], travelInfo: travelInfoPayload,
      remainingTurns: Math.max(0, quota.remaining - 1), fallbackReason, source: "rules",
      retryable: fallbackReason === "weather_service_unavailable",
      conversationFocus: "none", batchId: null, traceId: trace
    };
    try {
      const rendered = await renderProviderTextTurn({
        admin, base, plan, userMessage: message, verifiedContext: travelInfoPayload,
        enabled, remainingTurns: quota.remaining, trace, provider: intent.provider, deadlineAt: providerDeadlineAt, responseLanguage
      });
      if (fallbackReason) {
        rendered.response.fallbackReason = fallbackReason;
        rendered.response.retryable = fallbackReason === "weather_service_unavailable";
      }
      return await finalize(admin, user, body, rendered.response, [], started, rendered.providerSuccess, key, quota.globalKey, origin);
    } catch {
      // A phrasing failure must never discard a real forecast the traveller
      // already has - the deterministic template is a complete answer.
      return await finalize(admin, user, body, base, [], started, true, key, quota.globalKey, origin);
    }
  }

  if (intent.toolName === "get_route_estimate") {
    // Defense in depth: prefer the model's own destinationName, but if this
    // turn is continuing an origin clarification for a destination that was
    // already resolved last turn (pendingClarification.destinationName) and
    // the model left its own field empty, fall back to the preserved value
    // instead of re-asking for a destination that was already answered.
    const alreadyAskedForRoute = pendingClarification?.tool === "get_route_estimate";
    const wantedDestination = String(intent.routeDestinationName
      || (alreadyAskedForRoute ? pendingClarification?.destinationName : "") || "").trim();
    let destination: { name: string; state: string; lat: number; lng: number } | null = null;
    let clarifyChoices: string[] = [];
    if (wantedDestination) {
      const exact = placeContext.find((item) => item.name.trim().toLocaleLowerCase() === wantedDestination.toLocaleLowerCase());
      if (exact) {
        const { data: row } = await admin.from("places").select("id,name,state,lat,lng").eq("id", exact.placeId).maybeSingle();
        if (row) destination = { name: String(row.name), state: String(row.state), lat: Number(row.lat), lng: Number(row.lng) };
      }
      // A city is a legitimate destination for "how long does it take to get
      // there?" even though it is not a catalogue attraction - asking for the
      // drive time to Melaka is an ordinary question, and answering it needs
      // no catalogue entry, only coordinates. (The catalogue boundary still
      // holds where it matters: this never *recommends* a place, and the
      // catalogue is still the only source of attractions.) Resolved before
      // catalogue matching for the same reason as the weather branch - a city
      // name substring-ties with every venue inside that city.
      if (!destination) destination = resolveMalaysianCity(wantedDestination);
      if (!destination) {
        const { data: catalogue, error: catalogueError } = await admin.from("places")
          .select("id,name,state,category,lifecycle_state,lat,lng")
          .in("lifecycle_state", ["Active", "Provisional", "Stale"]);
        if (catalogueError) {
          return json(unavailableTurn({ traceId: trace }, plan, quota.remaining, "catalogue_unavailable", responseLanguage), 503, origin);
        }
        const matches = matchCataloguePlaces((catalogue || []) as Record<string, unknown>[], wantedDestination);
        const top = matches[0]; const second = matches[1];
        const confident = Boolean(top && (!second || (Number(top.matchScore) >= .9 && Number(top.matchScore) - Number(second.matchScore) >= .12)));
        if (top && confident) destination = { name: String(top.name), state: String(top.state), lat: Number(top.lat), lng: Number(top.lng) };
        // Same one-question rule as the weather branch: if the traveller has
        // already answered this exact question once and the reply still does
        // not resolve confidently, take the best catalogue match rather than
        // asking again - the answer names the destination verbatim, so a
        // near-miss is visible to the traveller instead of silent.
        else if (top && alreadyAskedForRoute) destination = { name: String(top.name), state: String(top.state), lat: Number(top.lat), lng: Number(top.lng) };
        else if (matches.length) clarifyChoices = matches.slice(0, 4).map((place) => `${place.name} · ${place.state}`);
      }
      // Venue tie inside a city the traveller actually named: they asked for
      // the city, not for a choice between landmarks in it.
      if (!destination && clarifyChoices.length) {
        const looseCity = matchMalaysianCityInText(wantedDestination);
        if (looseCity) { destination = looseCity; clarifyChoices = []; }
      }
      // Same final tier as the weather branch - any Malaysian town can be a
      // destination, not only the fifteen in the offline table.
      if (!destination && !clarifyChoices.length) {
        destination = await geocodeMalaysianPlace(wantedDestination, { timeoutMs: TIMEOUTS.geocode });
      }
    }
    if (!destination && alreadyAskedForRoute) {
      // Asked once, answered, and the reply still resolves to nothing - not a
      // catalogue venue, not a city. Say what actually happened and what would
      // work instead; never ask the same question a third time.
      const base = {
        mode: "travel_info", assistantMessage: routeDestinationUnknownText(responseLanguage, wantedDestination),
        language: responseLanguage, responseLanguage, planState: plan,
        quickReplies: [], recommendations: [], actions: [],
        remainingTurns: Math.max(0, quota.remaining - 1), fallbackReason: "route_destination_not_in_catalogue",
        source: "rules", conversationFocus: "none", batchId: null, traceId: trace
      };
      return await finalize(admin, user, body, base, [], started, true, key, quota.globalKey, origin);
    }
    if (!destination) {
      // See the weather-location clarify above for why this skips
      // renderProviderTextTurn entirely.
      const base = {
        mode: "clarify", assistantMessage: routeDestinationClarifyText(responseLanguage),
        language: responseLanguage, responseLanguage, planState: plan,
        quickReplies: clarifyChoices, recommendations: [], actions: [],
        remainingTurns: quota.remaining, fallbackReason: null, source: "rules", batchId: null, traceId: trace,
        pendingClarification: { tool: "get_route_estimate", field: "destinationName" }
      };
      return await finalize(admin, user, body, base, [], started, true, key, quota.globalKey, origin);
    }

    let originCoords = safeOrigin(body.originCoordinates, (plan.origin as Record<string, unknown> | null)?.label);
    const originPlaceId = (plan.origin as Record<string, unknown> | null)?.placeId
      ? String((plan.origin as Record<string, unknown>).placeId) : null;
    let originLabel = String((plan.origin as Record<string, unknown> | null)?.label || intent.routeOriginLabel || "");

    // The clarify question below says "or just tell me the town" - so a typed
    // reply must actually be able to answer it. Production showed it could
    // not: intent.routeOriginLabel was extracted correctly but only ever used
    // for this cosmetic label string, never resolved into coordinates, so
    // every typed town name silently failed and re-asked the same question.
    // Same resolution used for the destination above; a plan/geolocation
    // origin is still checked first since it is more precise than a bare
    // typed name.
    if (!originCoords && !originPlaceId && intent.routeOriginLabel) {
      const typedOrigin = resolveMalaysianCity(intent.routeOriginLabel)
        || matchMalaysianCityInText(intent.routeOriginLabel)
        || await geocodeMalaysianPlace(intent.routeOriginLabel, { timeoutMs: TIMEOUTS.geocode });
      if (typedOrigin) { originCoords = { lat: typedOrigin.lat, lng: typedOrigin.lng }; originLabel = typedOrigin.name; }
    }

    if (!originCoords && !originPlaceId) {
      // See the weather-location clarify above for why this skips
      // renderProviderTextTurn entirely.
      const base = {
        mode: "clarify", assistantMessage: routeOriginClarifyText(responseLanguage),
        language: responseLanguage, responseLanguage, planState: plan,
        quickReplies: [], recommendations: [], actions: [],
        remainingTurns: quota.remaining, fallbackReason: null, source: "rules", batchId: null, traceId: trace,
        // destination was already established (we only reach here after the
        // destination check above passed), so it must be preserved for the
        // continuation - a bare place name reply here answers "originLabel",
        // never "which destination", even though both fields belong to the
        // same tool.
        pendingClarification: { tool: "get_route_estimate", field: "originLabel", destinationName: destination.name }
      };
      return await finalize(admin, user, body, base, [], started, true, key, quota.globalKey, origin);
    }

    const estimate = await estimateGuideRoute({
      admin, origin: originCoords, originPlaceId, originLabel: originLabel || "your starting point",
      destination, traceId: trace
    });
    const deterministicText = routeAnswerText(responseLanguage, estimate);
    const base = {
      mode: "travel_info", assistantMessage: deterministicText,
      language: responseLanguage, responseLanguage, planState: plan,
      quickReplies: [], recommendations: [], actions: [], travelInfo: { category: "route", ...estimate },
      remainingTurns: Math.max(0, quota.remaining - 1), fallbackReason: estimate.degradedReason, source: "rules",
      conversationFocus: "none", batchId: null, traceId: trace
    };
    try {
      const rendered = await renderProviderTextTurn({
        admin, base, plan, userMessage: message, verifiedContext: { category: "route", ...estimate },
        enabled, remainingTurns: quota.remaining, trace, provider: intent.provider, deadlineAt: providerDeadlineAt, responseLanguage
      });
      if (estimate.degradedReason) {
        rendered.response.fallbackReason = estimate.degradedReason;
        rendered.response.travelInfo = { category: "route", ...estimate };
      }
      return await finalize(admin, user, body, rendered.response, [], started, rendered.providerSuccess, key, quota.globalKey, origin);
    } catch {
      return await finalize(admin, user, body, base, [], started, true, key, quota.globalKey, origin);
    }
  }

  if (intent.requestedMode === "travel_info") {
    const topic = String(intent.topic || "").trim();
    if (!topic) {
      // No usable topic came through - treat this as ordinary conversation
      // rather than a failed tool call.
      const base = {
        mode: "small_talk", assistantMessage: intent.assistantMessage || "",
        language: responseLanguage, responseLanguage, planState: plan,
        quickReplies: [], recommendations: [], actions: [],
        remainingTurns: quota.remaining, fallbackReason: null, source: intent.provider,
        providerModel: intent.providerModel, intentConfidence: intent.confidence, batchId: null, traceId: trace
      };
      return await finalize(admin, user, body, base, [], started, true, key, quota.globalKey, origin);
    }
    // A related place name is only ever accepted from verifiedPlaceContext -
    // never taken as-is from the model, since that context is the server's
    // own catalogue-confirmed list, not something this call can widen.
    const requestedName = String(intent.requestedPlaceName || "").trim().toLocaleLowerCase();
    const relatedPlace = requestedName
      ? placeContext.find((item) => item.name.trim().toLocaleLowerCase() === requestedName)
      : null;
    let travelInfo: Record<string, unknown>;
    let source = intent.provider; let providerModel = intent.providerModel; let fallbackReason: string | null = null;
    try {
      const grounded = await fetchTravelInfo({
        topic, language: responseLanguage, plan, relatedPlaceName: relatedPlace?.name || null,
        provider: intent.provider,
        geminiTimeoutMs: providerBudgetMs(providerDeadlineAt), groqTimeoutMs: providerBudgetMs(providerDeadlineAt),
        admin, traceId: trace
      });
      travelInfo = { topic, ...grounded };
      source = String(grounded.provider); providerModel = String(grounded.model);
    } catch (error) {
      if (intent.provider === "gemini") throw error;
      fallbackReason = "live_place_info_unavailable";
      // intent.assistantMessage is a routing-stage draft written before the
      // search was even attempted (often just an acknowledgement echoing the
      // question back, e.g. "Checking the weather for tomorrow..."). Once
      // both providers have failed to actually check anything, showing that
      // draft as the final answer reads as a broken non-answer. Use the same
      // honest, self-aware brush-off search_boundary already has for a
      // structurally similar situation instead.
      travelInfo = { topic, summary: selfContradictedInfoBrushOff(responseLanguage), sources: [], checkedAt: new Date().toISOString() };
      const providerFailures = error && typeof error === "object"
        && Array.isArray((error as { providerFailures?: unknown[] }).providerFailures)
        ? (error as { providerFailures: unknown[] }).providerFailures : [];
      console.warn(JSON.stringify({ event: "m6_guide_travel_info_search_failure", traceId: trace,
        reason: geminiFailureReason(error), providerFailures }));
    }
    const response = {
      mode: "travel_info", assistantMessage: String(travelInfo.summary || intent.assistantMessage || ""),
      language: responseLanguage, responseLanguage, planState: plan,
      quickReplies: [], recommendations: [], actions: [], travelInfo,
      remainingTurns: Math.max(0, quota.remaining - 1), fallbackReason, source, providerModel,
      intentProvider: intent.provider, intentConfidence: intent.confidence,
      contractVersion: "m6-guide-travel-info-v1", conversationFocus: "none", batchId: null, traceId: trace
    };
    return await finalize(admin, user, body, response, [], started, true, key, quota.globalKey, origin);
  }

  if (intent.requestedMode === "help") {
    const base = {
      mode: "help",
      assistantMessage: "Explain how to use Tumpang Guide from the verified capability contract.",
      language: plan.language, planState: plan,
      quickReplies: [],
      recommendations: [], actions: [], remainingTurns: quota.remaining,
      fallbackReason: null, source: intent.provider, batchId: null, traceId: trace,
      helpSource: "capability_contract"
    };
    const rendered = await renderProviderTextTurn({ admin, base, plan, userMessage: message,
      verifiedContext: {
        guideCapabilities: VERIFIED_GUIDE_CAPABILITIES
      }, enabled, remainingTurns: quota.remaining, trace, provider: intent.provider, deadlineAt: providerDeadlineAt,
        responseLanguage });

    return await finalize(admin, user, body, rendered.response, [], started, rendered.providerSuccess, key, quota.globalKey, origin);
  }

  const requestedName = intent.requestedPlaceName || extractCatalogueRequestName(message);
  if (intent.requestedMode === "catalogue_missing" && requestedName) {
    return await namedPlaceGuardResponse({
      admin, user, body, plan: planBeforeIntent, trace, started, quota, origin,
      kind: "missing", language: namedPlaceResponseLanguage(message, plan.language)
    });
  }

  const missing = missingField(plan);
  if (missing) {
    const clarification = resolveClarificationField(plan, intent.nextQuestionField);
    const assistantMessage = String(intent.assistantMessage || "").trim();
    if (!clarification.providerFieldValid || !assistantMessage) {
      const base = {
        mode: "clarify",
        assistantMessage: "Ask one natural question for the verified missing field.",
        language: plan.language, responseLanguage, planState: plan,
        quickReplies: quickReplies(clarification.field, responseLanguage),
        recommendations: [], actions: [], remainingTurns: quota.remaining,
        fallbackReason: null, source: "unavailable",
        nextQuestionField: clarification.field, batchId: null, traceId: trace
      };
      const rendered = await renderProviderTextTurn({
        admin, base, plan, userMessage: message,
        verifiedContext: {
          understoodRequest: {
            recommendationMode: plan.recommendationMode,
            preferredCategories: plan.preferredCategories
          },
          askForExactlyOneField: clarification.field,
          otherMissingFieldsForLaterTurns: clarification.missing.filter((field) => field !== clarification.field)
        },
       enabled, remainingTurns: quota.remaining, trace, provider: intent.provider, deadlineAt: providerDeadlineAt,
       responseLanguage
      });
      return await finalize(admin, user, body, rendered.response, [], started,
        rendered.providerSuccess, key, quota.globalKey, origin);
    }
    const base = {
      mode: "clarify",
      assistantMessage,
       language: plan.language, responseLanguage,
       planState: plan, quickReplies: quickReplies(clarification.field, responseLanguage), recommendations: [], actions: [],
      remainingTurns: Math.max(0, quota.remaining - 1), fallbackReason: null, source: intent.provider,
      providerModel: intent.providerModel, intentConfidence: intent.confidence,
      needsConfirmation: intent.needsConfirmation, nextQuestionField: clarification.field, batchId: null, traceId: trace
    };
    return await finalize(admin, user, body, base, [], started, true, key, quota.globalKey, origin);
  }

  const interestQuery = plan.startDate && plan.endDate
    ? admin.from("place_interest").select("place_id,user_id,travel_date").gte("travel_date", plan.startDate).lte("travel_date", plan.endDate)
    : Promise.resolve({ data: [], error: null });
  const [placeResult, rideResult, attributeResult, interestResult] = await Promise.all([
    admin.from("places").select("id,source_place_id,name,category,rating,review_count,state,lifecycle_state,lat,lng").in("lifecycle_state", ["Active", "Provisional", "Stale"]),
    admin.from("rides").select("destination_place_id,departure_at,seats_total,seats_available,status").in("status", ["Published", "Matched"]),
    admin.from("place_travel_attributes").select("place_id,price_level,indoor_outdoor,suitable_for_children,suitable_for_groups,has_restroom,has_parking,wheelchair_accessible,opening_hours,field_provenance,review_soft_signals,review_signals_observed_at"),
    interestQuery
  ]);
  if (placeResult.error) {
    console.error(JSON.stringify({ event: "m6_guide_catalogue_failure", traceId: trace,
      stage: "recommendation_places", code: String(placeResult.error.code || "database_error").slice(0, 80) }));
    return json(unavailableTurn({ traceId: trace }, plan, quota.remaining, "catalogue_unavailable", namedPlaceResponseLanguage(message, plan.language)), 503, origin);
  }
  const places = placeResult.data || [];
  const rides = rideResult.data || [];
  const attributes = attributeResult.data || [];
  const interests = interestResult.data || [];
  const retrievalWarnings = [
    rideResult.error ? "rides_unavailable" : "",
    attributeResult.error ? "place_attributes_unavailable" : "",
    interestResult.error ? "interests_unavailable" : ""
  ].filter(Boolean);
  if (retrievalWarnings.length) console.warn(JSON.stringify({ event: "m6_guide_optional_retrieval_failure",
    traceId: trace, warnings: retrievalWarnings }));
  const originCoordinates = safeOrigin(body.originCoordinates, (plan.origin as Record<string, unknown> | null)?.label);
  const weatherMode = String(qa.weather || "live");
  const weather = weatherMode !== "live"
    ? qaWeatherByPlace((places || []) as Record<string, unknown>[], weatherMode)
    : plan.startDate && plan.endDate
      ? await fetchControlledWeather(places || [], String(plan.startDate), String(plan.endDate))
      : new Map();
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
    const base = {
      mode: "recommend", assistantMessage: rulesCopy.noCandidates, language: plan.language, responseLanguage,
      planState: plan, quickReplies: rulesCopy.quickReplies, recommendations: [], actions: [],
      remainingTurns: quota.remaining, fallbackReason: "no_verified_candidates", source: intent.provider,
      providerModel: intent.providerModel, batchId: null, traceId: trace
    };
    const rendered = await renderProviderTextTurn({
      admin, base, plan, userMessage: message,
      verifiedContext: { result: "no_verified_candidates", constraints: plan },
       enabled, remainingTurns: quota.remaining, trace, provider: intent.provider, deadlineAt: providerDeadlineAt,
       responseLanguage
    });
    return await finalize(admin, user, body, rendered.response, [], started, rendered.providerSuccess, key, quota.globalKey, origin);
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
    const response = {
      mode: "fallback", assistantMessage: "The AI response timed out. Your plan and selected catalogue batch are safe—please retry.",
      language: plan.language, planState: plan, quickReplies: [], recommendations: [], actions: [],
      remainingTurns: quota.remaining, fallbackReason: "timeout", source: "unavailable",
      retryable: true, batchId, traceId: trace
    };
    return await finalize(admin, user, body, response, candidates, started, false, key, quota.globalKey, origin);
  }
  if (qaLatencyMs > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(qaLatencyMs, 9_000)));

  const forcedFallback = String(qa.forceFallback || "");
  if (qaAllowed && (QA_FALLBACK_REASONS.has(forcedFallback) || qa.rejectUnknownPlace === true)) {
    const reason = qa.rejectUnknownPlace === true ? "place_not_allowlisted"
      : forcedFallback === "invalid_json" ? "invalid_json_shape" : forcedFallback;
    const response = {
      mode: "fallback", assistantMessage: "Both AI providers failed validation. Your travel brief is unchanged—please retry.",
      language: plan.language, planState: plan, quickReplies: [], recommendations: [], actions: [],
      remainingTurns: quota.remaining, fallbackReason: reason, source: "unavailable",
      retryable: true, batchId, traceId: trace
    } as Record<string, unknown>;
    (response as Record<string, unknown>).validation = qa.rejectUnknownPlace === true
      ? { valid: false, reason, rejectedPlaceId: "qa-place-outside-catalogue" }
      : { valid: false, reason };
    return await finalize(admin, user, body, response, candidates, started, false, key, quota.globalKey, origin);
  }
  const categoryCounts = historyCategories.reduce((counts: Record<string, number>, category) => {
    counts[category] = (counts[category] || 0) + 1; return counts;
  }, {});
  const prompt = JSON.stringify({
    instruction: `You are Tumpang Guide's friendly Malaysian travel concierge. The server has already selected an immutable catalogue batch. You do not choose places or rankings. assistantMessage must be ONE short introductory sentence for the whole batch (for example naming the count and category/occasion) - it must NOT describe, summarize or list the individual places one by one; that per-place writing belongs only in recommendationCopy. For each supplied Place ID, write one vivid, traveller-centred reason, one fuller explanation of why it fits this specific plan, and one honest trade-off using only supplied verified facts, as separate recommendationCopy entries - never repeat that same material inside assistantMessage. Explain the experience and practical value; never mention algorithms, weights, scores, reason codes or internal rules. Do not invent activities, opening hours, prices, routes, safety guarantees or live conditions. Preserve official place names exactly. No web or map search is available in this recommendation-writing step; later place questions use a separately verified live-information flow. Return exactly one copy item for every supplied Place ID and no others. Write every human-facing sentence in responseLanguage without mixing English UI labels into another language, except official names, brands, dates and numbers.`,
    responseLanguage,
    promptVersion: PROMPT_VERSION,
    planState: { ...plan, tripHistoryConsent: Boolean(user && plan.tripHistoryConsent) },
    tripHistorySummary: plan.tripHistoryConsent && user ? { completedCategoryCounts: categoryCounts } : null,
    recentMessages, userMessage: message,
    immutableRecommendations: ruleBatch.map((item) => ({ placeId: item.placeId, role: item.role })),
    candidates: ruleBatch.map((item) => {
      const candidate = candidates.find((row) => String(row.id) === String(item.placeId)) || {};
      return {
        placeId: candidate.id, officialName: candidate.name,
        verifiedFacts: {
          category: candidate.category, state: candidate.state,
          requestedCategories: plan.preferredCategories,
          rating: candidate.rating, reviewCount: candidate.review_count,
          hasPublishedRide: candidate.hasRide, availableSeats: candidate.availableSeats,
          distanceKm: candidate.distanceKm, weatherAdvisory: candidate.weatherAdvisory,
          selectedDate: plan.startDate, partySize: plan.partySize
        }
      };
    }),
    allowedActions: []
  });

  try {
    const result = await callProviderChain({
      prompt, responseSchema: RECOMMENDATION_COPY_SCHEMA, maxOutputTokens: 1000,
      primary: intent.provider, secondary: intent.provider,
      timeoutMs: providerBudgetMs(providerDeadlineAt, TIMEOUTS.recommendationCopy),
      admin, stage: "recommendation_copy", traceId: trace,
      validate: (generated) => {
        const copyRows = Array.isArray(generated.recommendationCopy)
          ? generated.recommendationCopy as Array<Record<string, unknown>> : [];
        const expectedIds = ruleBatch.map((item) => String(item.placeId));
        const actualIds = copyRows.map((item) => String(item.placeId));
        return String(generated.language || "") === responseLanguage
          && String(generated.assistantMessage || "").trim().length > 0
          && copyRows.length === ruleBatch.length
          && JSON.stringify(actualIds) === JSON.stringify(expectedIds)
          && new Set(actualIds).size === actualIds.length
          && copyRows.every((item) => ["personalizedReason", "personalizedWhy", "personalizedTradeoff"]
            .every((field) => String(item[field] || "").trim().length > 0));
      }
    });
    const generated = result.value;
    const copyRows = generated.recommendationCopy as Array<Record<string, unknown>>;
    const copyByPlaceId = new Map(copyRows.map((item) => [String(item.placeId), item]));
    const recommendations = ruleBatch.map((item) => {
      const copy = copyByPlaceId.get(String(item.placeId)) || {};
      return {
        ...item,
        personalizedReason: String(copy.personalizedReason || "").trim(),
        personalizedWhy: String(copy.personalizedWhy || "").trim(),
        personalizedTradeoff: String(copy.personalizedTradeoff || "").trim()
      };
    });
    const response = {
      mode: "recommend",
      assistantMessage: String(generated.assistantMessage || "").trim(),
      language: plan.language, responseLanguage, planState: plan,
      quickReplies: Array.isArray(generated.quickReplies) ? generated.quickReplies.slice(0, 3) : [],
      recommendations, actions: [], source: result.provider,
      providerModel: result.model, intentProvider: intent.provider, intentConfidence: intent.confidence, batchId,
      remainingTurns: Math.max(0, quota.remaining - 1), fallbackReason: null, traceId: trace,
      ...(retrievalWarnings.length ? { operationalWarnings: retrievalWarnings } : {})
    };
    return await finalize(admin, user, body, response, candidates, started, true, key, quota.globalKey, origin);
  } catch (error) {
    const reason = geminiFailureReason(error);
    console.warn(JSON.stringify({ event: "m6_guide_provider_failure", traceId: trace, model: "provider-chain",
      reason, status: Number((error as Error & { status?: number })?.status || 0) || null,
      providerFailures: safeProviderFailures(error) }));
    throw error;
  }
}

async function handleTurn(
  admin: ReturnType<typeof createClient>, user: { id: string } | null,
  body: Record<string, unknown>, origin: string | null, qaAllowed = false, requestActor?: string
) {
  const failures: Array<{ provider: string; reason: string; status: number }> = [];
  const turnTrace = traceId();
  const plan = sanitizePlanState(body.planState) as Record<string, unknown>;
  const key = requestActor || await actorKey(user?.id || null, body.visitorSessionId,
    Deno.env.get("M6_GUIDE_VISITOR_PEPPER") || "m6-guide-local");
  let quota: GuideTurnQuota;
  try {
    // Reserve one logical Guide turn before the provider loop. Gemini and Groq
    // are two attempts belonging to the same clientTurnId, not two user turns.
    quota = await checkQuota(admin, key, user?.id || null, {
      userLimit: 2_000_000_000,
      guestLimit: numericEnv("M6_GUIDE_GUEST_DAILY_CAP", 3),
      globalLimit: numericEnv("M6_GUIDE_GLOBAL_DAILY_CAP", 1000),
      burstLimit: user ? 2_000_000_000 : numericEnv("M6_GUIDE_ACTOR_BURST_CAP", 4),
      globalBurstLimit: numericEnv("M6_GUIDE_GLOBAL_BURST_CAP", 120)
    });
  } catch {
    return json(unavailableTurn({ traceId: turnTrace }, plan, user ? 2_000_000_000 : 3, "quota_unavailable", namedPlaceResponseLanguage(String(body.message || ""), plan.language)), 503, origin);
  }
  if (!quota.allowed) {
    const answerLanguage = namedPlaceResponseLanguage(String(body.message || ""), plan.language);
    const quotaCopy = guideRulesCopy(answerLanguage);
    // A guest's own daily cap (quota.reason === "rate_limit" while signed
    // out) is the "you've used your 3 free recommendations" moment, and gets
    // a warm, sign-in-inviting message distinct from the generic busy/burst
    // copy. Signed-in users effectively never hit this branch (their limit
    // is unbounded); the shared burst/global caps keep the app-wide default.
    const isGuestDailyLimit = !user && quota.reason === "rate_limit";
    const fallbackReason = isGuestDailyLimit ? "guest_recommendation_limit" : quota.reason;
    const assistantMessage = quota.reason === "burst_limit" ? quotaCopy.burst
      : isGuestDailyLimit ? quotaCopy.guestQuota : quotaCopy.quota;
    return json({
    mode: "fallback", assistantMessage,
    language: answerLanguage, responseLanguage: answerLanguage, planState: plan, quickReplies: [], recommendations: [], actions: [],
    remainingTurns: quota.remaining, fallbackReason,
    source: isGuestDailyLimit ? "quota" : "unavailable",
    retryable: quota.reason === "burst_limit", traceId: turnTrace
    }, 429, origin);
  }
  const turnContext: GuideTurnContext = { key, quota };
  for (const provider of [PROVIDERS.primary, PROVIDERS.secondary]) {
    const model = provider === "gemini"
      ? Deno.env.get("M6_GUIDE_GEMINI_MODEL")?.trim() || "gemini-3.7-flash"
      : Deno.env.get("M6_GUIDE_GROQ_MODEL")?.trim() || "openai/gpt-oss-20b";
    if (await providerInCooldown(admin, provider)) {
      failures.push({ provider, reason: "provider_cooldown", status: 429 });
      await recordProviderAttempt(admin, { traceId: turnTrace, clientTurnId: String(body.clientTurnId || ""),
        provider, model, stage: "turn", outcome: "skipped", status: 429, latencyMs: 0, reason: "provider_cooldown" });
      continue;
    }
    const attemptStarted = performance.now();
    try {
      // The client's own request timeout is 110s (GUIDE_LIMITS.REQUEST_TIMEOUT_MS)
      // and this outer loop can spend this budget twice (primary provider,
      // then secondary) - 45s each left very little slack for the heaviest
      // path (place_info's live grounded search) and, at 2x45s, was already
      // close to the client's own ceiling. 50s keeps the 2x worst case under
      // that ceiling with margin while giving a genuinely slow (not quota-
      // exhausted) attempt more room to actually finish instead of aborting.
      const response = await handleTurnAttempt(admin, user, {
        ...body, __ownedProvider: provider, __providerDeadlineAt: Date.now() + 50_000
      }, origin, turnContext, qaAllowed);
      const responsePayload = await response.clone().json().catch(() => ({}));
      const routeGuardHandled = response.headers.get("x-tumpang-guide-route-guard") === "1";
      await recordProviderAttempt(admin, { traceId: String(responsePayload?.traceId || turnTrace), clientTurnId: String(body.clientTurnId || ""),
        provider, model, stage: routeGuardHandled ? "named_place_guard" : "turn",
        outcome: routeGuardHandled ? "skipped" : "success", latencyMs: performance.now() - attemptStarted,
        reason: routeGuardHandled ? "catalogue_route_guard" : undefined });
      return response;
    } catch (error) {
      failures.push({ provider, reason: geminiFailureReason(error),
        status: Number((error as Error & { status?: number })?.status || 0) });
      console.warn(JSON.stringify({ event: "m6_guide_provider_turn_failure", provider,
        reason: geminiFailureReason(error), status: failures.at(-1)?.status || null }));
      await recordProviderAttempt(admin, { traceId: turnTrace, clientTurnId: String(body.clientTurnId || ""),
        provider, model, stage: "turn", outcome: "failure", status: failures.at(-1)?.status,
        latencyMs: performance.now() - attemptStarted, reason: failures.at(-1)?.reason,
        retryAfterSeconds: Number((error as Error & { retryAfterSeconds?: number })?.retryAfterSeconds) || undefined });
    }
  }
  const answerLanguage = namedPlaceResponseLanguage(String(body.message || ""), plan.language);
  return json({
    mode: "fallback", assistantMessage: aiUnavailableMessage(answerLanguage), language: answerLanguage,
    responseLanguage: answerLanguage,
    planState: plan, quickReplies: [], recommendations: [], actions: [], remainingTurns: quota.remaining,
    fallbackReason: failures.at(-1)?.reason || "provider_unavailable", fallbackUsed: true,
    source: "unavailable", retryable: true, batchId: null, traceId: traceId()
  }, 200, origin);
}

async function finalize(
  admin: ReturnType<typeof createClient>, user: { id: string } | null,
  requestBody: Record<string, unknown>, response: Record<string, unknown>, candidates: Record<string, unknown>[],
  started: number, providerSuccess: boolean, key: string, globalKey: string, origin: string | null
) {
  // Single choke point every response passes through: a search-tool answer
  // (place_info/travel_info) may never carry a recommendation card or an
  // executable action. Both branches already build recommendations/actions
  // as empty arrays server-side rather than copying model output into them,
  // so this should never actually trigger - it exists to catch a future code
  // change that breaks that invariant, loudly rather than silently.
  const searchBoundary = assertNoCardsOrActionsFromSearch(response.mode, response);
  if (!searchBoundary.valid) {
    console.error(JSON.stringify({ event: "m6_guide_search_boundary_violation", traceId: String(response.traceId || ""),
      mode: String(response.mode || ""), reason: searchBoundary.reason }));
    response.recommendations = [];
    response.actions = [];
    response.fallbackReason = searchBoundary.reason;
  }
  // Separate, narrower safety net: the routing prompt can still lose to
  // conversation momentum on real models and pick search_catalogue for a
  // pure weather/transport question, but the model's own drafted
  // assistantMessage often gives itself away by admitting it can't check
  // real-time conditions while still attaching a recommendation batch. This
  // never changes what tool a confident answer used - it only drops cards
  // from a response whose own wording already disowns them.
  const selfContradiction = detectSelfContradictedInfoRecommendation(response.mode, response);
  if (selfContradiction.matched) {
    console.warn(JSON.stringify({ event: "m6_guide_self_contradicted_info_recommendation",
      traceId: String(response.traceId || "") }));
    response.recommendations = [];
    response.actions = [];
    response.mode = "small_talk";
    response.batchId = null;
    response.fallbackReason = selfContradiction.reason;
    // The drafted text was written to lead into the now-removed cards ("...
    // but here are some places!"), so leaving it in place would read as a
    // broken half-answer once those cards are gone. Replace it with an
    // intentional, self-aware brush-off instead.
    response.assistantMessage = selfContradictedInfoBrushOff(
      String(response.responseLanguage || response.detectedLanguage || response.language || "en")
    );
  }
  response.clientTurnId = validUuid(requestBody.clientTurnId) ? requestBody.clientTurnId : null;
  response.detectedLanguage = String(response.detectedLanguage || response.responseLanguage || response.language || (response.planState as Record<string, unknown> | undefined)?.language || "en");
  response.responseLanguage = String(response.responseLanguage || response.detectedLanguage);
  response.uiLanguageChange = response.uiLanguageChange || null;
  response.supersedesTraceId = response.supersedesTraceId || null;
  // Every response clears pendingClarification unless a weather/route
  // clarify branch explicitly set one. This is what stops stale
  // continuation state from leaking into an unrelated later turn - a
  // successful weather/route answer, or any other mode entirely, always
  // resets it, so the client only ever echoes back a clarification that is
  // still actually pending.
  response.pendingClarification = response.pendingClarification || null;
  if (!response.conversationFocus) {
    response.conversationFocus = response.mode === "place_info" ? "place"
      : response.mode === "recommend" ? "recommendation_batch"
        : response.mode === "help" ? "capabilities"
          : response.mode === "action" ? "action"
            : response.mode === "emergency" ? "emergency" : "none";
  }
  response.fallbackUsed = Boolean(response.fallbackReason);
  response.sources = response.sources || (response.placeInfo as Record<string, unknown> | undefined)?.sources
    || (response.externalPlaceInfo as Record<string, unknown> | undefined)?.sources || [];
  response.toolResults = [{
    type: String(response.mode || "unknown"),
    cataloguePlaceCount: Array.isArray(response.recommendations) ? response.recommendations.length
      : response.placeInfo ? 1 : 0,
    external: Boolean(response.externalPlaceInfo)
  }];
  const latency = Math.max(0, Math.round(performance.now() - started));
  const candidateIds = candidates.map((item) => String(item.id)).filter(validUuid);
  const validation = response.validation && typeof response.validation === "object" ? response.validation : { valid: true };
  const providerModel = providerSuccess ? String(response.providerModel || MODEL) : "unavailable";
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
        p_model_name: providerModel,
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
            p_model_name: providerModel,
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
        p_model_name: providerModel,
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
  // A guest's 3 free uses are spent by an actual recommendation batch, not
  // by chatting, asking about a named place, or a search-augmented answer —
  // those stay free/unlimited even for guests. Signed-in users have no
  // meaningful daily cap (userLimit is effectively infinite), so recording
  // every signed-in success is harmless and keeps their usage history intact.
  const isRecommendationBatch = response.mode === "recommend"
    && Array.isArray(response.recommendations) && response.recommendations.length > 0;
  if (providerSuccess && (user || isRecommendationBatch)) {
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
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = secretKey();
  if (!url || !key) return json({ error: "Server database access is not configured." }, 503, origin);
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const contentType = request.headers.get("content-type") || "";
  if (contentType.toLowerCase().startsWith("multipart/form-data")) {
    const voiceTrace = traceId();
    const form = await request.formData().catch(() => null);
    if (!form || form.get("operation") !== "transcribe") return json({ error: "A valid transcription form is required." }, 400, origin);
    const user = await optionalUser(admin, request);
    const audio = form.get("audio");
    if (!(audio instanceof File)) return json({ error: "An audio recording is required.", reason: "audio_missing" }, 400, origin);
    try {
      const actor = await actorKey(user?.id || null, form.get("visitorSessionId"), Deno.env.get("M6_GUIDE_VISITOR_PEPPER") || "m6-guide-local");
      const voiceActorKey = `voice:${actor}`;
      const voiceQuota = await checkQuota(admin, voiceActorKey, user?.id || null, {
        userLimit: 2_000_000_000,
        globalLimit: numericEnv("M6_GUIDE_GLOBAL_DAILY_CAP", 1000),
        burstLimit: user ? 2_000_000_000 : numericEnv("M6_GUIDE_ACTOR_BURST_CAP", 4),
        globalBurstLimit: numericEnv("M6_GUIDE_VOICE_GLOBAL_BURST_CAP", 20),
        globalKey: "global:m6-tumpang-guide-voice"
      });
      if (!voiceQuota.allowed) return json({
        error: "Voice transcription is busy. Please retry shortly.", reason: voiceQuota.reason, traceId: voiceTrace
      }, 429, origin);
      const result = await transcribeGuideAudio({
        apiKey: Deno.env.get("GROQ_API_KEY")?.trim() || "",
        audio,
        languageHint: String(form.get("languageHint") || "auto"),
        timeoutMs: boundedTimeout("M6_GUIDE_TRANSCRIPTION_TIMEOUT_MS", 45_000)
      });
      return json({ ...result, source: "groq", traceId: voiceTrace }, 200, origin);
    } catch (error) {
      const status = Number((error as Error & { status?: number })?.status || 0);
      const code = String((error as Error & { code?: string })?.code || "");
      const reason = code === "transcription_low_confidence" ? code
        : (error instanceof Error || error instanceof DOMException) && error.name === "AbortError" ? "timeout"
          : status === 429 ? "provider_429" : status >= 400 ? "transcription_provider_error" : "transcription_failed";
      console.warn(JSON.stringify({ event: "m6_guide_transcription_failure", traceId: voiceTrace,
        edgeVersion: EDGE_VERSION, reason, status: status || null, userId: user?.id || null }));
      return json({ error: reason === "transcription_low_confidence"
        ? "The transcription was too uncertain to use." : "Voice transcription is temporarily unavailable.",
      reason, traceId: voiceTrace }, status === 429 ? 429 : reason === "transcription_low_confidence" ? 422 : 503, origin);
    }
  }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return json({ error: "A JSON request body is required." }, 400, origin);
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
  const clientTurnId = validUuid(body.clientTurnId) ? String(body.clientTurnId) : crypto.randomUUID();
  const requestActor = await actorKey(user?.id || null, body.visitorSessionId,
    Deno.env.get("M6_GUIDE_VISITOR_PEPPER") || "m6-guide-local");
  const claim = await claimGuideTurn(admin, requestActor, clientTurnId, traceId());
  if (claim.state === "complete" && claim.response) {
    return json({ ...(claim.response as Record<string, unknown>), clientTurnId, replayed: true }, 200, origin);
  }
  if (claim.state === "processing") {
    return json({ mode: "processing", clientTurnId, retryAfterMs: Number(claim.retryAfterMs) || 1200 }, 202, origin);
  }
  try {
    const response = await handleTurn(admin, user, { ...body, clientTurnId }, origin,
      isLocalQaOrigin(origin) || qaUserAllowlisted(user), requestActor);
    const payload = await response.clone().json().catch(() => null);
    // A provider outage, quota response or invalid-output fallback is not a
    // successful turn. Keep the lease record retryable so the Retry button
    // can safely reuse the same clientTurnId and execute the provider chain
    // again instead of replaying the cached outage forever.
    const retryableFailure = Boolean(payload && typeof payload === "object"
      && (payload as Record<string, unknown>).retryable === true
      && (payload as Record<string, unknown>).source === "unavailable");
    if (payload && typeof payload === "object") {
      if (retryableFailure) await failGuideTurn(admin, claim.lease);
      else await completeGuideTurn(admin, claim.lease, { ...payload, clientTurnId });
    }
    return payload && typeof payload === "object" ? json({ ...payload, clientTurnId }, response.status, origin) : response;
  } catch (error) {
    await failGuideTurn(admin, claim.lease);
    throw error;
  }
}

export default { fetch: async (request: Request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (request.method !== "POST") return json({ error: "POST required" }, 405, origin);
  try { return await handle(request); }
  catch (error) {
    const trace = traceId();
    const status = Number((error as Error & { status?: number })?.status || 0);
    const code = String((error as Error & { code?: string })?.code || "unexpected_error").slice(0, 80);
    console.error(JSON.stringify({ event: "m6_guide_unhandled_failure", traceId: trace,
      edgeVersion: EDGE_VERSION, status: status || 500, code,
      message: String(error instanceof Error ? error.message : error || "Unexpected error").slice(0, 360) }));
    if (status === 401 || code === "auth_session_invalid") {
      return json({ error: "Your signed-in session has expired. Please sign in again.",
        reason: "auth_session_invalid", traceId: trace }, 401, origin);
    }
    return json({ error: "The Guide could not complete this request.",
      reason: "unexpected_error", traceId: trace }, status >= 400 && status < 600 ? status : 500, origin);
  }
} };
