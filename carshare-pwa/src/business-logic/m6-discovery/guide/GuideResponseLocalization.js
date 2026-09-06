// ===== BUSINESS LOGIC LAYER (Tumpang Guide response localization) =====
// Localizing a displayed response must never rerun retrieval. This module only
// changes human-facing copy and quick replies; place IDs, roles, evidence,
// ordering, batch IDs and plan facts remain untouched.
import { GUIDE_MODE } from './constants.js';
import { guideCopy, normalizeGuideLanguage } from './GuideLanguage.js';
import { greetingAt } from './GuideGreetings.js';

function missingField(plan = {}) {
  if (!plan.origin?.label) return 'origin';
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

// What the Guide actually said, in whatever language it said it.
//
// This module runs over RESTORED history (TumpangGuidePage's
// localizeStoredMessages), never over the live turn - so replacing a stored
// message with canned copy here does not "translate" a conversation, it
// rewrites what the assistant is recorded as having said. Production caught
// exactly that: reopening a saved chat turned "你想查到哪个地点的车程？"
// into "What matters most: food, heritage, nature, or an event?" - a
// question that was never asked - because that message was source:"rules"
// (real deterministic server copy, not AI) and the old not-AI branch always
// rebuilt clarify text from the canned template. Precedence is therefore: a
// real translation OF THIS MESSAGE, else this message verbatim, else - only
// for a response carrying no text at all - the canned line.
const storedMessageText = (response) => response.localizedMessage || response.assistantMessage || '';

const cachedTranslationFor = (response, language) => response.localizedMessages?.[language]
  || response.localizedMessages?.[normalizeGuideLanguage(language)];

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
    // `language` belongs to the answer itself. The page's selected interface
    // language is passed separately and must not rewrite a mixed-language
    // conversation or its Travel Brief.
    language: response.language || originalLanguage,
    originalLanguage,
    planState: response.planState,
    // v3 keeps the conversation free-form. Only explicit, real app actions
    // belong below a response; localization must not recreate canned prompts.
    quickReplies: [],
    actions: localizeActions(response.actions, copy),
    localizedMessage: response.localizedMessage
  };

  // The welcome message is one of several rotating greetings (GuideGreetings.js),
  // not the single fixed copy.welcome string - a UI-language switch must
  // re-translate the *same* greeting slot the user was shown, not silently
  // re-roll into a different one or fall back to the old static line. Older
  // cached snapshots predating rotation have no greetingIndex, so they fall
  // back to copy.welcome exactly as before.
  if (response.traceId === 'welcome') {
    localized.localizedMessage = Number.isInteger(response.greetingIndex)
      ? greetingAt(language, response.greetingIndex)
      : copy.welcome;
  }
  else if (response.mode === GUIDE_MODE.CLARIFY) {
    localized.localizedMessage = cachedTranslationFor(response, language)
      || storedMessageText(response) || clarifyMessage(copy, response.planState);
  }
  if (response.mode === GUIDE_MODE.RECOMMEND) {
    localized.localizedMessage = cachedTranslationFor(response, language)
      || storedMessageText(response) || copy.recommend;
  }
  if (response.mode === GUIDE_MODE.TRAVEL_INFO) {
    // travel_info had no branch at all, which is the only reason the weather
    // answers survived the restore bug intact. Give it the same precedence as
    // every other mode so a language switch can still pick up a real
    // translation, without ever inventing replacement text.
    localized.localizedMessage = cachedTranslationFor(response, language) || storedMessageText(response);
  }
  if (response.mode === GUIDE_MODE.FALLBACK) {
    localized.localizedMessage = response.source === 'unavailable'
      ? copy.retryNotice
      : response.recommendations?.length ? copy.offline : copy.noCandidates;
  }
  if (response.mode === GUIDE_MODE.EMERGENCY) localized.localizedMessage = copy.emergency;
  if (response.mode === GUIDE_MODE.HELP) {
    const cachedTranslation = response.localizedMessages?.[language]
      || response.localizedMessages?.[normalizeGuideLanguage(language)];
    localized.localizedMessage = cachedTranslation
      || (normalizeGuideLanguage(originalLanguage) === normalizeGuideLanguage(language)
        ? response.assistantMessage : response.assistantMessage || copy.helpMissing);
  }
  if (response.mode === GUIDE_MODE.SMALL_TALK) {
    const cachedTranslation = response.localizedMessages?.[language]
      || response.localizedMessages?.[normalizeGuideLanguage(language)];
    localized.localizedMessage = cachedTranslation
      || (normalizeGuideLanguage(originalLanguage) === normalizeGuideLanguage(language)
        ? response.assistantMessage : response.localizedMessage || response.assistantMessage);
  }
  if (response.mode === GUIDE_MODE.ACTION) {
    const cachedTranslation = response.localizedMessages?.[language]
      || response.localizedMessages?.[normalizeGuideLanguage(language)];
    localized.localizedMessage = cachedTranslation
      || (normalizeGuideLanguage(originalLanguage) === normalizeGuideLanguage(language)
        ? response.assistantMessage : response.localizedMessage || response.assistantMessage);
  }
  if (response.mode === GUIDE_MODE.PLACE_INFO) {
    const cachedTranslation = response.localizedMessages?.[language]
      || response.localizedMessages?.[normalizeGuideLanguage(language)];
    localized.localizedMessage = cachedTranslation
      || (normalizeGuideLanguage(originalLanguage) === normalizeGuideLanguage(language)
        ? response.assistantMessage : response.localizedMessage || response.assistantMessage);
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
