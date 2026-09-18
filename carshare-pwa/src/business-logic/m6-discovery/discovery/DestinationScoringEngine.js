// ===== BUSINESS LOGIC LAYER (DestinationScoringEngine) =====
// FR-6.18 compute Desirability and Accessibility / FR-6.19 rank and present.
//
// Scoring produces two outputs rather than one scalar, deliberately. A place the
// user would love that no ride serves, and a place they are indifferent to with
// three empty seats, are not comparable on a single axis: collapsing them gives a
// ranking that cannot be explained to the user and cannot be tuned without one
// concern distorting the other.
//
//   D - how well the destination suits this user in this travel window,
//       independent of whether any ride serves it.
//   A - how efficiently the user can actually reach it, independent of how
//       appealing it is.
//
// Every function here is pure. Fetching trip history, rides, and interest counts
// is the caller's job, so this file stays testable without a backend and the
// tests make zero API calls.
//
// Same shape as HostImpactEngine (named weights, pure compute functions, named
// exports for reuse) so the scoring engines in this codebase read alike.

import {
  ACCESSIBILITY_WEIGHTS,
  DEMAND_CONVERGENCE_SATURATION,
  DESIRABILITY_WEIGHTS,
  PRESENTATION,
  PRESENTATION_THRESHOLDS,
  RATING_MAX,
  RATING_MIN,
  REVIEW_CONFIDENCE_SATURATION
} from './constants.js';

const clamp01 = (n) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const round2 = (n) => Math.round(n * 100) / 100;

// --- Desirability signals -----------------------------------------------

/**
 * Place quality = normalised rating x review confidence.
 *
 * Review confidence is a factor here rather than a separate gate, which is what
 * makes a 5.0-on-two-reviews place (1.0 x 0.2 = 0.20) rank below a 4.3-on-8000
 * place (0.825 x 1.0 = 0.825). The display suppression in FR-6.16 and this
 * ranking treatment are therefore the same mechanism.
 */
export function computeQualitySignal({ rating, reviewCount } = {}) {
  const count = Number(reviewCount);
  const confidence = clamp01(Number.isFinite(count) ? count / REVIEW_CONFIDENCE_SATURATION : 0);

  const value = Number(rating);
  if (!Number.isFinite(value)) return 0;
  const normalised = clamp01((value - RATING_MIN) / (RATING_MAX - RATING_MIN));

  return normalised * confidence;
}

/**
 * Visitation headroom = 1 - (this place's review count / the highest review
 * count among candidates of the same category in the same state).
 *
 * This is the anti-overtourism signal: the most-reviewed place in its peer group
 * scores 0, an unvisited one scores 1. A peer group with no reviews at all gives
 * every member full headroom rather than dividing by zero.
 */
export function computeHeadroomSignal({ reviewCount, peerMaxReviewCount } = {}) {
  const peak = Number(peerMaxReviewCount);
  if (!Number.isFinite(peak) || peak <= 0) return 1;

  const count = Number(reviewCount);
  if (!Number.isFinite(count) || count <= 0) return 1;

  return clamp01(1 - count / peak);
}

/**
 * D = 0.30*Affinity + 0.25*Season + 0.20*Quality + 0.15*Headroom + 0.10*Local
 *
 * Signals arrive already normalised to 0-1: affinity from AffinityResolver,
 * season from the seasonal calendar, local from ChainDetection.
 */
export function computeDesirability(signals = {}) {
  const parts = {
    affinity: clamp01(signals.affinity),
    season: clamp01(signals.season),
    quality: clamp01(signals.quality),
    headroom: clamp01(signals.headroom),
    local: clamp01(signals.local)
  };

  const raw =
    parts.affinity * DESIRABILITY_WEIGHTS.affinity +
    parts.season * DESIRABILITY_WEIGHTS.season +
    parts.quality * DESIRABILITY_WEIGHTS.quality +
    parts.headroom * DESIRABILITY_WEIGHTS.headroom +
    parts.local * DESIRABILITY_WEIGHTS.local;

  return { score: round2(raw), signals: parts, weights: DESIRABILITY_WEIGHTS };
}

// --- Accessibility signals -----------------------------------------------

/**
 * Seat headroom = the greatest (seats remaining / seats total) among the
 * published rides serving this destination in the travel window.
 *
 * The greatest rather than the sum or the average: what matters to one traveller
 * is whether any single ride can take them, not the aggregate capacity across
 * rides they cannot combine. No ride serving the destination scores 0.0.
 */
export function computeSeatHeadroomSignal(rides = []) {
  if (!Array.isArray(rides) || rides.length === 0) return 0;

  return rides.reduce((best, ride) => {
    const total = Number(ride?.seatsTotal);
    const remaining = Number(ride?.seatsAvailable);
    if (!Number.isFinite(total) || total <= 0) return best;
    if (!Number.isFinite(remaining) || remaining <= 0) return best;
    return Math.max(best, clamp01(remaining / total));
  }, 0);
}

/**
 * Journey cost = 1 - (travel distance / the greatest travel distance among the
 * candidate set), floored at 0. Relative rather than absolute, so the signal
 * stays meaningful whether the candidate set spans a city or a state.
 */
export function computeJourneyCostSignal({ distanceKm, maxCandidateDistanceKm } = {}) {
  const furthest = Number(maxCandidateDistanceKm);
  if (!Number.isFinite(furthest) || furthest <= 0) return 1;

  const distance = Number(distanceKm);
  if (!Number.isFinite(distance) || distance <= 0) return 1;

  return clamp01(1 - distance / furthest);
}

/**
 * Demand convergence = distinct users holding recorded interest in this
 * destination and window, saturating at four. Interest, not intent: this counts
 * the weak signal (FR-6.30), because convergence is about whether a shared
 * journey is plausible, not whether anyone has committed to it.
 */
export function computeDemandConvergenceSignal(interestedUserCount) {
  const count = Number(interestedUserCount);
  if (!Number.isFinite(count) || count <= 0) return 0;
  return clamp01(count / DEMAND_CONVERGENCE_SATURATION);
}

/**
 * A = 0.55*SeatHeadroom + 0.30*JourneyCost + 0.15*DemandConvergence
 */
export function computeAccessibility(signals = {}) {
  const parts = {
    seatHeadroom: clamp01(signals.seatHeadroom),
    journeyCost: clamp01(signals.journeyCost),
    demandConvergence: clamp01(signals.demandConvergence)
  };

  const raw =
    parts.seatHeadroom * ACCESSIBILITY_WEIGHTS.seatHeadroom +
    parts.journeyCost * ACCESSIBILITY_WEIGHTS.journeyCost +
    parts.demandConvergence * ACCESSIBILITY_WEIGHTS.demandConvergence;

  return { score: round2(raw), signals: parts, weights: ACCESSIBILITY_WEIGHTS };
}

/**
 * The highest Accessibility Score reachable by a destination no ride serves.
 *
 * Exported because it is an assertion about the module's design rather than an
 * incidental number: it is strictly below the primary-list threshold, which is
 * what guarantees an unserved destination can never outrank a served one. The
 * test suite pins this relationship so a future weight change cannot quietly
 * break the premise.
 */
export function maxUnservedAccessibility() {
  return round2(ACCESSIBILITY_WEIGHTS.journeyCost + ACCESSIBILITY_WEIGHTS.demandConvergence);
}

// --- Presentation rule ---------------------------------------------------

/**
 * FR-6.19 - map a (D, A) pair onto one of four presentation sections.
 * Boundaries are inclusive: exactly 0.60 is accessible, exactly 0.50 is
 * desirable, exactly 0.70 clears the unserved bar.
 */
export function applyPresentationRule({ desirability, accessibility }) {
  const d = Number(desirability);
  const a = Number(accessibility);

  if (a >= PRESENTATION_THRESHOLDS.accessible) {
    return d >= PRESENTATION_THRESHOLDS.desirable
      ? PRESENTATION.PRIMARY
      : PRESENTATION.PRIMARY_BELOW_THRESHOLD;
  }

  return d >= PRESENTATION_THRESHOLDS.unservedDesirable
    ? PRESENTATION.UNSERVED
    : PRESENTATION.WITHHELD;
}

/**
 * Scores one destination candidate end to end and assigns its section.
 *
 * `candidate` carries the place-level facts (rating, review count, peer maximum,
 * category, chain status) and the per-request facts (rides serving it, distance,
 * interested users). Nothing is cached: seat availability changes whenever a ride
 * is published or a seat taken, so a cached ranking would be wrong within minutes.
 */
export function scoreCandidate(candidate = {}) {
  const desirability = computeDesirability({
    affinity: candidate.affinity,
    season: candidate.season,
    quality: computeQualitySignal(candidate),
    headroom: computeHeadroomSignal(candidate),
    local: candidate.local
  });

  const accessibility = computeAccessibility({
    seatHeadroom: computeSeatHeadroomSignal(candidate.rides),
    journeyCost: computeJourneyCostSignal(candidate),
    demandConvergence: computeDemandConvergenceSignal(candidate.interestedUserCount)
  });

  return {
    placeId: candidate.placeId,
    desirability: desirability.score,
    accessibility: accessibility.score,
    signals: { desirability: desirability.signals, accessibility: accessibility.signals },
    presentation: applyPresentationRule({
      desirability: desirability.score,
      accessibility: accessibility.score
    }),
    servedByRide: Array.isArray(candidate.rides) && candidate.rides.length > 0
  };
}

/**
 * Scores and orders a candidate set for presentation.
 *
 * Primary-list candidates that clear the desirability threshold come first, then
 * accessible-but-less-desirable ones below them (the rule's second row states
 * this ordering explicitly), then the unserved section. Withheld candidates are
 * returned separately rather than dropped, since explicit category browsing can
 * still reach them.
 */
export function rankCandidates(candidates = []) {
  const scored = candidates.map(scoreCandidate);
  const bySection = (section) => scored.filter((c) => c.presentation === section);

  const byAccessibilityThenDesirability = (a, b) =>
    b.accessibility - a.accessibility || b.desirability - a.desirability;
  const byDesirabilityThenDemand = (a, b) =>
    b.desirability - a.desirability
    || b.signals.accessibility.demandConvergence - a.signals.accessibility.demandConvergence;

  return {
    primary: [
      ...bySection(PRESENTATION.PRIMARY).sort(byAccessibilityThenDesirability),
      ...bySection(PRESENTATION.PRIMARY_BELOW_THRESHOLD).sort(byAccessibilityThenDesirability)
    ],
    // The unserved section leads with demand, not proximity: its purpose is to
    // show a prospective Host where a ride would actually be filled.
    unserved: bySection(PRESENTATION.UNSERVED).sort(byDesirabilityThenDemand),
    withheld: bySection(PRESENTATION.WITHHELD)
  };
}

export const DestinationScoringEngine = {
  desirabilityWeights: DESIRABILITY_WEIGHTS,
  accessibilityWeights: ACCESSIBILITY_WEIGHTS,
  thresholds: PRESENTATION_THRESHOLDS,
  computeQualitySignal,
  computeHeadroomSignal,
  computeDesirability,
  computeSeatHeadroomSignal,
  computeJourneyCostSignal,
  computeDemandConvergenceSignal,
  computeAccessibility,
  maxUnservedAccessibility,
  applyPresentationRule,
  scoreCandidate,
  rankCandidates
};
