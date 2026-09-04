export const MODES = ["clarify", "recommend", "help", "small_talk", "action", "place_info", "travel_info", "catalogue_missing", "emergency", "fallback"] as const;
// A search-tool answer (get_place_information/get_travel_info) may only ever
// be prose - never a recommendation batch or an app action. This is the
// hard architectural boundary between "the AI found and summarized public
// information" and "the AI recommended a place" - the two must never be
// producible by the same response.
export const SEARCH_ANSWER_MODES = new Set(["place_info", "travel_info"]);
export const ROLES = ["best_match", "practical_alternative", "wildcard"] as const;
export const ACTIONS = ["open_place", "find_ride", "record_interest", "register_ride_alert", "save_preferences", "request_catalogue", "open_profile", "call_emergency"] as const;
export const REASON_CODES = ["affinity", "season", "quality", "headroom", "local", "seat_headroom", "journey_cost", "demand_convergence", "weather_checked", "date_range_consistency"] as const;
export const TRADEOFF_CODES = ["none", "no_ride_yet", "farther_away", "busier_choice", "thin_reviews", "lower_personal_match"] as const;

type Row = Record<string, unknown>;
type Recommendation = { placeId: string; role: string; verifiedReasonCodes: string[]; tradeoffCode: string };

export function validateModelResponse(value: unknown, candidates: Row[], expectedRecommendations: Recommendation[] | null = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { valid: false, reason: "invalid_json_shape" };
  const row = value as Row;
  if (!MODES.includes(row.mode as typeof MODES[number])) return { valid: false, reason: "unknown_mode" };
  if (!/^[a-z]{2,3}(?:-[A-Za-z]{2,8})?$/.test(String(row.language || ""))) return { valid: false, reason: "unknown_language" };
  if (typeof row.assistantMessage !== "string" || !row.assistantMessage.trim()) return { valid: false, reason: "missing_message" };
  if (!row.planState || typeof row.planState !== "object" || Array.isArray(row.planState)) return { valid: false, reason: "invalid_plan_state" };
  if (!Array.isArray(row.recommendations) || row.recommendations.length > 3) return { valid: false, reason: "invalid_recommendations" };
  if (row.mode === "recommend" && row.recommendations.length !== Math.min(3, candidates.length)) return { valid: false, reason: "incomplete_recommendations" };
  if (!Array.isArray(row.quickReplies) || !Array.isArray(row.actions)) return { valid: false, reason: "invalid_collections" };
  if (row.mode === "small_talk" && (row.recommendations.length || row.actions.length)) return { valid: false, reason: "small_talk_has_actions" };
  const candidateById = new Map(candidates.map((candidate) => [String(candidate.id), candidate]));
  const expectedById = expectedRecommendations
    ? new Map(expectedRecommendations.map((item) => [String(item.placeId), item])) : null;
  const seen = new Set<string>();
  const seenRoles = new Set<string>();
  for (const item of row.recommendations as Recommendation[]) {
    const candidate = candidateById.get(String(item?.placeId));
    if (!candidate) return { valid: false, reason: "place_not_allowlisted", rejectedPlaceId: item?.placeId || null };
    if (seen.has(item.placeId)) return { valid: false, reason: "duplicate_place" };
    seen.add(item.placeId);
    if (!ROLES.includes(item.role as typeof ROLES[number])) return { valid: false, reason: "unknown_role" };
    if (seenRoles.has(item.role)) return { valid: false, reason: "duplicate_role" };
    seenRoles.add(item.role);
    const evidence = new Set(Array.isArray(candidate.reasonCodes) ? candidate.reasonCodes.map(String) : []);
    if (!Array.isArray(item.verifiedReasonCodes) || !item.verifiedReasonCodes.length
        || item.verifiedReasonCodes.some((code) => !REASON_CODES.includes(code as typeof REASON_CODES[number]) || !evidence.has(code))) {
      return { valid: false, reason: "unverified_reason" };
    }
    if (!TRADEOFF_CODES.includes(item.tradeoffCode as typeof TRADEOFF_CODES[number])) return { valid: false, reason: "unknown_tradeoff" };
    if (expectedById) {
      const expected = expectedById.get(String(item.placeId));
      if (!expected || expected.role !== item.role || expected.tradeoffCode !== item.tradeoffCode
          || JSON.stringify(expected.verifiedReasonCodes) !== JSON.stringify(item.verifiedReasonCodes)) {
        return { valid: false, reason: "provider_changed_rule_batch", rejectedPlaceId: item.placeId };
      }
    }
  }
  if (expectedById && (seen.size !== expectedById.size
      || [...expectedById.keys()].some((id) => !seen.has(id)))) return { valid: false, reason: "provider_changed_rule_batch" };
  for (const item of row.actions as Array<{ type?: string; placeId?: string }>) {
    if (!ACTIONS.includes(item?.type as typeof ACTIONS[number])) return { valid: false, reason: "unknown_action" };
    if (item.placeId && !candidateById.has(item.placeId)) return { valid: false, reason: "action_place_not_allowlisted", rejectedPlaceId: item.placeId };
    if (["record_interest", "register_ride_alert", "save_preferences", "request_catalogue"].includes(String(item.type))
        && (item as { requiresConfirmation?: unknown }).requiresConfirmation !== true) {
      return { valid: false, reason: "action_confirmation_required" };
    }
  }
  return { valid: true };
}

/**
 * The one choke point every response must pass through before it can leave
 * the pipeline: a search-tool answer (place_info/travel_info) can never
 * carry a recommendation card or an executable action. Symmetric to
 * validateModelResponse's catalogue-ID allowlist - "rules own the boundary,
 * the model only writes the words inside it." A violation is rejected, not
 * silently stripped, because silently dropping the offending fields would
 * hide a real prompt-engineering bug instead of surfacing it.
 */
export function assertNoCardsOrActionsFromSearch(mode: unknown, response: Row) {
  if (!SEARCH_ANSWER_MODES.has(String(mode))) return { valid: true };
  const recommendations = Array.isArray(response?.recommendations) ? response.recommendations : [];
  const actions = Array.isArray(response?.actions) ? response.actions : [];
  if (recommendations.length || actions.length) {
    return { valid: false, reason: "search_response_had_cards_or_actions" };
  }
  return { valid: true };
}

// The routing prompt repeatedly loses to conversation momentum on real
// models: after several recommend turns, a pure weather/transport question
// still gets routed to search_catalogue instead of get_travel_info - even
// though the model's own drafted assistantMessage plainly admits it can't
// check real-time conditions. That admission is itself proof the model
// recognised this was an information request, not a destination request.
// This is a narrow, text-level contradiction check, not a routing
// override: it never changes which tool a *confident* answer used, and it
// only ever removes cards from a response whose own wording already
// disowns them. Multi-language, matched against a handful of confirmed
// real phrasings rather than an exhaustive grammar - false negatives (a
// differently-worded admission slipping through) are expected and fine;
// this is a safety net, not the fix for the routing prompt itself.
const SELF_CONTRADICTED_INFO_PATTERNS = [
  /\bcan(?:'t|not) (?:check|confirm|provide|access) (?:live|real-time|real time)\b/i,
  /\bunable to (?:check|confirm|provide|access) (?:live|real-time|real time)\b/i,
  /(无法|不能)(提供|查询|查看|检查|确认).{0,6}(实时|即时)/,
  /(无法|不能)(提供|查询|查看|检查|确认).{0,10}(天气|预报|路况|交通)/,
  /tidak dapat (?:menyemak|mengesahkan|menyediakan) .{0,20}(masa nyata|langsung)/i,
  /நேரடி.{0,10}(வானிலை|போக்குவரத்து).{0,10}(முடியாது|இயலாது)/
];

export function detectSelfContradictedInfoRecommendation(mode: unknown, response: Row) {
  if (String(mode) !== "recommend") return { matched: false };
  const recommendations = Array.isArray(response?.recommendations) ? response.recommendations : [];
  if (!recommendations.length) return { matched: false };
  const message = String(response?.assistantMessage || "");
  if (!message) return { matched: false };
  const matched = SELF_CONTRADICTED_INFO_PATTERNS.some((pattern) => pattern.test(message));
  return { matched, reason: matched ? "self_contradicted_info_recommendation" : undefined };
}

export function sanitizePlanState(value: unknown) {
  const source = value && typeof value === "object" ? value as Row : {};
  const origin = source.origin && typeof source.origin === "object" ? source.origin as Row : null;
  const categories = Array.isArray(source.preferredCategories)
    ? [...new Set(source.preferredCategories.map(String).filter((item) => ["culinary", "heritage", "nature", "event"].includes(item)))].slice(0, 4)
    : [];
  const party = Number(source.partySize);
  const date = (candidate: unknown) => /^20\d{2}-\d{2}-\d{2}$/.test(String(candidate || "")) ? String(candidate) : null;
  const startDate = date(source.startDate);
  const requestedEnd = date(source.endDate) || startDate;
  let endDate = requestedEnd;
  if (startDate && requestedEnd) {
    const maximum = new Date(`${startDate}T00:00:00Z`);
    maximum.setUTCDate(maximum.getUTCDate() + 6);
    const maximumIso = maximum.toISOString().slice(0, 10);
    if (endDate > maximumIso) endDate = maximumIso;
  }
  return {
    origin: origin ? {
      label: String(origin.label || "").slice(0, 80),
      ...(String(origin.placeId || "").trim() ? { placeId: String(origin.placeId).trim().slice(0, 180) } : {})
    } : null,
    partySize: Number.isInteger(party) && party >= 1 && party <= 20 ? party : null,
    startDate,
    endDate: startDate && endDate && endDate >= startDate ? endDate : startDate,
    preferredCategories: categories,
    budget: ["free", "low", "medium", "premium"].includes(String(source.budget)) ? source.budget : null,
    indoorPreference: ["indoor", "outdoor", "either"].includes(String(source.indoorPreference)) ? source.indoorPreference : "either",
    accessibilityRequired: Boolean(source.accessibilityRequired),
    children: Boolean(source.children),
    tripHistoryConsent: Boolean(source.tripHistoryConsent),
    language: /^[a-z]{2,3}(?:-[A-Za-z]{2,8})?$/.test(String(source.language || "")) ? source.language : "en",
    recommendationMode: ["default", "different", "quieter", "expanded"].includes(String(source.recommendationMode)) ? source.recommendationMode : "default",
    searchRadiusKm: [80, 160, 320].includes(Number(source.searchRadiusKm)) ? Number(source.searchRadiusKm) : 80
  };
}

export function isEmergencyText(value: string) {
  return /\b(?:call\s+999|medical emergency|immediate danger|being attacked|car (?:crash|accident)|someone (?:is )?(?:unconscious|bleeding|dying)|need (?:the )?(?:police|ambulance) now|cannot breathe|chest pain)\b|拨打\s*999|立即危险|有人(?:昏迷|流血|快死)|正在被攻击|严重车祸|无法呼吸|胸痛|hubungi\s*999|bahaya segera|sedang diserang|kemalangan serius|sukar bernafas|sakit dada|999\s*ஐ?\s*அழை|உடனடி ஆபத்து|தாக்கப்படுகிறேன்|மூச்சு விட முடியவில்லை|நெஞ்சு வலி/iu.test(value);
}

export function isOrdinaryDiscomfortText(value: string) {
  return /\b(?:feel(?:ing)? (?:unwell|uncomfortable|sick)|not feeling well|a bit unwell|kurang sihat|tak sihat|rasa tidak selesa)\b|不舒服|有点难受|感覺不適|感觉不适|உடல்நிலை சரியில்லை|சற்று உடல்நலம் சரியில்லை/iu.test(value);
}

export function isHelpText(value: string) {
  return /\b(how (?:do|can|to)|where (?:is|can)|use the app|ride alert|save chat|trip history|privacy)\b|怎么|如何|在哪|隐私|历史|bagaimana|cara|privasi|sejarah|எப்படி|எங்கே|தனியுரிமை|வரலாறு/iu.test(value);
}

export function extractCatalogueRequestName(value: string) {
  const text = String(value || "").trim();
  const match = text.match(/(?:add|request|include)\s+(?:the place\s+)?["“']?([^"”']{2,120})["”']?(?:\s+to (?:the )?catalogue)?$/iu)
    || text.match(/(?:添加|加入|申请)\s*["“']?([^"”']{2,80})["”']?/u)
    || text.match(/(?:tambah|mohon)\s+["“']?([^"”']{2,120})["”']?/iu)
    || text.match(/(?:சேர்|கோரிக்கை)\s+["“']?([^"”']{2,100})["”']?/u);
  return match?.[1]?.trim().replace(/\s+to (?:the )?catalogue$/iu, "") || null;
}

function tradeoff(candidate: Row, best: Row) {
  if (!candidate.hasRide) return "no_ride_yet";
  if ((Number(candidate.review_count) || 0) < 10) return "thin_reviews";
  if (Number.isFinite(Number(candidate.distanceKm)) && Number.isFinite(Number(best.distanceKm))
      && Number(candidate.distanceKm) > Number(best.distanceKm) + 40) return "farther_away";
  if (Number(candidate.desirability) + .12 < Number(best.desirability)) return "lower_personal_match";
  return "none";
}

const RULES_COPY: Record<string, { fallback: string; noCandidates: string; helpMissing: string; catalogueMissing: string; quota: string; guestQuota: string; burst: string; quickReplies: string[] }> = {
  en: {
    fallback: "Smart recommendations are using verified catalogue rules right now.",
    noCandidates: "I couldn't find a verified catalogue place that fits those conditions. Try another date or preference.",
    helpMissing: "Tumpang Guide understands natural travel requests, recommends only catalogue places, explains a named catalogue place, prepares supported actions after confirmation, and keeps signed-in plans in Past Plans. Ask me about a day, a place, or any of these features.",
    catalogueMissing: "This place is not in the Let's Tumpang catalogue. I cannot provide place information, search the web, recommend it or create an app action for it.",
    quota: "The Guide turn limit has been reached. Saved plans remain available.",
    guestQuota: "You've used your 3 free recommendation searches for this guest session — thanks for exploring with me! Sign in and I'll help you plan as many trips as you like, completely free.",
    burst: "Please pause briefly before asking again.",
    quickReplies: []
  },
  "zh-CN": {
    fallback: "智能推荐目前正在使用已验证的地点目录规则。",
    noCandidates: "我找不到符合这些条件的已验证目录地点。你可以换一个日期或偏好。",
    helpMissing: "Tumpang Guide 可以理解自然语言旅行需求，只推荐资料库地点，介绍已收录地点，准备需确认的应用操作，并让登入用户在历史计划中查看计划。你可以直接问我想去哪一天、某个地点或这些功能怎么用。",
    catalogueMissing: "这个地点目前不在 Let's Tumpang 资料库中。我不能为它搜索网络资料、推荐它或建立应用操作。",
    quota: "Guide 的对话额度已用完，但已保存的计划仍然可以查看。",
    guestQuota: "你已经用完这次访客对话的 3 次免费推荐名额啦——谢谢你陪我探索！登入之后就可以无限次规划行程，完全免费。",
    burst: "请稍等片刻后再提问。",
    quickReplies: []
  },
  ms: {
    fallback: "Cadangan pintar sedang menggunakan peraturan katalog yang disahkan sekarang.",
    noCandidates: "Saya tidak menemui tempat katalog yang disahkan dan sesuai dengan syarat ini. Cuba tarikh atau pilihan lain.",
    helpMissing: "Tumpang Guide memahami permintaan perjalanan biasa, hanya mencadangkan tempat dalam katalog, menerangkan tempat yang disenaraikan, menyediakan tindakan selepas pengesahan, dan menyimpan pelan pengguna log masuk dalam Pelan terdahulu. Tanyakan tentang hari, tempat atau cara menggunakan ciri ini.",
    catalogueMissing: "Tempat ini belum ada dalam katalog Let's Tumpang. Saya tidak boleh mencari maklumat web, mencadangkannya atau menyediakan tindakan aplikasi untuk tempat ini.",
    quota: "Had pusingan Guide telah dicapai. Pelan yang disimpan masih tersedia.",
    guestQuota: "Anda telah menggunakan 3 carian cadangan percuma untuk sesi tetamu ini — terima kasih kerana meneroka bersama saya! Log masuk dan saya boleh bantu anda merancang seberapa banyak perjalanan yang anda mahu, percuma.",
    burst: "Sila tunggu sebentar sebelum bertanya lagi.",
    quickReplies: []
  },
  ta: {
    fallback: "Smart பரிந்துரைகள் தற்போது சரிபார்க்கப்பட்ட பட்டியல் விதிகளைப் பயன்படுத்துகின்றன.",
    noCandidates: "இந்த நிபந்தனைகளுக்குப் பொருந்தும் சரிபார்க்கப்பட்ட பட்டியல் இடம் கிடைக்கவில்லை. வேறு தேதி அல்லது விருப்பத்தை முயற்சிக்கவும்.",
    helpMissing: "Tumpang Guide இயல்பான பயணக் கோரிக்கைகளைப் புரிந்து கொண்டு, பட்டியலில் உள்ள இடங்களை மட்டுமே பரிந்துரைக்கும்; பட்டியல் இடங்களை விளக்கும்; உறுதிப்படுத்திய பிறகு ஆதரிக்கப்படும் செயல்களைத் தயாரிக்கும்; உள்நுழைந்த பயனர்களின் திட்டங்களை முந்தைய திட்டங்களில் வைத்திருக்கும். நாள், இடம் அல்லது இந்த அம்சங்களைப் பற்றி கேளுங்கள்.",
    catalogueMissing: "இந்த இடம் Let's Tumpang பட்டியலில் இல்லை. இதற்காக இணையத் தகவல் தேடல், பரிந்துரை அல்லது செயலி நடவடிக்கை வழங்க முடியாது.",
    quota: "Guide உரையாடல் வரம்பு முடிந்தது. சேமித்த திட்டங்கள் தொடர்ந்து கிடைக்கும்.",
    guestQuota: "இந்த விருந்தினர் அமர்விற்கான 3 இலவச பரிந்துரை தேடல்களையும் பயன்படுத்திவிட்டீர்கள் — என்னுடன் ஆராய்ந்ததற்கு நன்றி! உள்நுழைந்து விருப்பப்படி பயணங்களைத் திட்டமிட உதவுவேன், முழுக்க இலவசமாக.",
    burst: "மீண்டும் கேட்பதற்கு முன் சிறிது நேரம் காத்திருக்கவும்.",
    quickReplies: []
  }
};

export function guideRulesCopy(language: unknown) {
  return RULES_COPY[String(language)] || RULES_COPY.en;
}

export function deterministicFallback(candidates: Row[], planState: Row, remainingTurns: number, reason: string, traceId: string, recommendations: Recommendation[] | null = null, batchId: string | null = null, copyOverride: Partial<ReturnType<typeof guideRulesCopy>> = {}) {
  const roles = ["best_match", "practical_alternative", "wildcard"];
  const best = candidates[0] || {};
  const copy = { ...guideRulesCopy(planState.language), ...copyOverride };
  return {
    mode: "fallback", assistantMessage: copy.fallback, language: planState.language || "en", planState,
    quickReplies: copy.quickReplies,
    recommendations: (recommendations || candidates.slice(0, 3).map((candidate, index) => ({
      placeId: candidate.id,
      role: roles[index],
      verifiedReasonCodes: Array.isArray(candidate.reasonCodes) && candidate.reasonCodes.length ? candidate.reasonCodes : ["local"],
      tradeoffCode: tradeoff(candidate, best)
    }))).map((item) => ({ ...item })),
    actions: [], remainingTurns, fallbackReason: reason, source: "rules", batchId, traceId
  };
}
