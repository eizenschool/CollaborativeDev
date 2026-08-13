// ===== BUSINESS LOGIC LAYER (PlaceLifecycle) =====
// FR-6.3 Stale at three absent cycles / FR-6.4 Retired at ten and withheld /
// FR-6.5 restore on reappearance preserving interest / FR-6.12 Provisional.
//
// The catalogue has no maintainer. Every transition here is driven by the
// scheduled ingestion cycle or the enrichment pass that follows it, never by an
// administrator - which is why this module carries no Admin actor at all.
//
// One rule governs the whole file: absence is only ever counted against a
// *successful* cycle. A failed source request or an exhausted request quota is a
// gap in the system's knowledge, not evidence that a place has closed, so those
// paths must leave counters untouched (UC6.8 A1/A2). The counter arithmetic lives
// here; the ingestion service decides when it is entitled to call it.

import {
  PLACE_STATE,
  PROVISIONAL_MIN_REVIEWS,
  RETIRED_AFTER_CYCLES,
  STALE_AFTER_CYCLES
} from './constants.js';

/**
 * FR-6.12 - the state a place settles into once enrichment has run.
 *
 * Provisional is not a failure state: the place stays recommendable, just at
 * reduced rank, and its presentation falls to a lower data-sufficiency tier.
 * Thin data degrades the experience in defined steps rather than hiding a place
 * that a traveller might still want to see.
 */
export function stateAfterEnrichment({ reviewCount, hasPhoto } = {}) {
  const count = Number(reviewCount);
  const enoughReviews = Number.isFinite(count) && count >= PROVISIONAL_MIN_REVIEWS;
  return enoughReviews && hasPhoto ? PLACE_STATE.ACTIVE : PLACE_STATE.PROVISIONAL;
}

/**
 * The state an absence counter implies, given the state the place is in now.
 *
 * Returns the current state unchanged below the Stale threshold so callers can
 * apply the result unconditionally without first testing whether anything moved.
 */
export function stateForAbsence(currentState, absenceCounter) {
  const cycles = Number(absenceCounter);
  if (!Number.isFinite(cycles) || cycles < STALE_AFTER_CYCLES) return currentState;
  if (cycles >= RETIRED_AFTER_CYCLES) return PLACE_STATE.RETIRED;
  return PLACE_STATE.STALE;
}

/**
 * Applies one completed ingestion cycle to a place that did NOT appear in it.
 * Records the state held before demotion so FR-6.5 can restore it later.
 */
export function applyAbsentCycle(place = {}) {
  const absenceCounter = (Number(place.absenceCounter) || 0) + 1;
  const nextState = stateForAbsence(place.lifecycleState, absenceCounter);

  // Captured on the first demotion only: once a place is Stale, the state worth
  // restoring is the Active/Provisional one it held before, not Stale itself.
  const wasRecommendable = place.lifecycleState === PLACE_STATE.ACTIVE
    || place.lifecycleState === PLACE_STATE.PROVISIONAL;
  const stateBeforeDemotion = wasRecommendable && nextState !== place.lifecycleState
    ? place.lifecycleState
    : place.stateBeforeDemotion ?? null;

  return { ...place, absenceCounter, lifecycleState: nextState, stateBeforeDemotion };
}

/**
 * Applies one completed ingestion cycle to a place that DID appear in it.
 *
 * FR-6.5: a reappearing place is restored to the state it held before, not
 * re-ingested as new, so the interest history already recorded against it
 * survives. Source coverage is not stable enough to treat one absence as
 * closure, and a place that returns after a gap is more common than one that has
 * genuinely closed.
 */
export function applyPresentCycle(place = {}) {
  const restored = place.lifecycleState === PLACE_STATE.RETIRED
    || place.lifecycleState === PLACE_STATE.STALE
    ? place.stateBeforeDemotion || PLACE_STATE.PROVISIONAL
    : place.lifecycleState;

  return { ...place, absenceCounter: 0, lifecycleState: restored, stateBeforeDemotion: null };
}

/**
 * FR-6.4 - Retired places are withheld from candidate selection.
 *
 * Withheld, not deleted: the record and its recorded interest are preserved, so
 * a place that returns in a later cycle brings its demand history back with it.
 */
export function isRecommendable(place = {}) {
  return place.lifecycleState !== PLACE_STATE.RETIRED
    && place.lifecycleState !== PLACE_STATE.PENDING_ENRICHMENT;
}

export function selectRecommendable(places = []) {
  return places.filter(isRecommendable);
}

export const PlaceLifecycle = {
  staleAfterCycles: STALE_AFTER_CYCLES,
  retiredAfterCycles: RETIRED_AFTER_CYCLES,
  stateAfterEnrichment,
  stateForAbsence,
  applyAbsentCycle,
  applyPresentCycle,
  isRecommendable,
  selectRecommendable
};
