// ===== BUSINESS LOGIC LAYER (DisputeConfidenceEngine) =====
// UC6.8 CALCULATE DISPUTE SCORE / UC6.9 ROUTE DISPUTE.
//
// The proposal fixes the four inputs (confirmation timestamps, GPS cross-check
// result, each party's Reputation Score, dispute history) and the 0.75 routing
// threshold, but explicitly leaves the formula and weightings "to be finalised by
// the team". The weighting below is that decision, defined here.
//
// Structured in two layers on purpose:
//   computeConfidenceScore(signals)  - generic, pure, knows nothing about trips
//   scoreDispute(verification, ctx)  - extracts a dispute's signals, then calls it
// UC6.17 requires hazard reports to be scored with "the same scoring logic as trip
// disputes". When that lands it adds a scoreHazard() that maps confirm/deny history
// onto the same four axes and calls the same core - not a second copy of the maths.
//
// Same shape as HostImpactEngine (named WEIGHTS, pure compute function, named
// exports for reuse) so the two scoring engines in this codebase read alike.

import {
  AUTO_RESOLVE_THRESHOLD,
  DISPUTE_OUTCOME,
  EXCHANGE_DEFAULT_HOURS,
  GPS_RESULT
} from './constants.js';

// Weights sum to 1.0, so the composite lands on the 0.00-1.00 scale UC6.8 specifies.
//
// GPS carries the most weight because it is the only physically objective signal in
// the set - the other three are all reputational or behavioural proxies. Reputation
// is next because it aggregates a long history rather than one trip. Timestamps are
// weak evidence on their own (a slow reply is not dishonesty), and dispute history
// is deliberately the smallest: a user's past disputes should tilt an ambiguous
// case, never decide it outright.
const WEIGHTS = { gps: 0.35, reputation: 0.30, timestamp: 0.20, history: 0.15 };

// Prior disputes at or above this count drive the history signal to zero.
const DISPUTE_HISTORY_CEILING = 5;

// Reputation scores are 0-100 per party (Module 1), so two parties cap at 200.
const MAX_COMBINED_REPUTATION = 200;

const clamp01 = (n) => Math.min(1, Math.max(0, n));

// --- Signal normalisers: each maps raw evidence onto 0.00-1.00 ---
//
// Exported individually so each threshold can be pinned by a Boundary Value
// Analysis test on its own axis. Going through the composite score instead would
// blur a boundary case: a 2dp composite can round two genuinely different inputs
// onto the same number, which is precisely what a BVA case needs to tell apart.

// A phone with location services off must not read as guilt, so Unavailable sits
// at the neutral midpoint instead of scoring like a genuine mismatch.
export function normaliseGpsSignal(gpsCheck) {
  if (gpsCheck === GPS_RESULT.PASS) return 1;
  if (gpsCheck === GPS_RESULT.UNAVAILABLE) return 0.5;
  if (gpsCheck === GPS_RESULT.MISMATCH) return 0;
  return 0.5; // never captured - same neutral treatment as Unavailable
}

// Two parties who answered close together produce a cleaner evidential picture than
// two who answered a day apart. A confirmation that had to be defaulted in by
// UC6.22 scores zero on this axis: silence is not evidence.
export function normaliseTimestampSignal({ hostAt, clientAt, hostDefaulted, clientDefaulted }) {
  if (hostDefaulted || clientDefaulted) return 0;
  if (!hostAt || !clientAt) return 0;

  const gapHours = Math.abs(new Date(hostAt) - new Date(clientAt)) / 3600000;
  return clamp01(1 - gapHours / EXCHANGE_DEFAULT_HOURS);
}

export function normaliseReputationSignal({ hostReputation = 0, clientReputation = 0 }) {
  return clamp01((hostReputation + clientReputation) / MAX_COMBINED_REPUTATION);
}

export function normaliseHistorySignal({ hostPriorDisputes = 0, clientPriorDisputes = 0 }) {
  const total = hostPriorDisputes + clientPriorDisputes;
  return clamp01(1 - total / DISPUTE_HISTORY_CEILING);
}

/**
 * The generic core. Takes four already-normalised 0-1 signals and returns the
 * weighted composite, rounded to 2dp to match the 0.00-1.00 scale in UC6.8.
 * Shared with UC6.17's hazard scoring when that is built.
 */
export function computeConfidenceScore(signals) {
  const raw =
    clamp01(signals.gps) * WEIGHTS.gps +
    clamp01(signals.reputation) * WEIGHTS.reputation +
    clamp01(signals.timestamp) * WEIGHTS.timestamp +
    clamp01(signals.history) * WEIGHTS.history;

  return Math.round(raw * 100) / 100;
}

/**
 * UC6.8 - turn a disputed trip plus its Module 1 context into a score.
 * `context` carries the two parties' reputation scores and dispute counts, fetched
 * by the caller through TripContractAdapter so this stays a pure function.
 * Returns the per-signal breakdown alongside the score: an admin resolving the case
 * (UC6.10) needs to see why the number came out where it did, not just the number.
 */
export function scoreDispute(verification, context = {}) {
  const signals = {
    gps: normaliseGpsSignal(verification.pickup?.gpsCheck),
    timestamp: normaliseTimestampSignal(verification.exchange || {}),
    reputation: normaliseReputationSignal(context),
    history: normaliseHistorySignal(context)
  };

  return { score: computeConfidenceScore(signals), signals, weights: WEIGHTS };
}

/**
 * UC6.9 - at or above the threshold the dispute auto-resolves; below it, it goes to
 * the admin queue (A1). Boundary is inclusive: 0.75 auto-resolves.
 */
export function routeDispute(score) {
  return score >= AUTO_RESOLVE_THRESHOLD ? 'auto-resolve' : 'manual-review';
}

/**
 * Which way a high-confidence dispute is settled.
 *
 * UC6.9 says to auto-resolve "using the outcome enum defined in UC6.10" but does not
 * say whose claim wins, so this is the rule: adopt the claim of the party with the
 * higher Reputation Score, because reputation is the platform's own accumulated
 * judgement of reliability and is the only tie-break available that is not itself
 * part of the disputed trip. Equal reputation gives no basis to prefer either
 * account, so the outcome is Inconclusive rather than an arbitrary pick.
 */
export function decideAutoOutcome(verification, context = {}) {
  const { hostReputation = 0, clientReputation = 0 } = context;
  const exchange = verification.exchange || {};

  if (hostReputation === clientReputation) return DISPUTE_OUTCOME.INCONCLUSIVE;

  const winningClaim = hostReputation > clientReputation ? exchange.host : exchange.client;
  return winningClaim || DISPUTE_OUTCOME.INCONCLUSIVE;
}

export const DisputeConfidenceEngine = {
  weights: WEIGHTS,
  autoResolveThreshold: AUTO_RESOLVE_THRESHOLD,
  disputeHistoryCeiling: DISPUTE_HISTORY_CEILING,
  computeConfidenceScore,
  scoreDispute,
  routeDispute,
  decideAutoOutcome,
  normaliseGpsSignal,
  normaliseTimestampSignal,
  normaliseReputationSignal,
  normaliseHistorySignal
};
