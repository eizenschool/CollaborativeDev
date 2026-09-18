// ===== BUSINESS LOGIC LAYER (RecommendationReasons) =====
// Turns the scored signals into the sentences a traveller actually wants.
//
// The score breakdown answers "how was this calculated". Nobody outside this
// project asks that. What a person wants to know is "why are you showing me
// this", and the honest answer is already in the numbers - it just has to be
// said in words.
//
// Reasons are ranked by **contribution**, not by raw value. A signal scoring
// 0.90 at weight 0.10 contributes 0.09; one scoring 0.60 at weight 0.55
// contributes 0.33 and is the far better explanation, even though its number
// looks worse. Ranking on the raw value would consistently lead with whichever
// signal happened to saturate.
//
// Caveats are generated from the same data, because "why is this not in the main
// list" is as much a part of the explanation as "why is it here at all".

import { ACCESSIBILITY_WEIGHTS, DESIRABILITY_WEIGHTS, REVIEW_CONFIDENCE_SATURATION } from './constants.js';
import { AFFINITY_SOURCE } from './AffinityResolver.js';

// Below this a signal is not pulling its weight and saying so would be noise.
const MIN_CONTRIBUTION = 0.06;
const MAX_REASONS = 3;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  // Constructed from parts, so it cannot shift a day across a timezone.
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short'
  });
}

/**
 * One phrasing per signal. Each returns null when it has nothing worth saying,
 * so a weak signal is simply absent rather than described as weak.
 */
const DESIRABILITY_PHRASES = {
  affinity: (value, ctx) => {
    if (value < 0.5) return null;
    if (ctx.affinitySource === AFFINITY_SOURCE.HISTORY) {
      return `Similar to the ${ctx.place.category} places you have been to`;
    }
    if (ctx.affinitySource === AFFINITY_SOURCE.STATED) {
      return `You said you enjoy ${ctx.place.category}`;
    }
    return null;
  },

  // The seasonal calendar already produced a human label, so use it rather than
  // inventing a second vocabulary for the same fact.
  season: (value, ctx) => {
    if (value < 1 || !ctx.season?.label) return null;
    return ctx.season.label === 'No declared season' ? null : ctx.season.label;
  },

  quality: (value, ctx) => {
    const { rating, reviewCount } = ctx.place;
    if (!rating || reviewCount < REVIEW_CONFIDENCE_SATURATION) return null;
    return `Rated ${rating.toFixed(1)} by ${reviewCount.toLocaleString()} visitors`;
  },

  // The project's whole sustainability argument, said as a sentence: this place
  // is worth going to partly *because* it is not the one everybody goes to.
  headroom: (value, ctx) => {
    if (value < 0.5) return null;
    return `Fewer reviews than the most-reviewed ${ctx.place.category} places in ${ctx.place.state}`;
  },

  local: (value) => (value >= 1 ? 'Independently run, not a chain' : null)
};

const ACCESSIBILITY_PHRASES = {
  seatHeadroom: (value, ctx) => {
    if (value <= 0 || !ctx.rides?.length) return null;
    const seats = ctx.rides.reduce((best, r) => Math.max(best, r.seatsAvailable || 0), 0);
    if (seats <= 0) return null;
    const when = formatDate(ctx.travelDate);
    return `Up to ${seats === 1 ? '1 seat remains' : `${seats} seats remain`} in one listed ride${when ? ` on ${when}` : ''}`;
  },

  // Journey cost is measured against the furthest candidate, not against any
  // absolute idea of "near". State the measured straight-line distance without
  // implying a driving time or a guaranteed route.
  journeyCost: (value, ctx) => {
    if (value < 0.6 || !Number.isFinite(ctx.distanceKm)) return null;
    const km = Math.round(ctx.distanceKm);
    return `${km} km in a straight line from your starting point (relative to other results)`;
  },

  demandConvergence: (value, ctx) => {
    const others = ctx.interestedUsers || 0;
    if (others < 1) return null;
    return `${plural(others, 'traveller has', 'travellers have')} shown browsing interest in this destination for this date`;
  }
};

function collect(signals = {}, weights, phrases, context) {
  return Object.entries(phrases)
    .map(([key, phrase]) => {
      const value = signals[key] ?? 0;
      const text = phrase(value, context);
      return text ? { key, text, contribution: value * weights[key] } : null;
    })
    .filter((reason) => reason && reason.contribution >= MIN_CONTRIBUTION);
}

/**
 * Why this destination is being shown, and what to be aware of.
 *
 * `context` carries the facts the phrasing needs but the engine does not:
 * the place record, the rides serving it, the resolved season, where the
 * affinity value came from, distance, and how many others are interested.
 */
export function buildReasons(candidate, context = {}) {
  if (!candidate?.signals) return { reasons: [], caveats: [] };

  const ctx = { place: {}, ...context, travelDate: context.travelDate };

  const reasons = [
    ...collect(candidate.signals.desirability, DESIRABILITY_WEIGHTS, DESIRABILITY_PHRASES, ctx),
    ...collect(candidate.signals.accessibility, ACCESSIBILITY_WEIGHTS, ACCESSIBILITY_PHRASES, ctx)
  ]
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, MAX_REASONS);

  return { reasons, caveats: buildCaveats(candidate, ctx) };
}

/**
 * The other half of the explanation. A traveller looking at the unserved section
 * deserves to know it is unserved *and* what they can do about it, rather than
 * being left to infer it from a low number.
 */
export function buildCaveats(candidate, context = {}) {
  const caveats = [];
  const place = context.place || {};

  if (candidate?.servedByRide === false) {
    caveats.push({
      key: 'unserved',
      text: 'No listed ride matches this destination for the selected date, so it appears under More places to explore.'
    });
  }

  if (context.season?.state === 'off-season' && context.season.note) {
    caveats.push({ key: 'season', text: context.season.note });
  }

  if (context.weatherAdvisory) {
    caveats.push({ key: 'weather', text: context.weatherAdvisory });
  }

  if (place.reviewCount > 0 && place.reviewCount < REVIEW_CONFIDENCE_SATURATION) {
    caveats.push({
      key: 'thin-data',
      text: `Only ${plural(place.reviewCount, 'review', 'reviews')} so far, so its rating is not yet reliable.`
    });
  }

  return caveats;
}

export const RecommendationReasons = { buildReasons, buildCaveats };
