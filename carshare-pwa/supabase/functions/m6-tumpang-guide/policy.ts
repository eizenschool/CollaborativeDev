export const MODES = ["clarify", "recommend", "help", "catalogue_missing", "emergency", "fallback"] as const;
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
  }
  return { valid: true };
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
    origin: origin ? { label: String(origin.label || "").slice(0, 80) } : null,
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
    recommendationMode: ["default", "different", "quieter"].includes(String(source.recommendationMode)) ? source.recommendationMode : "default"
  };
}

export function isEmergencyText(value: string) {
  return /\b(emergency|danger|unsafe|attack|accident|help me|police|ambulance|sos)\b|紧急|危險|危险|救命|报警|kecemasan|bahaya|kemalangan|அவசரம்|ஆபத்து|விபத்து/iu.test(value);
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

const RULES_COPY: Record<string, { fallback: string; noCandidates: string; helpMissing: string; catalogueMissing: string; quota: string; burst: string; quickReplies: string[] }> = {
  en: {
    fallback: "Smart recommendations are using verified catalogue rules right now.",
    noCandidates: "I couldn't find a verified catalogue place that fits those conditions. Try another date or preference.",
    helpMissing: "I couldn't find a verified Help section for that. Please open the relevant app page for the official guidance.",
    catalogueMissing: "This place is not in the catalogue, so I will not recommend it. A signed-in user can request a review before it is ever suggested.",
    quota: "The Guide turn limit has been reached. Saved plans remain available.",
    burst: "Please pause briefly before asking again.",
    quickReplies: ["Change the date", "Show quieter places"]
  },
  "zh-CN": {
    fallback: "智能推荐目前正在使用已验证的地点目录规则。",
    noCandidates: "我找不到符合这些条件的已验证目录地点。你可以换一个日期或偏好。",
    helpMissing: "我找不到已验证的相关帮助内容。请打开对应的应用页面查看官方指引。",
    catalogueMissing: "这个地点不在目录中，所以我不会推荐它。登入用户可以先申请审核，确认后才可能被推荐。",
    quota: "Guide 的对话额度已用完，但已保存的计划仍然可以查看。",
    burst: "请稍等片刻后再提问。",
    quickReplies: ["更改日期", "推荐更安静的地点"]
  },
  ms: {
    fallback: "Cadangan pintar sedang menggunakan peraturan katalog yang disahkan sekarang.",
    noCandidates: "Saya tidak menemui tempat katalog yang disahkan dan sesuai dengan syarat ini. Cuba tarikh atau pilihan lain.",
    helpMissing: "Saya tidak menemui bahagian Bantuan yang disahkan. Buka halaman aplikasi yang berkaitan untuk panduan rasmi.",
    catalogueMissing: "Tempat ini tiada dalam katalog, jadi saya tidak akan mencadangkannya. Pengguna berdaftar boleh meminta semakan dahulu.",
    quota: "Had pusingan Guide telah dicapai. Pelan yang disimpan masih tersedia.",
    burst: "Sila tunggu sebentar sebelum bertanya lagi.",
    quickReplies: ["Tukar tarikh", "Tunjukkan tempat lebih tenang"]
  },
  ta: {
    fallback: "Smart பரிந்துரைகள் தற்போது சரிபார்க்கப்பட்ட பட்டியல் விதிகளைப் பயன்படுத்துகின்றன.",
    noCandidates: "இந்த நிபந்தனைகளுக்குப் பொருந்தும் சரிபார்க்கப்பட்ட பட்டியல் இடம் கிடைக்கவில்லை. வேறு தேதி அல்லது விருப்பத்தை முயற்சிக்கவும்.",
    helpMissing: "சரிபார்க்கப்பட்ட உதவிப் பகுதி கிடைக்கவில்லை. அதிகாரப்பூர்வ வழிகாட்டலுக்கு தொடர்புடைய செயலிப் பக்கத்தைத் திறக்கவும்.",
    catalogueMissing: "இந்த இடம் பட்டியலில் இல்லை; எனவே இதைப் பரிந்துரைக்க மாட்டேன். உள்நுழைந்த பயனர் முதலில் மதிப்பாய்வைக் கோரலாம்.",
    quota: "Guide உரையாடல் வரம்பு முடிந்தது. சேமித்த திட்டங்கள் தொடர்ந்து கிடைக்கும்.",
    burst: "மீண்டும் கேட்பதற்கு முன் சிறிது நேரம் காத்திருக்கவும்.",
    quickReplies: ["தேதியை மாற்று", "அமைதியான இடங்களைக் காட்டு"]
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
