// ===== BUSINESS LOGIC LAYER (Tumpang Guide deterministic RAG fallback) =====
// This is not presented as Gemini. It uses the real Destination Discovery
// retrieval/scoring pipeline, then applies the same Place-ID allowlist policy
// the production Edge Function must satisfy.
import { DestinationDiscoveryService } from '../discovery/DestinationDiscoveryService.js';
import { resetDemo, setWeatherOverride } from '../discovery/DiscoveryDemoControls.js';
import { GUIDE_ACTION, GUIDE_MODE, GUIDE_ORIGIN } from './constants.js';
import { guideCopy } from './GuideLanguage.js';
import { dateRangeDays, mergeGuideIntent, mostImportantMissingField, normalizePlanState } from './GuideIntentParser.js';
import { createTraceId, isEmergencyIntent, isGuideHelpIntent } from './GuidePolicy.js';
import { selectGuideBatch } from './GuideRecommendationEngine.js';
import { searchGuideHelp } from './GuideHelpIndex.js';
import { resolveKnownGuideOrigin } from './GuideOriginResolver.js';

const QUESTION_REPLIES = {
  en: { date: ['Tomorrow', 'This weekend'], origin: ['From Kuala Lumpur'], party: ['2 people', '4 people'], preference: ['Nature', 'Food', 'Heritage', 'Events'] },
  'zh-CN': { date: ['明天', '这个周末'], origin: ['从吉隆坡出发'], party: ['2 人', '4 人'], preference: ['自然', '美食', '文化遗产', '活动'] },
  ms: { date: ['Esok', 'Hujung minggu ini'], origin: ['Dari Kuala Lumpur'], party: ['2 orang', '4 orang'], preference: ['Alam', 'Makanan', 'Warisan', 'Acara'] },
  ta: { date: ['நாளை', 'இந்த வார இறுதி'], origin: ['கோலாலம்பூரிலிருந்து'], party: ['2 பேர்', '4 பேர்'], preference: ['இயற்கை', 'உணவு', 'பாரம்பரியம்', 'நிகழ்வு'] }
};

function questionReplies(field, language) {
  return QUESTION_REPLIES[language]?.[field] || QUESTION_REPLIES.en[field] || [];
}

function noCandidateSuggestions(language) {
  const labels = {
    en: ['Expand to 160 km', 'Clear category', 'Change date', 'Change starting point'],
    'zh-CN': ['扩大到 160 公里', '清除分类', '更改日期', '更改出发地'],
    ms: ['Luaskan kepada 160 km', 'Kosongkan kategori', 'Tukar tarikh', 'Tukar tempat mula'],
    ta: ['160 கி.மீ. வரை விரிவாக்கு', 'வகையை அழி', 'தேதியை மாற்று', 'தொடக்க இடத்தை மாற்று']
  }[language] || ['Expand to 160 km', 'Clear category', 'Change date', 'Change starting point'];
  return [
    { kind: 'brief_adjustment', action: 'expand_search', label: labels[0] },
    { kind: 'brief_adjustment', action: 'clear_category', label: labels[1] },
    { kind: 'brief_adjustment', action: 'change_date', label: labels[2] },
    { kind: 'brief_adjustment', action: 'change_origin', label: labels[3] }
  ];
}

function clarifyMessage(field, language) {
  const copy = guideCopy(language);
  return { date: copy.askDate, origin: copy.askOrigin, party: copy.askParty, preference: copy.askPreference }[field];
}

function buildRideSummary(candidate = {}, plan = {}) {
  if (!plan.startDate) return { status: 'date_required', listedRideCount: 0, maxSeatsInSingleRide: null };
  if (candidate.rideStatus === 'unavailable') {
    return { status: 'unavailable', listedRideCount: 0, maxSeatsInSingleRide: null };
  }
  const rides = Array.isArray(candidate.rides) ? candidate.rides : [];
  const maxSeats = rides.length ? Math.max(...rides.map((ride) => Number(ride.seatsAvailable) || 0)) : 0;
  if (!rides.length) return { status: 'none', listedRideCount: 0, maxSeatsInSingleRide: 0 };
  if (maxSeats === 0) return { status: 'full', listedRideCount: rides.length, maxSeatsInSingleRide: 0 };
  if (plan.partySize && maxSeats < plan.partySize) {
    return { status: 'insufficient_for_party', listedRideCount: rides.length, maxSeatsInSingleRide: maxSeats };
  }
  return { status: 'available', listedRideCount: rides.length, maxSeatsInSingleRide: maxSeats };
}

function aggregateDaily(results, preferredCategories) {
  const byId = new Map();
  for (const result of results) {
    for (const candidate of [...result.primary, ...result.unserved]) {
      const prior = byId.get(candidate.placeId);
      const preferenceBoost = preferredCategories.includes(candidate.place?.category) ? 0.12 : 0;
      const value = { ...candidate, servedByRide: Array.isArray(candidate.rides) && candidate.rides.length > 0,
        guideRank: (candidate.desirability || 0) + (candidate.accessibility || 0) + preferenceBoost };
      if (!prior || value.guideRank > prior.guideRank) byId.set(candidate.placeId, { ...value, availableDays: 1 });
      else prior.availableDays += 1;
    }
  }
  return [...byId.values()].sort((a, b) => b.guideRank - a.guideRank);
}

export async function runFixtureGuideTurn({ text, planState, userId, remainingTurns, qa = {}, shownPlaceIds = [], languageLocked = false }) {
  let nextPlan = mergeGuideIntent(planState, text, {
    today: qa.today, manualLanguage: languageLocked ? planState?.language : null
  });
  if (nextPlan.origin && !Number.isFinite(nextPlan.origin.lat)) {
    const resolved = resolveKnownGuideOrigin(nextPlan.origin.label);
    if (resolved) nextPlan = normalizePlanState({ ...nextPlan, origin: resolved });
  }
  const copy = guideCopy(nextPlan.language);
  const traceId = createTraceId('fixture');

  if (isEmergencyIntent(text)) {
    return { response: {
      mode: GUIDE_MODE.EMERGENCY, assistantMessage: copy.emergency, language: nextPlan.language,
      planState: nextPlan, quickReplies: [], recommendations: [],
      actions: [
        { type: GUIDE_ACTION.CALL_EMERGENCY, label: nextPlan.language === 'zh-CN' ? '拨打 999' : nextPlan.language === 'ms' ? 'Hubungi 999' : nextPlan.language === 'ta' ? '999 அழைக்கவும்' : 'Call 999', href: 'tel:999', requiresConfirmation: false },
        { type: GUIDE_ACTION.OPEN_PROFILE, label: nextPlan.language === 'zh-CN' ? 'Trusted Family' : nextPlan.language === 'ms' ? 'Trusted Family' : nextPlan.language === 'ta' ? 'Trusted Family' : 'Open Trusted Family settings', href: '/profile', requiresConfirmation: false }
      ], remainingTurns, fallbackReason: null, traceId
    }, allowedCandidates: [] };
  }

  if (isGuideHelpIntent(text)) {
    const sections = searchGuideHelp(text);
    return { response: {
      mode: GUIDE_MODE.HELP,
      assistantMessage: sections.length ? sections.map((section) => section.text).join(' ') : copy.helpMissing,
      language: nextPlan.language, planState: nextPlan, quickReplies: questionReplies('preference', nextPlan.language).slice(0, 2),
      recommendations: [], actions: [], remainingTurns, fallbackReason: sections.length ? null : 'help_source_missing', traceId
    }, allowedCandidates: [] };
  }

  const missing = mostImportantMissingField(nextPlan);
  if (missing) {
    return { response: {
      mode: GUIDE_MODE.CLARIFY, assistantMessage: clarifyMessage(missing, nextPlan.language),
      language: nextPlan.language, planState: nextPlan, quickReplies: questionReplies(missing, nextPlan.language),
      recommendations: [], actions: [], remainingTurns, fallbackReason: null, traceId
    }, allowedCandidates: [] };
  }

  const dates = dateRangeDays(nextPlan.startDate, nextPlan.endDate);
  const requestedDates = dates.length ? dates : [null];
  const origin = nextPlan.origin?.lat !== undefined ? nextPlan.origin
    : (nextPlan.origin?.label?.toLocaleLowerCase().includes('kuala lumpur') ? GUIDE_ORIGIN : null);
  if (qa.weather && qa.weather !== 'live') setWeatherOverride(qa.weather);
  let daily;
  try {
    daily = [];
    for (const travelDate of requestedDates) {
      daily.push(await DestinationDiscoveryService.getRecommendations({
        userId: nextPlan.tripHistoryConsent ? userId : null,
        origin, travelDate,
        preferredCategories: nextPlan.categoryMode === 'explicit' ? nextPlan.explicitCategories : undefined
      }));
    }
  } finally {
    if (qa.weather && qa.weather !== 'live') resetDemo();
  }

  const candidates = aggregateDaily(daily, nextPlan.preferredCategories);
  const partyReady = nextPlan.partySize
    ? candidates.filter((candidate) => !candidate.servedByRide
      || candidate.rides.some((ride) => Number(ride.seatsAvailable) >= nextPlan.partySize))
    : candidates;
  const selected = selectGuideBatch(partyReady.length ? partyReady : candidates, {
    dateCount: dates.length || 1, shownPlaceIds, recommendationMode: nextPlan.recommendationMode,
    categoryFilter: nextPlan.categoryMode === 'explicit' ? nextPlan.explicitCategories : null
  });

  if (!selected.length) {
    return { response: {
      mode: GUIDE_MODE.FALLBACK, assistantMessage: copy.noCandidates, language: nextPlan.language,
      planState: nextPlan, quickReplies: [], suggestions: noCandidateSuggestions(nextPlan.language), recommendations: [], actions: [],
      remainingTurns, fallbackReason: 'no_verified_candidates', traceId
    }, allowedCandidates: candidates };
  }

  return { response: {
    mode: GUIDE_MODE.RECOMMEND, assistantMessage: copy.recommend, language: nextPlan.language,
    planState: nextPlan, quickReplies: nextPlan.language === 'zh-CN' ? ['换一批地点', '查看不同的评论覆盖', '更改日期'] : nextPlan.language === 'ms' ? ['Tunjukkan tempat lain', 'Lihat liputan ulasan berbeza', 'Tukar tarikh'] : nextPlan.language === 'ta' ? ['வேறு இடங்களைக் காட்டு', 'வேறுபட்ட மதிப்புரை அளவைப் பார்', 'தேதியை மாற்று'] : ['Show different places', 'Show different review coverage', 'Change the date'],
    recommendations: selected.map(({ candidate, ...recommendation }) => ({
      ...recommendation,
      browsingInterestCount: Number(candidate.browsingInterestCount) || 0,
      rideSummary: buildRideSummary(candidate, nextPlan)
    })),
    actions: [], remainingTurns, fallbackReason: null, traceId
  }, allowedCandidates: candidates };
}

export const GuideFixtureEngine = { runFixtureGuideTurn };
