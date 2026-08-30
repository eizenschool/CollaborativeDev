// ===== BUSINESS LOGIC LAYER (Tumpang Guide response localization) =====
// Localizing a displayed response must never rerun retrieval. This module only
// changes human-facing copy and quick replies; place IDs, roles, evidence,
// ordering, batch IDs and plan facts remain untouched.
import { GUIDE_MODE } from './constants.js';
import { guideCopy, normalizeGuideLanguage } from './GuideLanguage.js';

const CORE_REPLIES = Object.freeze({
  en: Object.freeze({ clarify: ['A nature day tomorrow', 'Food this weekend', 'How does this work?'], recommend: ['Make it more practical', 'Recommend other places', 'Change the date'] }),
  'zh-CN': Object.freeze({ clarify: ['明天的自然日', '这个周末吃美食', '这个助手怎么用？'], recommend: ['更实用一点', '推荐其他地点', '更改日期'] }),
  ms: Object.freeze({ clarify: ['Hari alam esok', 'Makanan hujung minggu ini', 'Bagaimana ini berfungsi?'], recommend: ['Jadikan lebih praktikal', 'Cadangkan tempat lain', 'Tukar tarikh'] }),
  ta: Object.freeze({ clarify: ['நாளை இயற்கை நாள்', 'இந்த வார இறுதி உணவு', 'இது எப்படி செயல்படும்?'], recommend: ['இன்னும் நடைமுறையான இடம்', 'வேறு இடங்களைப் பரிந்துரைக்கவும்', 'தேதியை மாற்றவும்'] })
});

function missingField(plan = {}) {
  if (!plan.startDate) return 'date';
  if (!plan.origin?.label) return 'origin';
  if (!plan.partySize) return 'party';
  if (!plan.preferredCategories?.length) return 'preference';
  return null;
}

function clarifyMessage(copy, plan) {
  const field = missingField(plan);
  return field === 'date' ? copy.askDate
    : field === 'origin' ? copy.askOrigin
      : field === 'party' ? copy.askParty
        : field === 'preference' ? copy.askPreference : copy.recommend;
}

function coreReplies(mode, language, response) {
  const replies = CORE_REPLIES[language];
  if (!replies) {
    const copy = response.languagePack?.copy || response.languagePack || null;
    const dynamic = mode === GUIDE_MODE.CLARIFY || mode === GUIDE_MODE.HELP
      ? [copy?.quickNature, copy?.quickFood, copy?.quickHelp]
      : mode === GUIDE_MODE.RECOMMEND || mode === GUIDE_MODE.FALLBACK
        ? [copy?.quickPractical, copy?.quickDifferent, copy?.quickDate]
        : [];
    return dynamic.length && dynamic.every((reply) => typeof reply === 'string' && reply.trim())
      ? dynamic : response.quickReplies || [];
  }
  if (mode === GUIDE_MODE.CLARIFY) return replies.clarify;
  if (mode === GUIDE_MODE.RECOMMEND || mode === GUIDE_MODE.FALLBACK) return replies.recommend;
  return response.quickReplies || [];
}

function localizeActions(actions, copy) {
  const labels = {
    open_place: copy.details,
    find_ride: copy.findRide,
    record_interest: copy.saveInterest,
    register_ride_alert: copy.rideAlert,
    save_preferences: copy.savePreferences,
    request_catalogue: copy.requestCatalogue,
    call_emergency: copy.callEmergency,
    open_profile: copy.trustedFamily
  };
  return (actions || []).map((action) => labels[action?.type]
    ? { ...action, label: labels[action.type] }
    : action);
}

/**
 * Return a display-safe copy of a response for one of the four built-in
 * languages. The returned object is deliberately non-mutating and keeps the
 * recommendation batch exactly as it was.
 */
export function localizeGuideResponse(response, language, languagePack = null) {
  if (!response) return response;
  const copy = guideCopy(language, languagePack);
  const originalLanguage = response.originalLanguage || response.language || language;
  const localized = {
    ...response,
    language,
    originalLanguage,
    planState: response.planState ? { ...response.planState, language } : response.planState,
    quickReplies: coreReplies(response.mode, language, { ...response, languagePack }),
    actions: localizeActions(response.actions, copy),
    localizedMessage: response.localizedMessage
  };

  if (response.traceId === 'welcome') localized.localizedMessage = copy.welcome;
  else if (response.mode === GUIDE_MODE.CLARIFY) localized.localizedMessage = clarifyMessage(copy, response.planState);
  if (response.mode === GUIDE_MODE.RECOMMEND) {
    const translated = response.localizedMessages?.[language]
      || response.localizedMessages?.[normalizeGuideLanguage(language)];
    localized.localizedMessage = response.source === 'gemini'
      ? translated || (normalizeGuideLanguage(originalLanguage) === normalizeGuideLanguage(language)
        ? response.assistantMessage : copy.recommend)
      : copy.recommend;
  }
  if (response.mode === GUIDE_MODE.FALLBACK) localized.localizedMessage = response.recommendations?.length ? copy.offline : copy.noCandidates;
  if (response.mode === GUIDE_MODE.EMERGENCY) localized.localizedMessage = copy.emergency;
  if (response.mode === GUIDE_MODE.HELP) {
    const cachedTranslation = response.localizedMessages?.[language]
      || response.localizedMessages?.[normalizeGuideLanguage(language)];
    localized.localizedMessage = cachedTranslation
      || (normalizeGuideLanguage(originalLanguage) === normalizeGuideLanguage(language)
        ? response.assistantMessage : response.assistantMessage || copy.helpMissing);
  }
  if (response.mode === GUIDE_MODE.CATALOGUE_MISSING) {
    const requestedName = response.actions?.find((action) => action?.type === 'request_catalogue')?.requestedName;
    localized.localizedMessage = requestedName
      ? `${requestedName}: ${copy.catalogueMissing || copy.noCandidates}`
      : response.localizedMessage || response.assistantMessage || copy.catalogueMissing || copy.noCandidates;
  }

  // A core-language response never keeps a stale translated string from a
  // previous language. Unknown/dynamic languages are handled by the Edge
  // translation path instead.
  return localized;
}

export function localizedDifferentPlacesCommand(language, languagePack = null) {
  const copy = guideCopy(language, languagePack);
  return copy.quickDifferent || (language === 'zh-CN' ? '推荐其他地点'
    : language === 'ms' ? 'Cadangkan tempat lain'
      : language === 'ta' ? 'வேறு இடங்களைப் பரிந்துரைக்கவும்' : 'Recommend other places');
}
