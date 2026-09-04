// ===== BUSINESS LOGIC LAYER (Tumpang Guide controlled retrieval roles) =====
import { GUIDE_REASON, GUIDE_ROLE, GUIDE_TRADEOFF } from './constants.js';

function combined(candidate) {
  return (Number(candidate?.desirability) || 0) * 0.6 + (Number(candidate?.accessibility) || 0) * 0.4;
}

function reasonCodes(candidate, multiDayCount = 1) {
  const codes = [];
  const d = candidate?.signals?.desirability || {};
  const a = candidate?.signals?.accessibility || {};
  if (d.affinity >= 0.5) codes.push(GUIDE_REASON.AFFINITY);
  if (d.season >= 1) codes.push(GUIDE_REASON.SEASON);
  if (d.quality >= 0.55) codes.push(GUIDE_REASON.QUALITY);
  if (d.headroom >= 0.5) codes.push(GUIDE_REASON.QUIETER);
  if (d.local >= 1) codes.push(GUIDE_REASON.LOCAL);
  if (a.seatHeadroom > 0) codes.push(GUIDE_REASON.SEATS);
  if (a.journeyCost >= 0.6) codes.push(GUIDE_REASON.NEARER);
  if (a.demandConvergence > 0) codes.push(GUIDE_REASON.DEMAND);
  if (candidate?.weather !== 'unknown') codes.push(GUIDE_REASON.WEATHER);
  if (multiDayCount > 1) codes.push(GUIDE_REASON.RANGE);
  return codes.slice(0, 4);
}

function tradeoff(candidate, best) {
  if (!candidate?.servedByRide) return GUIDE_TRADEOFF.NO_RIDE;
  if ((candidate?.place?.reviewCount || 0) < 10) return GUIDE_TRADEOFF.THIN_REVIEWS;
  if (Number.isFinite(candidate?.distanceKm) && Number.isFinite(best?.distanceKm)
    && candidate.distanceKm > best.distanceKm + 40) return GUIDE_TRADEOFF.FARTHER;
  if ((candidate?.signals?.desirability?.headroom || 0) < 0.25) return GUIDE_TRADEOFF.BUSIER;
  if ((candidate?.desirability || 0) + 0.12 < (best?.desirability || 0)) return GUIDE_TRADEOFF.LOWER_PERSONAL_MATCH;
  return GUIDE_TRADEOFF.NONE;
}

function chooseUnique(list, used, predicate = () => true) {
  const match = list.find((item) => !used.has(item.placeId) && predicate(item));
  if (match) used.add(match.placeId);
  return match || null;
}

export function selectGuideRecommendations(candidates = [], { dateCount = 1 } = {}) {
  const unique = [...new Map(candidates.filter((item) => item?.placeId && item?.place).map((item) => [item.placeId, item])).values()];
  const overall = [...unique].sort((a, b) => combined(b) - combined(a));
  if (!overall.length) return [];
  const used = new Set();
  const best = chooseUnique(overall, used);
  const practicalPool = [...unique].sort((a, b) => (b.accessibility || 0) - (a.accessibility || 0));
  const practical = chooseUnique(practicalPool, used, (item) => item.servedByRide) || chooseUnique(practicalPool, used);
  const wildcardPool = [...unique].sort((a, b) => (b.desirability || 0) - (a.desirability || 0));
  const wildcard = chooseUnique(wildcardPool, used, (item) => item.place.category !== best.place.category)
    || chooseUnique(wildcardPool, used);

  return [
    [GUIDE_ROLE.BEST, best],
    [GUIDE_ROLE.PRACTICAL, practical],
    [GUIDE_ROLE.WILDCARD, wildcard]
  ].filter(([, item]) => item).map(([role, item]) => ({
    placeId: item.placeId,
    role,
    verifiedReasonCodes: reasonCodes(item, dateCount),
    tradeoffCode: tradeoff(item, best),
    candidate: item
  }));
}

/**
 * Select the immutable recommendation batch for one Guide turn. The provider
 * may explain this batch, but it is never allowed to choose a different set.
 * Previously shown places are exhausted only after every unseen candidate has
 * been used, which makes “show me something else” deterministic.
 */
export function selectGuideBatch(candidates = [], {
  dateCount = 1, shownPlaceIds = [], recommendationMode = 'default'
} = {}) {
  const unique = [...new Map(candidates
    .filter((item) => item?.placeId && item?.place)
    .map((item) => [item.placeId, item])).values()];
  const shown = new Set((shownPlaceIds || []).map(String));
  const ordered = [...unique].sort((a, b) => {
    if (recommendationMode === 'quieter') {
      return Number(b?.signals?.desirability?.headroom || 0) - Number(a?.signals?.desirability?.headroom || 0)
        || combined(b) - combined(a);
    }
    return combined(b) - combined(a);
  });
  const unseen = ordered.filter((item) => !shown.has(String(item.placeId)));
  // An explicit request for different places must never silently return the
  // same cards. If the catalogue is exhausted, the caller gets an honest
  // no-candidate response instead of a duplicate recommendation batch.
  const pool = recommendationMode === 'different'
    ? unseen
    : unseen.length >= 3 ? unseen : [...unseen, ...ordered.filter((item) => shown.has(String(item.placeId)))];
  return selectGuideRecommendations(pool, { dateCount })
    .slice(0, 3)
    .map((recommendation) => ({
      ...recommendation,
      previouslyShown: shown.has(String(recommendation.placeId))
    }));
}

export const GuideRecommendationEngine = { selectGuideRecommendations, selectGuideBatch };
