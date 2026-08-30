// ===== BUSINESS LOGIC LAYER (Tumpang Guide orchestration) =====
import { DestinationDiscoveryService } from '../discovery/DestinationDiscoveryService.js';
import { tumpangGuideStore } from '../../data-access/tumpangGuideStore.js';
import { tumpangGuideSupabaseRepository } from '../../data-access/tumpangGuideSupabaseRepository.js';
import {
  requestGuideFeedback, requestGuideLanguagePack, requestGuideTranslations, requestGuideTurn
} from '../../data-access/tumpangGuideEdgeRepository.js';
import {
  GUIDE_ACTION, GUIDE_FIXTURE_MODE, GUIDE_LANGUAGES, GUIDE_LIMITS, GUIDE_LIVE_CATALOGUE_MODE, GUIDE_LIVE_MODE, GUIDE_MODE, GUIDE_QA_MODE,
  GUIDE_STORAGE,
  GUIDE_MODEL
} from './constants.js';
import {
  guideCopy, isCompleteGuideLanguagePack, normalizeGuideLanguage, GUIDE_PACK_VERSION
} from './GuideLanguage.js';
import { mergeGuideIntent, mostImportantMissingField, normalizePlanState, sanitizedPlanSummary } from './GuideIntentParser.js';
import { createTraceId, isEmergencyIntent, isGuideHelpIntent, safeRecentMessages, validateGuideResponse } from './GuidePolicy.js';
import { runFixtureGuideTurn } from './GuideFixtureEngine.js';
import { afterSuccessfulGuideTurn, guideQuotaState } from './GuideQuota.js';

const guestUsage = new Map();

function createBatchId() {
  const generated = globalThis.crypto?.randomUUID?.();
  if (generated) return generated;
  const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${hex()}${hex()}${hex()}${hex()}-${hex()}-4${hex().slice(1)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${hex().slice(1)}-${hex()}${hex()}${hex()}`;
}

function guestQuota(visitorSessionId) {
  const used = guestUsage.get(visitorSessionId) || 0;
  return guideQuotaState(used, GUIDE_LIMITS.GUEST_SESSION_TURNS);
}

function recordGuestSuccess(visitorSessionId) {
  const quota = guestQuota(visitorSessionId);
  if (!quota.allowed) return quota;
  const used = guestUsage.get(visitorSessionId) || 0;
  guestUsage.set(visitorSessionId, used + 1);
  return afterSuccessfulGuideTurn(used, GUIDE_LIMITS.GUEST_SESSION_TURNS);
}

function fixtureQuota(user, visitorSessionId) {
  if (!user?.id) return guestQuota(visitorSessionId);
  return guideQuotaState(tumpangGuideStore.dailyUsage(`user:${user.id}`), GUIDE_LIMITS.AUTHENTICATED_DAILY_TURNS);
}

function recordFixtureSuccess(user, visitorSessionId) {
  return user?.id
    ? tumpangGuideStore.recordSuccessfulTurn(`user:${user.id}`, GUIDE_LIMITS.AUTHENTICATED_DAILY_TURNS)
    : recordGuestSuccess(visitorSessionId);
}

function fallbackFromVerified(response, language, reason) {
  return {
    ...response,
    mode: response.recommendations?.length ? GUIDE_MODE.FALLBACK : response.mode,
    assistantMessage: response.recommendations?.length ? guideCopy(language).offline : response.assistantMessage,
    source: 'rules', fallbackReason: reason, traceId: response.traceId || createTraceId('fallback')
  };
}

function liveCatalogueUnavailable(planState, remainingTurns) {
  const plan = normalizePlanState(planState);
  return {
    mode: GUIDE_MODE.FALLBACK,
    assistantMessage: guideCopy(plan.language).noCandidates,
    language: plan.language, planState: plan, quickReplies: [], recommendations: [], actions: [],
    remainingTurns, fallbackReason: 'live_catalogue_not_configured', source: 'rules',
    batchId: null, traceId: createTraceId('catalogue')
  };
}

async function safeRulesTurn(args) {
  try {
    const plan = normalizePlanState(args.planState);

    // Normal builds must not fall back to the local fixture catalogue. If the
    // real catalogue is unavailable, keep clarification/help/emergency useful
    // but never fabricate a destination card.
    if (!GUIDE_FIXTURE_MODE && !GUIDE_LIVE_CATALOGUE_MODE) {
      const copy = guideCopy(plan.language);
      if (isEmergencyIntent(args.text)) {
        return { response: {
          mode: GUIDE_MODE.EMERGENCY, assistantMessage: copy.emergency, language: plan.language,
          planState: plan, quickReplies: [], recommendations: [], actions: [],
          remainingTurns: args.remainingTurns, fallbackReason: null, source: 'rules',
          batchId: null, traceId: createTraceId('rules')
        }, allowedCandidates: [] };
      }
      if (isGuideHelpIntent(args.text)) {
        return { response: {
          mode: GUIDE_MODE.HELP, assistantMessage: copy.helpMissing, language: plan.language,
          planState: plan, quickReplies: [], recommendations: [], actions: [],
          remainingTurns: args.remainingTurns, fallbackReason: 'help_source_missing', source: 'rules',
          batchId: null, traceId: createTraceId('rules')
        }, allowedCandidates: [] };
      }
      const missing = mostImportantMissingField(plan);
      if (missing) {
        const coreReplies = {
          en: { origin: ['From Kuala Lumpur'], party: ['2 people', '4 people'] },
          'zh-CN': { origin: ['从吉隆坡出发'], party: ['2 人', '4 人'] },
          ms: { origin: ['Dari Kuala Lumpur'], party: ['2 orang', '4 orang'] },
          ta: { origin: ['கோலாலம்பூரிலிருந்து'], party: ['2 பேர்', '4 பேர்'] }
        }[plan.language];
        const replies = {
          date: [copy.quickDate],
          origin: coreReplies?.origin || [],
          party: coreReplies?.party || [],
          preference: [copy.quickNature, copy.quickFood, copy.quickHelp]
        }[missing].filter(Boolean);
        const question = {
          date: copy.askDate, origin: copy.askOrigin, party: copy.askParty, preference: copy.askPreference
        }[missing];
        return { response: {
          mode: GUIDE_MODE.CLARIFY, assistantMessage: question, language: plan.language,
          planState: plan, quickReplies: replies, recommendations: [], actions: [],
          remainingTurns: args.remainingTurns, fallbackReason: null, source: 'rules',
          batchId: null, traceId: createTraceId('rules')
        }, allowedCandidates: [] };
      }
      return { response: liveCatalogueUnavailable(plan, args.remainingTurns), allowedCandidates: [] };
    }

    const result = await runFixtureGuideTurn(args);
    // A Gemini retry is an explanation retry, not a new recommendation run.
    // Reuse the already validated recommendation objects when the Edge
    // Function is unavailable so the fallback cannot silently change the card.
    if (args.fixedRecommendations?.length && result.allowedCandidates?.length) {
      const byId = new Map(result.allowedCandidates.map((candidate) => [String(candidate.placeId), candidate]));
      const fixed = args.fixedRecommendations
        .map((recommendation) => ({ ...recommendation, candidate: byId.get(String(recommendation.placeId)) }))
        .filter((recommendation) => recommendation.candidate);
      if (fixed.length === args.fixedRecommendations.length) {
        result.response = {
          ...result.response,
          mode: GUIDE_MODE.RECOMMEND,
          recommendations: fixed,
          fallbackReason: null
        };
      }
    }
    return result;
  }
  catch {
    const plan = normalizePlanState(args.planState);
    return { response: {
      mode: GUIDE_MODE.FALLBACK, assistantMessage: guideCopy(plan.language).noCandidates,
      language: plan.language, planState: plan, quickReplies: [], recommendations: [], actions: [],
      remainingTurns: args.remainingTurns, fallbackReason: 'catalogue_unavailable', source: 'rules',
      batchId: null, traceId: createTraceId('fallback')
    }, allowedCandidates: [] };
  }
}

async function hydrate(response) {
  const hydrated = await Promise.all((response.recommendations || []).map(async (recommendation) => ({
    ...recommendation, place: await DestinationDiscoveryService.getPlace(recommendation.placeId)
  })));
  return { ...response, recommendations: hydrated.filter((recommendation) => recommendation.place) };
}

function packStorageKey(language) { return `m6-guide-pack:${normalizeGuideLanguage(language)}:${GUIDE_PACK_VERSION}`; }

function readPack(language) {
  try {
    const value = JSON.parse(localStorage.getItem(packStorageKey(language)) || 'null');
    return isCompleteGuideLanguagePack(value) ? value : null;
  } catch { return null; }
}

function writePack(language, pack) {
  try { localStorage.setItem(packStorageKey(language), JSON.stringify(pack)); } catch { /* Cache is optional. */ }
}

function cachedSessionIndexKey(userId) {
  return `${GUIDE_STORAGE.SESSION_INDEX_KEY}:${userId}`;
}

function readCachedSessionIndex(userId) {
  if (!userId) return [];
  try {
    const rows = JSON.parse(sessionStorage.getItem(cachedSessionIndexKey(userId)) || '[]');
    if (!Array.isArray(rows)) return [];
    const cutoff = Date.now() - GUIDE_LIMITS.SESSION_RETENTION_DAYS * 86400000;
    return rows.filter((row) => row?.id && row.userId === userId
      && (!row.updatedAt || new Date(row.updatedAt).getTime() >= cutoff));
  } catch { return []; }
}

function writeCachedSessionIndex(userId, rows) {
  if (!userId) return;
  try { sessionStorage.setItem(cachedSessionIndexKey(userId), JSON.stringify(rows)); } catch { /* Cache is optional. */ }
}

function repeatedShownPlace(response, shownPlaceIds, recommendationMode) {
  if (recommendationMode !== 'different') return null;
  const shown = new Set((shownPlaceIds || []).map(String));
  return (response?.recommendations || []).find((item) => shown.has(String(item?.placeId)))?.placeId || null;
}

export const TumpangGuideService = {
  createSession(user, language = 'en', planState = {}) {
    if (!user?.id) return null;
    return GUIDE_FIXTURE_MODE
      ? tumpangGuideStore.createSession(user.id, language, normalizePlanState(planState))
      // Authenticated Edge requests require a UUID. The first turn creates
      // the actual row atomically, so this stable client ID is enough here.
      : { id: globalThis.crypto?.randomUUID?.() || createBatchId(), userId: user.id,
        language, planState: normalizePlanState(planState) };
  },

  async sendTurn({ user, sessionId, visitorSessionId, text, planState, messages, shownPlaceIds = [], language = null, languageLocked = false, qa = {}, online = true, retryBatchId = null, retryPlaceIds = [], retryRecommendations = [] }) {
    const limit = GUIDE_FIXTURE_MODE
      ? fixtureQuota(user, visitorSessionId)
      : { allowed: true, remaining: user?.id ? GUIDE_LIMITS.AUTHENTICATED_DAILY_TURNS : GUIDE_LIMITS.GUEST_SESSION_TURNS };
    if (!limit.allowed) {
      const language = normalizePlanState(planState).language;
      return { mode: GUIDE_MODE.FALLBACK, assistantMessage: user?.id
        ? 'You have used today’s 20 smart turns. Your saved plans remain available.'
        : 'This guest session has used its 5 smart turns. Sign in for saved plans and a larger daily allowance.',
      language, planState: normalizePlanState(planState), quickReplies: [], recommendations: [], actions: [],
      remainingTurns: 0, fallbackReason: 'rate_limit', source: 'rules', batchId: null, traceId: createTraceId('limit') };
    }

    const requestPlan = mergeGuideIntent(planState, text, {
      today: qa.today, manualLanguage: languageLocked ? (language || planState?.language) : null
    });
    const localRules = GUIDE_FIXTURE_MODE || !GUIDE_LIVE_CATALOGUE_MODE || !online || (GUIDE_QA_MODE && qa.forceFallback === 'offline');
    let raw;
    let allowedCandidates = [];
    if (localRules) {
      const completePlan = Boolean(requestPlan.startDate && requestPlan.origin?.label
        && requestPlan.partySize && requestPlan.preferredCategories?.length);
      if (!GUIDE_FIXTURE_MODE && !GUIDE_LIVE_CATALOGUE_MODE && completePlan) {
        // Normal builds must never recommend from the local fixture. A real
        // catalogue is required for a real recommendation; clarification and
        // controlled Help/emergency responses can still work without it.
        raw = liveCatalogueUnavailable(requestPlan, limit.remaining);
      } else {
        const simulatedLatency = Number(qa.latencyMs) || 0;
        const rules = await safeRulesTurn({ text, planState: requestPlan, userId: user?.id,
          remainingTurns: limit.remaining, qa, shownPlaceIds, languageLocked,
          fixedRecommendations: retryRecommendations });
        if (simulatedLatency > 0 && simulatedLatency < GUIDE_LIMITS.REQUEST_TIMEOUT_MS) {
          await new Promise((resolve) => setTimeout(resolve, simulatedLatency));
        }
        raw = simulatedLatency >= GUIDE_LIMITS.REQUEST_TIMEOUT_MS
          ? fallbackFromVerified(rules.response, rules.response.language, 'timeout') : rules.response;
        allowedCandidates = rules.allowedCandidates;
        if (!online) raw = fallbackFromVerified(raw, raw.language, 'offline');
        else if (qa.forceFallback) raw = fallbackFromVerified(raw, raw.language, qa.forceFallback);
        if (retryBatchId && retryRecommendations.length && raw.recommendations?.length === retryRecommendations.length) {
          raw = { ...raw, batchId: retryBatchId };
        }
      }
    } else {
      try {
        raw = await requestGuideTurn({
          sessionId, visitorSessionId, message: String(text || '').slice(0, GUIDE_LIMITS.MAX_MESSAGE_CHARS),
          planState: sanitizedPlanSummary(requestPlan), recentMessages: safeRecentMessages(messages),
          shownPlaceIds, languageLocked, tripHistoryConsent: Boolean(requestPlan.tripHistoryConsent),
          originCoordinates: Number.isFinite(requestPlan.origin?.lat) && Number.isFinite(requestPlan.origin?.lng)
            ? { lat: requestPlan.origin.lat, lng: requestPlan.origin.lng } : null,
          qa: GUIDE_QA_MODE ? qa : {}, retryBatchId, retryPlaceIds, retryRecommendations
        });
        for (const recommendation of raw?.recommendations || []) {
          const place = await DestinationDiscoveryService.getPlace(recommendation.placeId);
          if (place) allowedCandidates.push({ placeId: place.id, place });
        }
      } catch (error) {
        const rules = await safeRulesTurn({ text, planState: requestPlan, userId: user?.id,
          remainingTurns: limit.remaining, qa: { ...qa, forceFallback: '' }, shownPlaceIds, languageLocked,
          fixedRecommendations: retryRecommendations });
        raw = fallbackFromVerified(rules.response, rules.response.language,
          error?.name === 'AbortError' ? 'timeout' : (error?.status === 429 ? 'provider_429' : 'provider_unavailable'));
        if (retryBatchId && retryRecommendations.length && raw.recommendations?.length === retryRecommendations.length) {
          raw = { ...raw, batchId: retryBatchId, mode: GUIDE_MODE.FALLBACK };
        }
        allowedCandidates = rules.allowedCandidates;
      }
    }

    if (GUIDE_QA_MODE && qa.rejectUnknownPlace) {
      raw = { ...raw, recommendations: [{ placeId: 'qa-place-outside-catalogue', role: 'best_match', verifiedReasonCodes: [], tradeoffCode: 'none' }, ...(raw.recommendations || []).slice(1)] };
    }
    // Every recommendation response needs a stable identity, including the
    // browser rules fallback. The identity lets language changes, detail-page
    // round trips and Gemini retries keep the exact same recommendation batch.
    if (raw.recommendations?.length && !raw.batchId) raw = { ...raw, batchId: createBatchId() };
    const allowedIds = allowedCandidates.map((candidate) => candidate.placeId);
    const repeatedPlaceId = repeatedShownPlace(raw, shownPlaceIds, requestPlan.recommendationMode);
    const validation = repeatedPlaceId
      ? { valid: false, reason: 'duplicate_shown_place', rejectedPlaceId: repeatedPlaceId }
      : validateGuideResponse(raw, allowedIds);
    if (!validation.valid) {
      const rules = await safeRulesTurn({ text, planState: requestPlan, userId: user?.id,
        remainingTurns: limit.remaining, qa: { ...qa, rejectUnknownPlace: false, forceFallback: '' }, shownPlaceIds, languageLocked,
        fixedRecommendations: retryRecommendations });
      raw = fallbackFromVerified(rules.response, rules.response.language, validation.reason);
      if (retryBatchId && retryRecommendations.length && raw.recommendations?.length === retryRecommendations.length) {
        raw = { ...raw, batchId: retryBatchId };
      }
      raw.validation = { reason: validation.reason, rejectedPlaceId: validation.rejectedPlaceId || null };
    }

    if (GUIDE_FIXTURE_MODE && raw.mode === GUIDE_MODE.RECOMMEND) {
      const recorded = recordFixtureSuccess(user, visitorSessionId);
      raw = { ...raw, remainingTurns: recorded.remaining };
    }
    const finalResponse = await hydrate(raw);
    if (user?.id && sessionId && GUIDE_FIXTURE_MODE) tumpangGuideStore.appendTurn(user.id, sessionId, text, finalResponse);
    return finalResponse;
  },

  // Stored Edge responses contain only the verified Place IDs. Hydrating here
  // keeps the presentation layer independent from both data repositories and
  // makes a saved conversation render exactly like the live response.
  hydrateResponse(response) {
    return hydrate(response);
  },

  listSessions(userId) {
    return GUIDE_FIXTURE_MODE ? Promise.resolve(tumpangGuideStore.listSessions(userId)) : tumpangGuideSupabaseRepository.listSessions(userId);
  },
  getMessages(userId, sessionId) {
    return GUIDE_FIXTURE_MODE ? Promise.resolve(tumpangGuideStore.getMessages(userId, sessionId)) : tumpangGuideSupabaseRepository.getMessages(userId, sessionId);
  },
  listFeedback(userId, sessionId) {
    return GUIDE_FIXTURE_MODE ? Promise.resolve(tumpangGuideStore.listFeedback(userId, sessionId)) : tumpangGuideSupabaseRepository.listFeedback(userId, sessionId);
  },
  cacheSessionSummary({ userId, sessionId, planState, messages = [] } = {}) {
    if (!userId || !sessionId) return;
    const previous = readCachedSessionIndex(userId);
    const firstUser = messages.find((message) => message?.role === 'user' && message.text);
    const existing = previous.find((row) => row.id === sessionId);
    const summary = {
      ...(existing || {}), id: sessionId, userId,
      title: firstUser?.text?.trim().slice(0, 120) || existing?.title || 'New travel plan',
      language: planState?.language || existing?.language || 'en',
      planState: planState || existing?.planState || {},
      updatedAt: new Date().toISOString()
    };
    writeCachedSessionIndex(userId, [summary, ...previous.filter((row) => row.id !== sessionId)].slice(0, 30));
  },
  listCachedSessions(userId) {
    return readCachedSessionIndex(userId).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  },
  removeCachedSession(userId, sessionId) {
    if (!userId || !sessionId) return;
    writeCachedSessionIndex(userId, readCachedSessionIndex(userId).filter((row) => row.id !== sessionId));
  },
  clearCachedSessions(userId) {
    if (!userId) return;
    writeCachedSessionIndex(userId, []);
  },
  deleteSession(userId, sessionId) {
    return GUIDE_FIXTURE_MODE ? Promise.resolve(tumpangGuideStore.deleteSession(userId, sessionId)) : tumpangGuideSupabaseRepository.deleteSession(userId, sessionId);
  },
  deleteAll(userId) {
    return GUIDE_FIXTURE_MODE ? Promise.resolve(tumpangGuideStore.deleteAll(userId)) : tumpangGuideSupabaseRepository.deleteAll(userId);
  },
  saveFeedback(userId, sessionId, traceId, sentiment, reason) {
    if (GUIDE_FIXTURE_MODE) return Promise.resolve(tumpangGuideStore.saveFeedback(userId, sessionId, traceId, sentiment, reason));
    return requestGuideFeedback({ sessionId, traceId, sentiment: sentiment || 'clear', reason });
  },
  async getLanguagePack(language) {
    const normalized = normalizeGuideLanguage(language);
    if (['en', 'zh-CN', 'ms', 'ta'].includes(normalized)) return null;
    const cached = readPack(normalized);
    if (cached) return cached;
    if (!GUIDE_LIVE_MODE) throw new Error('Dynamic language packs require the live Guide service.');
    const pack = await requestGuideLanguagePack({ language: normalized, packVersion: GUIDE_PACK_VERSION });
    if (!isCompleteGuideLanguagePack(pack)) throw new Error('The language pack was incomplete and was rejected.');
    writePack(normalized, pack);
    return pack;
  },
  async translateMessages({ user, sessionId, visitorSessionId, language, messages }) {
    if (!messages?.length || !GUIDE_LIVE_MODE || (user?.id && !sessionId) || (!user?.id && !visitorSessionId)) return {};
    const result = await requestGuideTranslations({ sessionId, visitorSessionId, language, messages });
    return Object.fromEntries((result.translations || []).map((item) => [item.id, item.text]));
  },
  async getActionState(userId, placeId, travelDate) {
    if (!userId || !placeId || !travelDate || !DestinationDiscoveryService.getActionState) return { interest: null, alert: null };
    if (!GUIDE_FIXTURE_MODE && !GUIDE_LIVE_CATALOGUE_MODE) {
      return { interest: null, alert: null };
    }
    return DestinationDiscoveryService.getActionState(userId, placeId, travelDate);
  },
  async confirmAction({ type, userId, placeId, travelDate, preferredCategories, requestedName }) {
    if (!userId) throw new Error('Sign in to save this action.');
    if (!GUIDE_FIXTURE_MODE && !GUIDE_LIVE_CATALOGUE_MODE) {
      throw new Error('Live catalogue actions are not configured. Set VITE_DISCOVERY_DATA_SOURCE=supabase and restart the app.');
    }
    if (type === GUIDE_ACTION.RECORD_INTEREST) {
      const result = await DestinationDiscoveryService.recordInterest(userId, placeId, travelDate);
      const interest = await DestinationDiscoveryService.getInterest(userId, placeId, travelDate);
      if (!interest) throw new Error('Interest could not be saved. Please try again.');
      return { ...result, recorded: true, interest };
    }
    if (type === GUIDE_ACTION.REGISTER_RIDE_ALERT) {
      const result = await DestinationDiscoveryService.registerForNotification(userId, placeId, travelDate);
      const state = await DestinationDiscoveryService.getActionState(userId, placeId, travelDate);
      if (!state?.alert) throw new Error('Ride alert could not be saved. Please try again.');
      return { ...result, registration: state.alert };
    }
    if (type === GUIDE_ACTION.SAVE_PREFERENCES) {
      const result = await DestinationDiscoveryService.savePreferences(userId, { preferredCategories });
      const saved = await DestinationDiscoveryService.getPreferences(userId);
      if (!saved) throw new Error('Travel preferences could not be saved. Please try again.');
      return { ...result, preferences: saved };
    }
    if (type === GUIDE_ACTION.REQUEST_CATALOGUE) {
      if (GUIDE_FIXTURE_MODE) return { requestedName, fixtureOnly: true };
      return tumpangGuideSupabaseRepository.requestCataloguePlace(requestedName);
    }
    throw new Error('This action is not available in Tumpang Guide.');
  },
  async cancelAction({ type, userId, placeId, travelDate, registrationId }) {
    if (!GUIDE_FIXTURE_MODE && !GUIDE_LIVE_CATALOGUE_MODE) {
      throw new Error('Live catalogue actions are not configured. Set VITE_DISCOVERY_DATA_SOURCE=supabase and restart the app.');
    }
    if (type === GUIDE_ACTION.RECORD_INTEREST) {
      const result = await DestinationDiscoveryService.removeInterest(userId, placeId, travelDate);
      if (await DestinationDiscoveryService.getInterest(userId, placeId, travelDate)) {
        throw new Error('Interest could not be cancelled. Please try again.');
      }
      return result;
    }
    if (type === GUIDE_ACTION.REGISTER_RIDE_ALERT) {
      const result = await DestinationDiscoveryService.cancelRegistration(userId, registrationId);
      const state = await DestinationDiscoveryService.getActionState(userId, placeId, travelDate);
      if (state?.alert) throw new Error('Ride alert could not be cancelled. Please try again.');
      return result;
    }
    throw new Error('This action cannot be cancelled here.');
  },
  saveDetailReason(recommendation, planState, returnTo = '/assistant', languagePack = null) {
    try { sessionStorage.setItem(`m6-guide-reason:${recommendation.placeId}`, JSON.stringify({
      role: recommendation.role, reasonCodes: recommendation.verifiedReasonCodes, tradeoffCode: recommendation.tradeoffCode,
      batchId: recommendation.batchId || null, planState: sanitizedPlanSummary(planState), languagePack: languagePack || null,
      returnTo: typeof returnTo === 'string' && returnTo.startsWith('/assistant') ? returnTo : '/assistant',
      savedAt: Date.now()
    })); } catch { /* Navigation must still work when storage is blocked. */ }
  },
  getDetailReason(placeId) {
    try { const parsed = JSON.parse(sessionStorage.getItem(`m6-guide-reason:${placeId}`) || 'null');
      return parsed && Date.now() - Number(parsed.savedAt) <= 86400000 ? parsed : null; } catch { return null; }
  },
  isLive: GUIDE_LIVE_MODE,
  supportedLanguages: GUIDE_LANGUAGES,
  model: GUIDE_MODEL.GENERATION,
  qaEnabled: GUIDE_QA_MODE
};
