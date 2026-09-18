export const RESPONSE_SCHEMA = {
  type: "object",
  required: ["mode", "assistantMessage", "language", "planState", "quickReplies", "recommendations", "actions"],
  properties: {
    mode: { type: "string", enum: ["clarify", "recommend", "help", "small_talk", "action", "place_info", "travel_info", "catalogue_missing", "emergency", "fallback"] },
    assistantMessage: { type: "string" },
    language: { type: "string" },
    planState: { type: "object" },
    quickReplies: { type: "array", items: { type: "string" }, maxItems: 4 },
    recommendations: { type: "array", maxItems: 3, items: { type: "object", required: ["placeId", "role", "verifiedReasonCodes", "tradeoffCode"], properties: {
      placeId: { type: "string" }, role: { type: "string", enum: ["best_match", "practical_alternative", "wildcard"] }, verifiedReasonCodes: { type: "array", items: { type: "string" } }, tradeoffCode: { type: "string" }
    } } },
    actions: { type: "array", items: { type: "object", properties: { type: { type: "string", enum: ["open_place", "find_ride", "record_interest", "register_ride_alert", "save_preferences"] }, label: { type: "string" }, placeId: { type: "string" } } } }
  }
};

export const TRANSLATION_SCHEMA = {
  type: "object", additionalProperties: false, required: ["translations"], properties: {
    translations: { type: "array", maxItems: 12, items: { type: "object", additionalProperties: false, required: ["id", "text"], properties: { id: { type: "string" }, text: { type: "string" } } } }
  }
};

export const LANGUAGE_PACK_SCHEMA = {
  type: "object", required: ["language", "packVersion", "copy"], properties: {
    language: { type: "string" }, packVersion: { type: "string" }, copy: { type: "object" }
  }
};

export const LANGUAGE_PACK_REQUIRED_KEYS = [
  "welcome", "askDate", "askOrigin", "askParty", "askPreference", "recommend", "noCandidates",
  "helpMissing", "emergency", "offline", "retryGemini", "newChat", "pastPlans", "guideLanguage",
  "livePlan", "travelBrief", "startingPoint", "from", "until", "people", "categoryQuestion",
  "useLocation", "locating", "savePreferences", "signInSave", "historyConsent", "historyNote",
  "composerLabel", "composerPlaceholder", "voiceNote", "thinking", "databaseOnly", "timeoutFallback",
  "privacy", "smart", "verifiedRules", "sourceGemini", "sourceGroq", "sourceRules", "details", "whyThis", "findRide",
  "saveInterest", "interestSaved", "cancelInterest", "rideAlert", "alertSaved", "cancelAlert", "tradeoff",
  "showPhoto", "previouslyShown", "helpful", "notRelevant", "feedbackSaved", "feedbackRemoved",
  "rulesFallback", "retryNotice", "actionConfirm", "cancel", "confirm", "sourceLabel",
  "preferencesSaved", "catalogueRequestSaved", "actionFailed", "feedbackError", "feedbackUnavailable", "persistenceWarning", "languageUnavailable",
  "voiceUnsupported", "voicePermissionDenied", "voiceNoSpeech", "voiceLanguageUnsupported", "voiceStopped", "voiceStartFailed",
  "voiceMicrophoneUnavailable", "voiceNetworkUnavailable", "voiceInterrupted", "voiceProviderBusy", "voiceTranscriptionFailed",
  "heroTitle", "heroDescription", "onboardingTitle", "onboardingDescription",
  "onboardingNext", "onboardingStart", "onboardingFreeTier", "loadingLanguage",
  "suggestedReplies", "quickNature", "quickFood", "quickHelp", "quickPractical", "quickDifferent", "quickDate", "callEmergency", "trustedFamily", "feedbackReason", "feedbackBadTradeoff", "feedbackWrongLanguage", "feedbackOther",
  "chooseFeedbackReason", "openConversation", "requestCatalogue", "catalogueQueued",
  "savedPlanDescription", "delete", "deleteAll", "backToGuide", "signIn", "guestNotSaved",
  "accountRequiredTitle", "loadingPlans", "plansUnavailable", "retry", "noSavedPlans",
  "noSavedPlansDescription", "dateNotDecided", "originNotDecided", "privateRetention",
  "startingPointPlaceholder", "startVoice", "stopVoice", "sendMessage", "showMore",
  "onboardingCatalogueTitle", "onboardingCatalogueDescription", "onboardingPrivacyTitle",
  "onboardingPrivacyDescription", "onboardingHistoryTitle", "onboardingHistoryDescription",
  "onboardingFreeTierDescription", "heroMediaTitle", "heroMediaDescription", "batchLabel", "photoCredit",
  "livePlaceInfo", "databasePlaceInfo", "placeHighlights", "goodFor", "practicalNotes", "expectedStay", "checkedAt", "liveInfoUnavailable",
  "guestQuota"
] as const;

export const LANGUAGE_PACK_NESTED_KEYS = {
  roles: ["best_match", "practical_alternative", "wildcard"],
  categories: ["culinary", "heritage", "nature", "event"],
  tradeoffs: ["none", "no_ride_yet", "farther_away", "busier_choice", "thin_reviews", "lower_personal_match"],
  reasons: ["affinity", "season", "quality", "headroom", "local", "seat_headroom", "journey_cost", "demand_convergence", "weather_checked", "date_range_consistency"]
} as const;

export function isCompleteGuideLanguagePack(value: unknown, language: string, packVersion: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const copy = row.copy && typeof row.copy === "object" && !Array.isArray(row.copy)
    ? row.copy as Record<string, unknown> : null;
  if (row.language !== language || row.packVersion !== packVersion || !copy) return false;
  if (LANGUAGE_PACK_REQUIRED_KEYS.some((key) => typeof copy[key] !== "string" || !String(copy[key]).trim())) return false;
  return Object.entries(LANGUAGE_PACK_NESTED_KEYS).every(([group, keys]) => {
    const nested = copy[group];
    return nested && typeof nested === "object" && !Array.isArray(nested)
      && keys.every((key) => typeof (nested as Record<string, unknown>)[key] === "string"
        && String((nested as Record<string, unknown>)[key]).trim());
  });
}

const GEMINI_UNSUPPORTED_SCHEMA_KEYS = new Set([
  "$schema",
  "$id",
  "$ref",
  "definitions",
  "$defs",
  "pattern",
  "minLength",
  "maxLength",
  "additionalProperties"
]);

export function normalizeGeminiSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeGeminiSchema);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !GEMINI_UNSUPPORTED_SCHEMA_KEYS.has(key))
    .map(([key, child]) => [
      key,
      key === "type" && typeof child === "string" ? child.toUpperCase() : normalizeGeminiSchema(child)
    ]));
}

function safeThinkingLevel(value: unknown) {
  return ["low", "medium", "high"].includes(String(value || "")) ? String(value) : "low";
}

function cleanGeminiError(value: unknown) {
  return String(value || "")
    .replace(/([?&]key=)[^&\s]+/giu, "$1[redacted]")
    .replace(/\s+/g, " ").trim().slice(0, 360);
}

async function geminiResponseError(response: Response) {
  let detail = "";
  let code = "";
  try {
    const body = await response.clone().json();
    const row = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const nested = row.error && typeof row.error === "object" ? row.error as Record<string, unknown> : {};
    detail = cleanGeminiError(nested.message || row.message || row.error);
    code = cleanGeminiError(nested.status || nested.code || row.code);
  } catch {
    try { detail = cleanGeminiError(await response.text()); } catch { /* Error body is optional. */ }
  }
  const error = new Error(`Gemini ${response.status}${detail ? `: ${detail}` : ""}`) as Error & {
    status?: number; code?: string; provider?: string
  };
  error.status = response.status;
  error.code = code;
  error.provider = "gemini";
  return error;
}

export async function callGemini({
  apiKey, model, prompt, fetchImpl = fetch, responseSchema = RESPONSE_SCHEMA,
  maxOutputTokens = 900, timeoutMs = 12_000, thinkingLevel = "low", maxAttempts = 2
}: {
  apiKey: string; model: string; prompt: string; fetchImpl?: typeof fetch;
  responseSchema?: Record<string, unknown>; maxOutputTokens?: number; timeoutMs?: number;
  thinkingLevel?: "minimal" | "low" | "medium" | "high"; maxAttempts?: number
}) {
  const started = Date.now();
  const attempts = Math.max(1, Math.min(2, Math.floor(maxAttempts)));
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const remaining = timeoutMs - (Date.now() - started);
    if (remaining <= 250) break;
    const controller = new AbortController();
    // Keep each attempt bounded while allowing the caller's total budget to
    // cover a transient retry. The browser now waits for the Edge deadline.
    const attemptBudget = attempts > 1 ? Math.min(4200, remaining) : remaining;
    const timeout = setTimeout(() => controller.abort(), attemptBudget);
    try {
      const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST", signal: controller.signal,
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json", responseSchema: normalizeGeminiSchema(responseSchema), maxOutputTokens,
            // Gemini 3.7 accepts low/medium/high. Older callers may still
            // pass the removed "minimal" value; normalize it before it can
            // become a provider_request_invalid response.
            thinkingConfig: { thinkingLevel: safeThinkingLevel(thinkingLevel) }
          }
        })
      });
      if (!response.ok) throw await geminiResponseError(response);
      const body = await response.json();
      const text = body?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || "").join("") || "";
      return JSON.parse(text);
    } catch (error) {
      lastError = error;
      const status = Number((error as Error & { status?: number })?.status || 0);
      const transient = (error instanceof Error && error.name === "AbortError")
        || status === 408 || status === 429 || status >= 500 || status === 0;
      if (!transient || attempt + 1 >= attempts) throw error;
      const pause = Math.min(300 + Math.floor(Math.random() * 120), Math.max(0, timeoutMs - (Date.now() - started) - 250));
      if (pause > 0) await new Promise((resolve) => setTimeout(resolve, pause));
    } finally { clearTimeout(timeout); }
  }
  throw lastError || new DOMException("Gemini request timed out", "AbortError");
}

export function translateGuideMessages({ apiKey, model, language, messages, fetchImpl = fetch }: {
  apiKey: string; model: string; language: string; messages: Array<{ id: string; text: string }>;
  fetchImpl?: typeof fetch
}) {
  const prompt = JSON.stringify({
    instruction: "Translate each supplied Tumpang Guide assistant message into the requested language. Return exactly the same ids, preserve official place names, product names, numbers, dates and action labels when they are names. Do not translate user messages and do not add commentary.",
    language, messages
  });
  return callGemini({ apiKey, model, prompt, fetchImpl, responseSchema: TRANSLATION_SCHEMA, maxOutputTokens: 1000 });
}

export function generateGuideLanguagePack({ apiKey, model, language, packVersion, requiredKeys, fetchImpl = fetch }: {
  apiKey: string; model: string; language: string; packVersion: string; requiredKeys: string[]; fetchImpl?: typeof fetch
}) {
  const prompt = JSON.stringify({
    instruction: "Create a complete Tumpang Guide UI language pack. Return JSON only with a copy object containing the exact requested top-level keys and nested keys. Every value must be a natural translation, not an explanation. Keep {{category}}, {{name}}, {{origin}}, {{party}}, {{categories}}, {n} and {date} placeholders unchanged. Include every nested role, category, tradeoff and reason key exactly once. Do not translate official product or place names in the templates.",
    language, packVersion,
    requiredTopLevelKeys: requiredKeys,
    requiredNestedKeys: LANGUAGE_PACK_NESTED_KEYS
  });
  return callGemini({ apiKey, model, prompt, fetchImpl, responseSchema: LANGUAGE_PACK_SCHEMA, maxOutputTokens: 1800, timeoutMs: 14_000 });
}

export async function embedHelpQuery({
  apiKey, model = "gemini-embedding-2", text, taskType = "RETRIEVAL_QUERY", fetchImpl = fetch
}: { apiKey: string; model?: string; text: string; taskType?: "RETRIEVAL_QUERY" | "RETRIEVAL_DOCUMENT"; fetchImpl?: typeof fetch }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:embedContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST", signal: controller.signal, headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: `models/${model}`,
        content: { parts: [{ text }] },
        taskType,
        outputDimensionality: 768
      })
    });
    if (!response.ok) throw new Error(`Gemini embedding ${response.status}`);
    const body = await response.json();
    const values = body?.embedding?.values;
    if (!Array.isArray(values) || values.length !== 768 || values.some((value: unknown) => !Number.isFinite(Number(value)))) {
      throw new Error("Gemini embedding returned an invalid vector.");
    }
    return values.map(Number);
  } finally { clearTimeout(timeout); }
}
