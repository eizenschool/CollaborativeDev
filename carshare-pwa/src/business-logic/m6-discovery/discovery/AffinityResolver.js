// ===== BUSINESS LOGIC LAYER (AffinityResolver) =====
// FR-6.20 derive personal affinity from completed trip history where available,
// from stated travel preferences otherwise, and apply a neutral value where
// neither exists.
//
// The order is not arbitrary. Observed behaviour supersedes a stated intention:
// a user who says they like nature but has completed six culinary trips is told
// something about themselves by the trips, not by the answer they gave once on
// first use. Stated preferences are retained rather than discarded, because the
// history can later become insufficient again.

import {
  AFFINITY_NEUTRAL,
  AFFINITY_STATED_OTHER,
  AFFINITY_STATED_PREFERRED
} from './constants.js';

export const AFFINITY_SOURCE = {
  HISTORY: 'history',
  STATED: 'stated',
  NEUTRAL: 'neutral'
};

/**
 * Affinity from completed trips: the proportion of the user's completed trips
 * whose destination shares this category.
 *
 * A proportion rather than a count, so a user with two hundred trips and a user
 * with four are on the same scale.
 */
export function affinityFromHistory(category, completedTrips = []) {
  if (!Array.isArray(completedTrips) || completedTrips.length === 0) return null;

  const matching = completedTrips.filter((trip) => trip?.category === category).length;
  return matching / completedTrips.length;
}

/**
 * Affinity from stated preferences: a flat 1.0 for a category the user named and
 * 0.4 for one they did not.
 *
 * 0.4 rather than 0 because declining to name a category is not the same as
 * rejecting it - a first-time user cannot be expected to enumerate everything
 * they might enjoy, and zeroing the unnamed categories would lock them out of
 * the recommendations most likely to broaden their trip.
 */
export function affinityFromStated(category, preferredCategories = []) {
  if (!Array.isArray(preferredCategories) || preferredCategories.length === 0) return null;
  return preferredCategories.includes(category) ? AFFINITY_STATED_PREFERRED : AFFINITY_STATED_OTHER;
}

/**
 * The full fallback chain. Returns the source alongside the value so the caller
 * can explain the recommendation ("based on your past trips" vs "based on what
 * you told us") rather than presenting an unexplained number.
 */
export function resolveAffinity(category, { completedTrips, preferredCategories } = {}) {
  const fromHistory = affinityFromHistory(category, completedTrips);
  if (fromHistory !== null) {
    return { value: fromHistory, source: AFFINITY_SOURCE.HISTORY };
  }

  const fromStated = affinityFromStated(category, preferredCategories);
  if (fromStated !== null) {
    return { value: fromStated, source: AFFINITY_SOURCE.STATED };
  }

  // UC6.4 A1: the user dismissed the preference prompt. Recommendations stay
  // available; only the personalisation signal is neutral.
  return { value: AFFINITY_NEUTRAL, source: AFFINITY_SOURCE.NEUTRAL };
}

export const AffinityResolver = {
  neutralValue: AFFINITY_NEUTRAL,
  SOURCE: AFFINITY_SOURCE,
  affinityFromHistory,
  affinityFromStated,
  resolveAffinity
};
