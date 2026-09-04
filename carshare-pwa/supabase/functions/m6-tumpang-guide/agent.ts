import { normalizeGeminiSchema } from "./gemini.ts";
import { normalizeStrictJsonSchema, type ProviderName } from "./providers.ts";

type Row = Record<string, unknown>;

const LANGUAGE_PROPERTIES = {
  language: { type: "string", maxLength: 24 },
  languageConfidence: { type: "number", minimum: 0, maximum: 1 },
  assistantMessage: { type: "string", maxLength: 1200 }
};

const SEARCH_CATALOGUE_PARAMETERS = {
  type: "object", additionalProperties: false,
  properties: {
    originLabel: { type: "string", maxLength: 80 },
    partySize: { type: "integer", minimum: 0, maximum: 20 },
    startDate: { type: "string", maxLength: 10 },
    endDate: { type: "string", maxLength: 10 },
    preferredCategories: { type: "array", items: { type: "string", enum: ["culinary", "heritage", "nature", "event"] }, maxItems: 4 },
    recommendationMode: { type: "string", enum: ["unspecified", "default", "different", "quieter", "expanded"] },
    nextQuestionField: { type: "string", enum: ["unspecified", "date", "origin", "party", "preference"] },
    ...LANGUAGE_PROPERTIES
  },
  required: ["originLabel", "partySize", "startDate", "endDate", "preferredCategories", "recommendationMode", "nextQuestionField", ...Object.keys(LANGUAGE_PROPERTIES)]
};

const PLACE_INFORMATION_PARAMETERS = {
  type: "object", additionalProperties: false,
  properties: {
    requestedPlaceName: { type: "string", maxLength: 160 },
    ...LANGUAGE_PROPERTIES
  },
  required: ["requestedPlaceName", ...Object.keys(LANGUAGE_PROPERTIES)]
};

const TRAVEL_INFO_PARAMETERS = {
  type: "object", additionalProperties: false,
  properties: {
    topic: { type: "string", maxLength: 200 },
    relatedPlaceName: { type: "string", maxLength: 160 },
    ...LANGUAGE_PROPERTIES
  },
  required: ["topic", "relatedPlaceName", ...Object.keys(LANGUAGE_PROPERTIES)]
};

const WEATHER_FORECAST_PARAMETERS = {
  type: "object", additionalProperties: false,
  properties: {
    // Exact catalogue name from verifiedPlaceContext when the question is
    // about one, otherwise the city/area the user named. "" when unstated -
    // the server resolves an unstated location, never guesses one.
    locationName: { type: "string", maxLength: 160 },
    // Resolved against today by the model, same pattern as search_catalogue.
    // "" when the user gave no date - the server assumes today..+2 days.
    startDate: { type: "string", maxLength: 10 },
    endDate: { type: "string", maxLength: 10 },
    ...LANGUAGE_PROPERTIES
  },
  required: ["locationName", "startDate", "endDate", ...Object.keys(LANGUAGE_PROPERTIES)]
};

const ROUTE_ESTIMATE_PARAMETERS = {
  type: "object", additionalProperties: false,
  properties: {
    // Exact official name from verifiedPlaceContext, or the place the user named.
    destinationName: { type: "string", maxLength: 160 },
    // "" means "use the traveller's existing Travel Brief origin".
    originLabel: { type: "string", maxLength: 80 },
    ...LANGUAGE_PROPERTIES
  },
  required: ["destinationName", "originLabel", ...Object.keys(LANGUAGE_PROPERTIES)]
};

const CAPABILITIES_PARAMETERS = {
  type: "object", additionalProperties: false,
  properties: LANGUAGE_PROPERTIES,
  required: Object.keys(LANGUAGE_PROPERTIES)
};

const ACTION_PARAMETERS = {
  type: "object", additionalProperties: false,
  properties: {
    requestedPlaceName: { type: "string", maxLength: 160 },
    requestedAction: { type: "string", enum: ["unspecified", "record_interest", "register_ride_alert", "save_preferences"] },
    ...LANGUAGE_PROPERTIES
  },
  required: ["requestedPlaceName", "requestedAction", ...Object.keys(LANGUAGE_PROPERTIES)]
};

const EMERGENCY_PARAMETERS = {
  type: "object", additionalProperties: false,
  properties: LANGUAGE_PROPERTIES,
  required: Object.keys(LANGUAGE_PROPERTIES)
};

const CONVERSATIONAL_PARAMETERS = {
  type: "object", additionalProperties: false,
  properties: LANGUAGE_PROPERTIES,
  required: Object.keys(LANGUAGE_PROPERTIES)
};

const CHANGE_LANGUAGE_PARAMETERS = {
  type: "object", additionalProperties: false,
  properties: {
    language: { type: "string", maxLength: 24 },
    languageConfidence: { type: "number", minimum: 0, maximum: 1 },
    assistantMessage: { type: "string", maxLength: 1200 }
  },
  required: ["language", "languageConfidence", "assistantMessage"]
};

export const GUIDE_AGENT_TOOLS = [
  { name: "search_catalogue", description: "Use only for destination recommendations or an explicit refinement: other places, nearer, quieter or an explicitly approved wider search. The server selects every Place ID.", parameters: SEARCH_CATALOGUE_PARAMETERS },
  { name: "get_place_information", description: "Use for a named place question or a verified contextual reference such as this place, the first one or that venue. This tool never creates a recommendation batch and never asks for a travel origin.", parameters: PLACE_INFORMATION_PARAMETERS },
  { name: "get_weather_forecast", description: "Use for any question about weather conditions - rain, showers, storms, heat, humidity, haze, or whether the forecast is good for a trip. The server checks a real forecast service; you never guess a forecast yourself. Set locationName to the exact official name from verifiedPlaceContext when the question is about one of those venues, otherwise to the city or area the traveller named, otherwise leave it empty and the server will ask. Resolve any date the traveller gave against today into YYYY-MM-DD; leave startDate empty if no date was given. This answers in prose only and never produces a recommendation or an app action.", parameters: WEATHER_FORECAST_PARAMETERS },
  { name: "get_route_estimate", description: "Use for a point-to-point travel question about ONE named destination - how far it is, how long it takes to drive there, or how long the journey is. The server computes a real driving route; you never guess a distance or duration yourself. destinationName must be a place already in verifiedPlaceContext or a place the traveller explicitly named. Do NOT use this for 'what transport options exist' or 'how do I get around without a car' - those are get_travel_info. This answers in prose only and never produces a recommendation or an app action.", parameters: ROUTE_ESTIMATE_PARAMETERS },
  { name: "get_travel_info", description: "Do NOT use this for weather (use get_weather_forecast) or for how far / how long to one named destination (use get_route_estimate). Use it only for other real-time factual travel questions those two cannot answer - for example what public transport modes exist in an area, opening hours of something that is not a catalogue place, ticketing, or general travel trivia. Never use this to identify, endorse or introduce a new place as a destination, and never combine it with a recommendation or an app action. If relatedPlaceName is set, it must already exist in verifiedPlaceContext.", parameters: TRAVEL_INFO_PARAMETERS },
  { name: "get_guide_capabilities", description: "Explain the Guide's real capabilities and how to use its existing app actions. Do not ask for travel-planning fields.", parameters: CAPABILITIES_PARAMETERS },
  { name: "prepare_guide_action", description: "Prepare a supported save-interest, ride-alert or save-preferences action. The server will require confirmation before writing.", parameters: ACTION_PARAMETERS },
  { name: "trigger_emergency", description: "Use only for an immediate physical emergency such as unconsciousness, severe bleeding or immediate danger. The server supplies the fixed SOS message.", parameters: EMERGENCY_PARAMETERS },
  { name: "respond_conversationally", description: "Reply naturally to greetings, affection, jokes, feelings or casual conversation that does not request a travel tool. Never name, count, describe or imply any place, popular spot or suggestion in assistantMessage here - no verified catalogue lookup happens in this tool, so any such claim would be invented. A traveller expressing even a vague wish to go somewhere or eat something (\"I want to eat\", \"saya nak makan\", \"想出去走走\") is a travel-tool request, not casual conversation - route that to search_catalogue instead, never to this tool.", parameters: CONVERSATIONAL_PARAMETERS },
  { name: "change_interface_language", description: "Use only when the user explicitly asks to change the Guide interface language; ordinary English, Chinese, Malay or Tamil messages do not change the interface.", parameters: CHANGE_LANGUAGE_PARAMETERS }
];

function statusError(provider: ProviderName, response: Response) {
  const error = new Error(`${provider} tool selection failed with HTTP ${response.status}`) as Error & {
    status?: number; provider?: string; retryAfterSeconds?: number
  };
  const retryAfter = Number(response.headers.get("retry-after"));
  error.status = response.status; error.provider = provider;
  if (Number.isFinite(retryAfter) && retryAfter >= 0) error.retryAfterSeconds = retryAfter;
  return error;
}

export function decisionPrompt(input: Row) {
  return JSON.stringify({
    instruction: "You own this entire Tumpang Guide turn: understanding, tool selection and the final answer. No other code will override your choice of tool or the mode it produces - select carefully, exactly once. Understand mixed languages and follow-up context naturally. Speak with a warm, lively tone and the occasional light touch of humor - except during trigger_emergency or a serious safety topic, where the reply must stay calm, direct and free of jokes.",
    routingExamples: "Compare these closely, since the wording is often similar: 'food in KL' or 'suggest something to eat in Penang' -> search_catalogue (a destination request naming an area, not one specific venue). 'I want to eat' / 'saya nak makan' / 'nak pergi jalan-jalan' / 'kamu suggest je lah, i takde idea' (a bare wish to eat, go out or be suggested something, with no venue named) -> search_catalogue, never respond_conversationally - infer preferredCategories from the wish where clear (eating implies culinary), leave originLabel as whatever the Travel Brief already has, and let the server ask for anything still missing rather than writing a reply that only sounds like it found places. 'What's good to eat at KL Bird Park?' or 'Tell me about Tokyo Disneyland' -> get_place_information (a question about one already-identified venue, even though it also mentions food/activities). 'I love KL' or 'KL is amazing' -> respond_conversationally (affection/opinion about a place, not a request for options or facts). 'Tell me more about that' or 'why the first one' with a focused venue in verifiedPlaceContext -> get_place_information, resolving 'that'/'the first one'/'it' to the matching entry and copying its exact official name into requestedPlaceName. 'Another place' or 'somewhere quieter' -> search_catalogue with recommendationMode different/quieter. 'Will it rain this weekend?' / '这个周末会下雨吗？' / 'Hujan tak hujung minggu ni?' / 'இந்த வாரயிறுதியில் மழை பெய்யுமா?' -> get_weather_forecast, locationName empty if no place was named (the server will ask), startDate/endDate resolved from today. 'How hot will it be at Batu Caves on Saturday?' / '星期六黑风洞会很热吗？' -> get_weather_forecast with locationName exactly 'Batu Caves'. 'How long does it take to get to Melaka?' / '去马六甲要多久？' / 'Berapa lama nak sampai Melaka?' / 'மலாக்கா செல்ல எவ்வளவு நேரம் ஆகும்?' -> get_route_estimate with destinationName 'Melaka'. 'How far is it from here?' with one venue focused in verifiedPlaceContext -> get_route_estimate with destinationName copied exactly from that entry. 'How do I get around KL without a car?' / 'Macam mana nak gerak tanpa kereta?' -> get_travel_info; this asks which transport modes exist, not how long one specific drive takes - that distinction is the whole difference between get_travel_info and get_route_estimate. 'Somewhere with good weather this weekend' / '这周末找个天气好的地方' -> search_catalogue, NOT get_weather_forecast; weather here is a constraint on which places to suggest, the traveller is asking for place options, not for the forecast itself. 'What time does the night market close?' -> get_travel_info (a factual lookup neither the forecast nor the route tool can answer).",
    placeInformationRule: "Use get_place_information - never search_catalogue - for any named-place question, including a bare venue name, a question about one specific already-identified venue, or a follow-up referring back to a place from verifiedPlaceContext. Never ask for origin, date or party size for get_place_information. A named place that is not in the verified catalogue must be treated as catalogue_missing; do not use web search, recommendations or app actions for it.",
    weatherRule: "get_weather_forecast is the only way to answer a weather question - rain, sun, heat, humidity, haze, storms, whether the forecast suits a plan. Never state or guess a forecast in assistantMessage yourself; the server supplies the real numbers and will rewrite your draft. If the traveller named a specific venue and it is focused in verifiedPlaceContext, copy its exact name into locationName. If they named a smaller landmark, mall, street or neighbourhood that is not itself a catalogue venue but you recognise as being within a well-known Malaysian city or state capital (e.g. KLCC, Bukit Bintang or Petaling Street are all in Kuala Lumpur; George Town is in Penang; Batu Ferringhi is in Penang) - normalise locationName down to that city so the server can still check the right area's forecast, instead of leaving an obscure sub-area name that will not match anything. If the traveller named no place at all, leave locationName empty - the server has a sensible default and will say so.",
    routeRule: "get_route_estimate answers one specific point-to-point journey - how far or how long to ONE named destination. Never state a distance or duration yourself; the server computes the real number. A destination may be a catalogue attraction OR a town, city or state capital - 'how long does it take to get to Melaka' is an ordinary question that needs no specific venue, so never turn a city destination into a demand for something more specific. As with weather, if the traveller named a smaller landmark, mall or neighbourhood that you recognise as sitting inside a well-known Malaysian city, normalise destinationName down to that city instead of leaving an obscure sub-area name that will match nothing. If no destination is identifiable at all, leave destinationName empty and the server will ask. Do not use this for 'what transport options exist' - that is get_travel_info.",
    miscTravelInfoRule: "Use get_travel_info only for real-time factual follow-ups that get_weather_forecast and get_route_estimate cannot answer - typical transport options, opening hours of something not in the catalogue, general trip context. It always answers in prose only; it can never produce a recommendation or an app action, and it must never be used to identify, endorse or introduce a place the traveller did not already name from verifiedPlaceContext. If relatedPlaceName is set, copy it exactly from verifiedPlaceContext - never invent one.",
    conversationMomentumWarning: "recentMessages is context for resolving references such as 'that' or 'another place', never a pattern to imitate. Even after several consecutive search_catalogue/recommend turns in the same conversation, a message that only asks about weather, transport, walkability or other trip logistics - and does not itself ask for place options - must still route to get_weather_forecast, get_route_estimate or get_travel_info, not search_catalogue. Do not let the momentum of recent recommend turns carry a purely informational question into another recommendation batch. Example: turns 1-3 were all search_catalogue recommendation requests; turn 4 is 'will it rain this weekend?' - turn 4 is still get_weather_forecast, with no recommendations or actions, exactly as it would be as the very first message of the conversation.",
    originLabelRule: "search_catalogue's originLabel is the location results are filtered by - normally where the traveller is starting from, but when the message names a target search area without an explicit 'from X'/'starting from X' framing (e.g. 'food in KL', 'suggest something in Penang'), set originLabel to that named area even if an earlier Travel Brief origin was different; the newly named area is what the traveller wants results for right now. An explicit 'from X' phrase always sets the true starting-point origin instead, and must not be replaced by a destination area mentioned elsewhere in the same message.",
    otherToolRules: "Use search_catalogue only for destination choices or explicit recommendation refinements. Use get_guide_capabilities for how-to questions, not a refusal. Do not recommend for affection, greetings or casual chat - use respond_conversationally. Treat 'too far' as search_catalogue with default/nearer constraints. Dates and party size are optional unless materially needed. Use expanded only after explicit permission. Use trigger_emergency only for immediate physical danger (e.g. unconsciousness, severe bleeding); never for ordinary discomfort or wording such as 'help me save this'.",
    preferenceNudgeRule: "Only when signedIn is true and the traveller just clearly expressed a lasting preference (a favourite category, budget level, accessibility need) in passing - not on every turn, and never for a guest - your assistantMessage may end with one brief, natural invitation to save it (e.g. 'Want me to remember that for next time?'). Never claim it is already saved and never call prepare_guide_action yourself here; saving only happens if the traveller confirms in a later turn.",
    pendingClarificationRule: "When input.pendingClarification is present, your previous turn just asked the traveller a specific follow-up question and is still waiting on it - it means field pendingClarification.field on tool pendingClarification.tool is the one piece of information missing. A short reply with no other content (a bare place name, a city, 'here', 'my location') is almost certainly answering exactly that question, not starting a new request: keep using pendingClarification.tool, and fill pendingClarification.field from this message. If pendingClarification.destinationName is set, that destination was already established earlier in this same exchange - preserve it exactly, do not ask for it again or treat this reply as naming a new destination. Only abandon pendingClarification and route elsewhere when the message is unambiguously a different kind of request (a greeting, an explicit new question, an explicit recommendation request, or a place name paired with words like 'food'/'stay'/'visit' that make it a destination search instead of a location answer). When input.pendingClarification is absent, ignore this rule entirely.",
    formatting: "Preserve official names exactly. Fill unknown strings with an empty string, unknown party with 0, and unspecified enums with 'unspecified'. assistantMessage is a short draft in the user's language reflecting the tone above; the server may ground and refine it before it reaches the user. For get_weather_forecast and get_route_estimate specifically, assistantMessage is only a short acknowledgement - the server replaces it with the verified answer, so never put a forecast, distance or duration in it.",
    ...input
  });
}

// A one-off timeout or 5xx from the routing call is often a single bad
// network hop, not real exhaustion - one quick retry recovers the turn
// without ever needing the secondary provider, which is exactly the call
// this file's other provider (Groq's tighter free-tier quota) least wants
// to absorb. A 429 is different: the rate-limit window has not passed in
// the ~300ms before a retry, so retrying it immediately only spends a
// second call for the same rejection - never retried here.
function isTransientToolChoiceError(error: unknown) {
  const status = Number((error as Error & { status?: number })?.status || 0);
  return (error instanceof Error && error.name === "AbortError") || status === 408 || (status >= 500 && status < 600);
}

async function geminiToolChoice(apiKey: string, model: string, input: Row, timeoutMs: number, fetchImpl: typeof fetch) {
  const started = Date.now();
  const attempt = async (budgetMs: number) => {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), budgetMs);
    try {
      const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST", signal: controller.signal,
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: decisionPrompt(input) }] }],
          tools: [{ functionDeclarations: GUIDE_AGENT_TOOLS.map((tool) => ({ ...tool, parameters: normalizeGeminiSchema(tool.parameters) })) }],
          toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: GUIDE_AGENT_TOOLS.map((tool) => tool.name) } },
          // Gemini 3.7 supports low/medium/high only. "minimal" is rejected
          // by the API as an invalid request, which used to make every primary
          // agent decision fail before Groq could be considered.
          generationConfig: { maxOutputTokens: 900, thinkingConfig: { thinkingLevel: "low" } }
        })
      });
      if (!response.ok) throw statusError("gemini", response);
      const body = await response.json();
      const call = body?.candidates?.[0]?.content?.parts?.find((part: Row) => part.functionCall)?.functionCall;
      if (!call?.name || !call?.args) throw new Error("Gemini returned no valid Guide tool call.");
      return { toolName: String(call.name), args: call.args as Row };
    } finally { clearTimeout(timer); }
  };
  try {
    return await attempt(timeoutMs);
  } catch (error) {
    const remaining = timeoutMs - (Date.now() - started);
    if (!isTransientToolChoiceError(error) || remaining < 1_500) throw error;
    await new Promise((resolve) => setTimeout(resolve, 250 + Math.floor(Math.random() * 150)));
    return await attempt(timeoutMs - (Date.now() - started));
  }
}

async function groqToolChoice(apiKey: string, model: string, input: Row, timeoutMs: number, fetchImpl: typeof fetch) {
  const started = Date.now();
  const attempt = async (budgetMs: number) => {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), budgetMs);
    try {
      const response = await fetchImpl("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST", signal: controller.signal,
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model, messages: [{ role: "user", content: decisionPrompt(input) }],
          tools: GUIDE_AGENT_TOOLS.map((tool) => ({ type: "function", function: { ...tool, parameters: normalizeStrictJsonSchema(tool.parameters) } })),
          tool_choice: "required", parallel_tool_calls: false, reasoning_effort: "low", max_completion_tokens: 900
        })
      });
      if (!response.ok) throw statusError("groq", response);
      const body = await response.json(); const call = body?.choices?.[0]?.message?.tool_calls?.[0]?.function;
      if (!call?.name || typeof call.arguments !== "string") throw new Error("Groq returned no valid Guide tool call.");
      return { toolName: String(call.name), args: JSON.parse(call.arguments) as Row };
    } finally { clearTimeout(timer); }
  };
  try {
    return await attempt(timeoutMs);
  } catch (error) {
    const remaining = timeoutMs - (Date.now() - started);
    if (!isTransientToolChoiceError(error) || remaining < 1_500) throw error;
    await new Promise((resolve) => setTimeout(resolve, 250 + Math.floor(Math.random() * 150)));
    return await attempt(timeoutMs - (Date.now() - started));
  }
}

export async function chooseGuideTool(provider: ProviderName, input: Row, { timeoutMs = 45_000, fetchImpl = fetch } = {}) {
  let decision;
  if (provider === "gemini") {
    const apiKey = Deno.env.get("GEMINI_API_KEY")?.trim() || "";
    if (!apiKey) throw new Error("Gemini API key is missing.");
    decision = await geminiToolChoice(apiKey, Deno.env.get("M6_GUIDE_GEMINI_MODEL")?.trim() || "gemini-3.7-flash", input, timeoutMs, fetchImpl);
  } else {
    const apiKey = Deno.env.get("GROQ_API_KEY")?.trim() || "";
    if (!apiKey) throw new Error("Groq API key is missing.");
    decision = await groqToolChoice(apiKey, Deno.env.get("M6_GUIDE_GROQ_MODEL")?.trim() || "openai/gpt-oss-20b", input, timeoutMs, fetchImpl);
  }
  if (!GUIDE_AGENT_TOOLS.some((tool) => tool.name === decision.toolName)) {
    throw new Error(`${provider} returned an unknown Guide tool: ${decision.toolName}`);
  }
  return decision;
}

export function toolMode(toolName: string) {
  if (toolName === "search_catalogue") return "recommend";
  if (toolName === "search_place_facts" || toolName === "get_catalogue_place" || toolName === "get_place_information") return "place_info";
  if (toolName === "get_travel_info") return "travel_info";
  if (toolName === "get_weather_forecast") return "travel_info";
  if (toolName === "get_route_estimate") return "travel_info";
  if (toolName === "get_guide_capabilities") return "help";
  if (toolName === "prepare_guide_action") return "action";
  if (toolName === "trigger_emergency") return "emergency";
  return "small_talk";
}
