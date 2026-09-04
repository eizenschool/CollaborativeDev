import { callGemini } from "./gemini.ts";
import { sanitizePlanState } from "./policy.ts";
import { providerInCooldown, recordProviderAttempt } from "./reliability.ts";

type AdminClient = Parameters<typeof providerInCooldown>[0];

export const INTENT_FIELDS = [
  "origin", "party", "date", "preference", "budget", "indoorPreference",
  "accessibilityRequired", "children", "recommendationMode", "requestedMode", "language"
] as const;

export const VERIFIED_GUIDE_CAPABILITIES = Object.freeze({
  product: "Tumpang Guide",
  conversation: [
    "Understands natural free-form travel messages, including shorthand, typos, mixed languages and follow-up replies.",
    "Asks only for planning details that materially affect the requested result.",
    "May switch the complete interface language after a clear high-confidence language change."
  ],
  travelPlanning: [
    "Recommends only active places already present in the Let's Tumpang catalogue.",
    "Uses the traveller's date, origin, group size and interests to retrieve and rank catalogue candidates.",
    "Explains why a recommended place fits and states a practical trade-off without exposing internal scoring."
  ],
  placeQuestions: [
    "Can research current public information for one catalogue-matched place and show sources and the checked time.",
    "If a named place is not in the catalogue, the Guide gives a fixed catalogue-only refusal and does not search the web or create any card or app action."
  ],
  appActions: [
    "Can prepare supported actions such as saving an interest, creating a ride alert or saving preferences.",
    "Actions that change account data require the user to confirm before they run."
  ],
  persistence: [
    "Signed-in users can return to private Past plans and delete them.",
    "Guest conversations stay in the browser session and are not saved as account history."
  ]
});

export function unresolvedPlanFields(plan: Record<string, unknown>) {
  const fields: string[] = [];
  if (!plan.origin) fields.push("origin");
  if (!Array.isArray(plan.preferredCategories) || !plan.preferredCategories.length) fields.push("preference");
  return fields;
}

export function resolveClarificationField(plan: Record<string, unknown>, providerField: unknown) {
  const missing = unresolvedPlanFields(plan);
  const requested = String(providerField || "");
  return {
    field: missing.includes(requested) ? requested : (missing[0] || ""),
    providerFieldValid: missing.includes(requested),
    missing
  };
}

const CONFIDENCE_PROPERTIES = Object.fromEntries(INTENT_FIELDS.map((field) => [field, {
  type: "number", minimum: 0, maximum: 1
}]));

export const INTENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["intentPatch", "confidence", "needsConfirmation", "nextQuestionField", "language", "languageConfidence", "switchLanguage", "assistantMessage"],
  properties: {
    intentPatch: {
      type: "object", additionalProperties: false,
      required: [
        "originLabel", "partySize", "startDate", "endDate", "preferredCategories",
        "budget", "indoorPreference", "accessibilityRequired", "children",
        "recommendationMode", "requestedMode", "requestedPlaceName", "requestedAction"
      ],
      properties: {
        originLabel: { type: "string", maxLength: 80 },
        partySize: { type: "integer", minimum: 0, maximum: 20 },
        startDate: { type: "string", maxLength: 10 },
        endDate: { type: "string", maxLength: 10 },
        preferredCategories: { type: "array", maxItems: 4, items: { type: "string", enum: ["culinary", "heritage", "nature", "event"] } },
        budget: { type: "string", enum: ["unspecified", "free", "low", "medium", "premium"] },
        indoorPreference: { type: "string", enum: ["unspecified", "indoor", "outdoor", "either"] },
        accessibilityRequired: { type: "boolean" },
        children: { type: "boolean" },
        recommendationMode: { type: "string", enum: ["unspecified", "default", "different", "quieter", "expanded"] },
        requestedMode: { type: "string", enum: ["unspecified", "recommend", "help", "small_talk", "action", "place_info", "catalogue_missing", "emergency"] },
        requestedPlaceName: { type: "string", maxLength: 120 },
        requestedAction: { type: "string", enum: ["unspecified", "record_interest", "register_ride_alert", "save_preferences"] }
      }
    },
    confidence: {
      type: "object", additionalProperties: false,
      required: [...INTENT_FIELDS], properties: CONFIDENCE_PROPERTIES
    },
    needsConfirmation: { type: "array", maxItems: 4, items: { type: "string", enum: [...INTENT_FIELDS] } },
    nextQuestionField: { type: "string", enum: ["unspecified", "date", "origin", "party", "preference"] },
    language: { type: "string", maxLength: 24 },
    languageConfidence: { type: "number", minimum: 0, maximum: 1 },
    switchLanguage: { type: "boolean" },
    assistantMessage: { type: "string", maxLength: 1200 }
  }
};

export const RECOMMENDATION_COPY_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["assistantMessage", "language", "recommendationCopy", "quickReplies"],
  properties: {
    // One short intro sentence for the batch, not a per-place description -
    // that belongs in recommendationCopy below. 1200 was generous enough to
    // let the model write a full paragraph describing every place a second
    // time, duplicating what the cards already show; 260 leaves room for a
    // single sentence across every supported language without permitting a
    // list.
    assistantMessage: { type: "string", maxLength: 260 },
    language: { type: "string", maxLength: 24 },
    recommendationCopy: {
      type: "array", minItems: 1, maxItems: 3,
      items: {
        type: "object", additionalProperties: false,
        required: ["placeId", "personalizedReason", "personalizedWhy", "personalizedTradeoff"],
        properties: {
          placeId: { type: "string" },
          personalizedReason: { type: "string", maxLength: 360 },
          personalizedWhy: { type: "string", maxLength: 900 },
          personalizedTradeoff: { type: "string", maxLength: 280 }
        }
      }
    },
    quickReplies: { type: "array", maxItems: 3, items: { type: "string" } }
  }
};

export const GUIDE_RENDER_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["mode", "assistantMessage", "language", "quickReplies", "recommendations", "actions"],
  properties: {
    mode: { type: "string", enum: ["clarify", "recommend", "help", "small_talk", "action", "place_info", "travel_info", "catalogue_missing", "emergency", "fallback"] },
    assistantMessage: { type: "string", maxLength: 1600 },
    language: { type: "string", maxLength: 24 },
    quickReplies: { type: "array", maxItems: 4, items: { type: "string" } },
    recommendations: {
      type: "array", maxItems: 3,
      items: {
        type: "object", additionalProperties: false,
        required: ["placeId", "role", "verifiedReasonCodes", "tradeoffCode"],
        properties: {
          placeId: { type: "string" },
          role: { type: "string", enum: ["best_match", "practical_alternative", "wildcard"] },
          verifiedReasonCodes: { type: "array", items: { type: "string" } },
          tradeoffCode: { type: "string" }
        }
      }
    },
    actions: { type: "array", maxItems: 0, items: { type: "string" } }
  }
};

export type ProviderName = "gemini" | "groq";

export type ProviderResult = {
  provider: ProviderName;
  model: string;
  value: Record<string, unknown>;
};

function providerError(message: string, status = 0) {
  const error = new Error(message) as Error & { status?: number; code?: string; provider?: string };
  error.status = status;
  return error;
}

function cleanProviderDetail(value: unknown) {
  return String(value || "")
    .replace(/(key|token|authorization)\s*[=:]\s*[^\s,;]+/giu, "$1=[redacted]")
    .replace(/https?:\/\/[^\s]+/giu, "[provider-url]")
    .replace(/\s+/g, " ").trim().slice(0, 360);
}

async function providerResponseError(provider: ProviderName, response: Response) {
  let detail = "";
  let code = "";
  try {
    const body = await response.clone().json();
    const row = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const nested = row.error && typeof row.error === "object" ? row.error as Record<string, unknown> : {};
    detail = cleanProviderDetail(nested.message || row.message || nested.type || row.error);
    code = cleanProviderDetail(nested.code || row.code || nested.type);
  } catch {
    try { detail = cleanProviderDetail(await response.text()); } catch { /* Provider body is optional. */ }
  }
  const error = providerError(`${provider} ${response.status}${detail ? `: ${detail}` : ""}`, response.status) as Error & {
    code?: string; provider?: ProviderName
  };
  error.code = code;
  error.provider = provider;
  return error;
}

export function normalizeStrictJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeStrictJsonSchema);
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const result = Object.fromEntries(Object.entries(source)
    .filter(([key]) => !["$schema", "$id", "$ref", "$defs", "definitions", "pattern", "minLength", "maxLength"].includes(key))
    .map(([key, child]) => [key, normalizeStrictJsonSchema(child)]));
  if (result.type === "object" && result.properties && typeof result.properties === "object" && !Array.isArray(result.properties)) {
    result.additionalProperties = false;
    result.required = Object.keys(result.properties as Record<string, unknown>);
  }
  return result;
}

export async function callGroq({
  apiKey, model, prompt, responseSchema, maxOutputTokens = 700,
  timeoutMs = 10_000, fetchImpl = fetch, strict = true
}: {
  apiKey: string; model: string; prompt: string; responseSchema: Record<string, unknown>;
  maxOutputTokens?: number; timeoutMs?: number; fetchImpl?: typeof fetch; strict?: boolean;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST", signal: controller.signal,
      headers: { "authorization": `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        response_format: strict ? {
          type: "json_schema",
          json_schema: { name: "tumpang_guide_response", strict: true, schema: normalizeStrictJsonSchema(responseSchema) }
        } : { type: "json_object" },
        max_completion_tokens: maxOutputTokens,
        reasoning_effort: "low"
      })
    });
    if (!response.ok) throw await providerResponseError("groq", response);
    const body = await response.json();
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw providerError("Groq returned no content.");
    return JSON.parse(content) as Record<string, unknown>;
  } finally {
    clearTimeout(timeout);
  }
}

export async function callProviderChain({
  prompt, responseSchema, maxOutputTokens = 700, timeoutMs = 18_000,
  primary = "gemini", secondary = "groq", fetchImpl = fetch, validate, strict = true,
  admin, stage = "provider_chain", traceId = "", clientTurnId
}: {
  prompt: string; responseSchema: Record<string, unknown>; maxOutputTokens?: number;
  timeoutMs?: number; primary?: ProviderName; secondary?: ProviderName; fetchImpl?: typeof fetch;
  validate?: (value: Record<string, unknown>) => boolean; strict?: boolean;
  // Cooldown/attempt tracking is DB-backed (private.ai_guide_provider_health,
  // shared with the outer per-turn provider loop in index.ts) rather than a
  // process-local Map, so every caller - the main turn, recommendation copy,
  // language packs, translations - agrees on whether a provider is currently
  // cooling down. Callers that omit `admin` (e.g. schema/unit tests that only
  // care about the request/response shape) simply skip cooldown tracking.
  admin?: AdminClient; stage?: string; traceId?: string; clientTurnId?: string;
}): Promise<ProviderResult> {
  const started = Date.now();
  const providers = [...new Set([primary, secondary])] as ProviderName[];
  let lastError: unknown = null;
  const failures: Array<{ provider: ProviderName; status: number; code: string; message: string }> = [];

  for (const [index, provider] of providers.entries()) {
    const remaining = timeoutMs - (Date.now() - started);
    if (remaining < 500) break;
    if (admin && await providerInCooldown(admin, provider)) {
      failures.push({
        provider, status: 503, code: "provider_cooldown",
        message: `${provider} temporarily skipped after a recent provider failure.`
      });
      lastError = providerError(`${provider} is in a temporary cooldown.`, 503);
      continue;
    }
    const attemptsLeft = providers.length - index;
    // Divide the total budget fairly so a slow primary still leaves the
    // secondary provider a real chance to answer. The previous 6s cap made
    // normal provider latency look like an outage.
    const attemptBudget = Math.min(15_000, Math.max(1_500, Math.floor(remaining / attemptsLeft)));
    const model = provider === "gemini"
      ? (Deno.env.get("M6_GUIDE_GEMINI_MODEL")?.trim() || "gemini-3.7-flash")
      : (Deno.env.get("M6_GUIDE_GROQ_MODEL")?.trim() || "openai/gpt-oss-20b");
    const attemptStarted = performance.now();
    try {
      let value: Record<string, unknown>;
      if (provider === "gemini") {
        const apiKey = Deno.env.get("GEMINI_API_KEY")?.trim() || "";
        if (!apiKey) throw providerError("Gemini API key is missing.", 503);
        value = await callGemini({
          apiKey, model, prompt, responseSchema, maxOutputTokens,
          timeoutMs: attemptBudget, maxAttempts: 1, fetchImpl
        }) as Record<string, unknown>;
        if (validate && !validate(value)) throw providerError("Gemini output failed semantic validation.", 422);
      } else {
        const apiKey = Deno.env.get("GROQ_API_KEY")?.trim() || "";
        if (!apiKey) throw providerError("Groq API key is missing.", 503);
        value = await callGroq({
          apiKey, model, prompt, responseSchema, maxOutputTokens,
          timeoutMs: attemptBudget, fetchImpl, strict
        });
        if (validate && !validate(value)) throw providerError("Groq output failed semantic validation.", 422);
      }
      if (admin) await recordProviderAttempt(admin, {
        traceId, clientTurnId, provider, model, stage, outcome: "success",
        latencyMs: performance.now() - attemptStarted
      });
      return { provider, model, value };
    } catch (error) {
      lastError = error;
      const status = Number((error as Error & { status?: number })?.status || 0);
      if (admin) await recordProviderAttempt(admin, {
        traceId, clientTurnId, provider, model, stage, outcome: "failure", status,
        latencyMs: performance.now() - attemptStarted,
        reason: cleanProviderDetail((error as Error & { code?: string })?.code) || undefined
      });
      failures.push({
        provider,
        status,
        code: cleanProviderDetail((error as Error & { code?: string })?.code),
        message: cleanProviderDetail(error instanceof Error ? error.message : error)
      });
    }
  }

  const finalError = (lastError instanceof Error ? lastError : providerError("All configured AI providers are unavailable.", 503)) as Error & {
    failures?: typeof failures
  };
  finalError.failures = failures;
  throw finalError;
}

function confidenceAt(value: unknown, field: string) {
  const row = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const score = Number(row[field]);
  return Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : 0;
}

export function mergeProviderIntent(currentPlan: Record<string, unknown>, extraction: Record<string, unknown>) {
  const patch = extraction.intentPatch && typeof extraction.intentPatch === "object" && !Array.isArray(extraction.intentPatch)
    ? extraction.intentPatch as Record<string, unknown> : {};
  const confidence = extraction.confidence;
  const blocked = new Set(Array.isArray(extraction.needsConfirmation) ? extraction.needsConfirmation.map(String) : []);
  const next = { ...currentPlan } as Record<string, unknown>;
  const accepted = (field: string, threshold = .65) => !blocked.has(field) && confidenceAt(confidence, field) >= threshold;

  const originLabel = String(patch.originLabel || "").trim().slice(0, 80);
  if (originLabel && accepted("origin")) next.origin = { label: originLabel };
  const partySize = Number(patch.partySize);
  if (Number.isInteger(partySize) && partySize >= 1 && partySize <= 20 && accepted("party")) next.partySize = partySize;
  const validDate = (value: unknown) => /^20\d{2}-\d{2}-\d{2}$/.test(String(value || ""));
  if (validDate(patch.startDate) && accepted("date")) {
    next.startDate = String(patch.startDate);
    next.endDate = validDate(patch.endDate) ? String(patch.endDate) : String(patch.startDate);
  }
  const categories = Array.isArray(patch.preferredCategories)
    ? patch.preferredCategories.map(String).filter((item) => ["culinary", "heritage", "nature", "event"].includes(item)) : [];
  if (categories.length && accepted("preference")) next.preferredCategories = [...new Set(categories)];
  if (["free", "low", "medium", "premium"].includes(String(patch.budget)) && accepted("budget")) next.budget = patch.budget;
  if (["indoor", "outdoor", "either"].includes(String(patch.indoorPreference)) && accepted("indoorPreference")) next.indoorPreference = patch.indoorPreference;
  if (accepted("accessibilityRequired")) next.accessibilityRequired = Boolean(patch.accessibilityRequired);
  if (accepted("children")) next.children = Boolean(patch.children);
  if (["default", "different", "quieter", "expanded"].includes(String(patch.recommendationMode)) && accepted("recommendationMode")) {
    next.recommendationMode = patch.recommendationMode;
    if (patch.recommendationMode === "expanded") {
      next.searchRadiusKm = Math.min(320, Math.max(160, (Number(currentPlan.searchRadiusKm) || 80) * 2));
    }
  }

  const detectedLanguage = String(extraction.language || "").trim();
  const languageConfidence = Math.max(0, Math.min(1, Number(extraction.languageConfidence) || 0));
  const validLanguage = /^[a-z]{2,3}(?:-[A-Za-z]{2,8})?$/.test(detectedLanguage);
  const switchLanguage = extraction.switchLanguage === true && languageConfidence >= .78
    && accepted("language", .78) && validLanguage;
  // The language of this answer is not the interface language and must not
  // rewrite the Travel Brief. The UI changes only after an explicit language
  // control/request, never because one message happened to be in another
  // language.
  const responseLanguage = validLanguage && languageConfidence >= .78
    ? detectedLanguage : String(currentPlan.language || "en");

  const requestedMode = ["recommend", "help", "small_talk", "action", "place_info", "travel_info", "catalogue_missing", "emergency"].includes(String(patch.requestedMode))
    && accepted("requestedMode") ? String(patch.requestedMode) : "";
  const requestedAction = ["record_interest", "register_ride_alert", "save_preferences"].includes(String(patch.requestedAction))
    ? String(patch.requestedAction) : "";

  return {
    plan: sanitizePlanState(next) as Record<string, unknown>,
    requestedMode,
    requestedPlaceName: String(patch.requestedPlaceName || "").trim().slice(0, 120),
    requestedAction,
    assistantMessage: String(extraction.assistantMessage || "").trim().slice(0, 1200),
    nextQuestionField: ["date", "origin", "party", "preference"].includes(String(extraction.nextQuestionField || ""))
      ? String(extraction.nextQuestionField) : "",
    confidence: extraction.confidence || {}, needsConfirmation: [...blocked],
    detectedLanguage: validLanguage ? detectedLanguage : String(currentPlan.language || "en"),
    responseLanguage, languageConfidence, switchLanguage
  };
}

export function preserveSmallTalkPlan(currentPlan: Record<string, unknown>, intentPlan: Record<string, unknown>) {
  // responseLanguage belongs to this turn. Casual conversation must not
  // rewrite the persistent Travel Brief or its interface language.
  void intentPlan;
  return sanitizePlanState(currentPlan) as Record<string, unknown>;
}

export function buildIntentPrompt({
  message, plan, recentMessages, today, placeContext = []
}: {
  message: string; plan: Record<string, unknown>;
  recentMessages: Array<{ role: string; text: string }>; today: string;
  placeContext?: Array<{ placeId: string; name: string; role?: string }>;
}) {
  return JSON.stringify({
    instruction: `Understand the traveller's latest free-form message in conversational context and return the strict intent schema. You are the intent-understanding layer; rules have not interpreted the message. Handle typos, shorthand, slang, mixed-language input, romanisation and context-dependent short replies. Extract only information explicitly stated or safely resolved from the dialogue. A short answer such as "Melaka" should fill the currently missing origin. "We are in Melaka, about 2 people" must fill both origin and party size. Use confidence 0 when a field was not supplied or changed. Use needsConfirmation only for genuinely ambiguous values. Never invent precise coordinates, routes, opening hours or catalogue IDs. Convert relative dates using today. preferredCategories may only contain culinary, heritage, nature or event. recommendationMode is different when the user asks for other/new places and quieter when they ask for less busy places. requestedMode is place_info whenever the user asks what to do, see, eat, expect or know about a named place, or asks why that named place was recommended or suits the current plan. Resolve references such as "the first one", "that place" or "why there" only from verifiedPlaceContext and copy its official name into requestedPlaceName. A named-place question is not app Help. It identifies recommend only when they want destination choices, help only for using the app, catalogue_missing only when they explicitly request a place outside the catalogue, or emergency only when the user describes immediate physical danger requiring urgent assistance. Phrases such as "help me save this", "help me find a ride", or ordinary app help are never emergencies. Put the named venue in requestedPlaceName for place_info. For an external named place, use catalogue_missing; never answer it with web facts. Detect the language the user is naturally communicating in as a BCP-47 tag. Set switchLanguage only when the latest meaningful message clearly establishes a different language or explicitly requests one; names, emoji, numbers and very short ambiguous fragments must retain the current language. languageConfidence and confidence.language must reflect that decision. For enum fields with no supplied value, return exactly \"unspecified\"; for an unknown party size, return 0; never return null. Determine the most important still-missing required field after applying intentPatch and put only that field in nextQuestionField; use \"unspecified\" when none is missing. Write assistantMessage in the detected language when switching, otherwise responseLanguage. Acknowledge understood details naturally, then ask only nextQuestionField and never ask about optional budget before date, origin, party size and preference are complete.`,
    smallTalkRouting: `This rule overrides the missing-field instruction for casual conversation. Set requestedMode to small_talk for greetings, thanks, affection such as "I love you" or "我爱你", jokes, casual feelings, social reactions, questions about the assistant, and conversational remarks that do not request app instructions, verified place facts, or travel recommendations. For small_talk, leave every Travel Brief patch field unspecified or empty with confidence 0, set nextQuestionField to unspecified, and write a short, warm, natural response in the response language. Do not recommend places. You may gently invite the user to discuss travel without asking a required planning question.`,
    actionRouting: `Set requestedMode to action when the user asks the app to perform an available operation. Map "save this place", "add this to my interests" and equivalent wording to requestedAction record_interest; map requests to notify the user about future rides to register_ride_alert; map requests to save Travel Brief categories as preferences to save_preferences. For a place action, resolve the target only from verifiedPlaceContext and copy its exact official name into requestedPlaceName. If no verified target is available, explain what is missing and never claim the action succeeded. Asking for an action is not Help and is never an emergency. The server will verify the Place ID and require confirmation before execution.`,
    today,
    responseLanguage: plan.language,
    currentPlan: plan,
    verifiedPlaceContext: placeContext.slice(0, 4),
    recentMessages,
    userMessage: message
  });
}

export function providerOrder() {
  return { primary: "gemini" as ProviderName, secondary: "groq" as ProviderName };
}
