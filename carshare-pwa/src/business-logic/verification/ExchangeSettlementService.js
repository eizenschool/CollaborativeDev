// ===== BUSINESS LOGIC LAYER (ExchangeSettlementService) =====
// UC6.6 CONFIRM EXCHANGE / UC6.7 FLAG DISPUTE / UC6.22 DEFAULT CONFIRMATION.
//
// This is where the non-monetary exchange the whole platform is built on actually
// gets settled: both parties say independently whether the agreed Exchange Condition
// was met, and the system decides whether that constitutes agreement or a dispute.

import { module6Db } from '../../data-access/module6Store.js';
import { DisputeConfidenceEngine } from './DisputeConfidenceEngine.js';
import { TripContractAdapter } from './TripContractAdapter.js';
import { VerificationEventFeed } from './VerificationEventFeed.js';
import {
  DISPUTE_OUTCOME,
  DISPUTE_STATUS,
  EXCHANGE_DEFAULT_HOURS,
  EXCHANGE_OUTCOME,
  VERIFICATION_STATUS
} from './constants.js';

const PARTY = { HOST: 'host', CLIENT: 'client' };
const other = (party) => (party === PARTY.HOST ? PARTY.CLIENT : PARTY.HOST);

/**
 * UC6.6 - record one party's answer.
 *
 * Deliberately does not reveal the other side's answer, and does not evaluate the
 * dispute, until both are in. If the first responder could see what the other said,
 * the second answer would stop being independent evidence - and independence is the
 * only thing that makes a mismatch meaningful in UC6.7.
 */
export async function confirmExchange(rideId, party, outcome) {
  if (![PARTY.HOST, PARTY.CLIENT].includes(party)) throw new Error('Unknown party.');
  if (!Object.values(EXCHANGE_OUTCOME).includes(outcome)) {
    throw new Error('Exchange outcome must be Fulfilled or Not Fulfilled.');
  }

  const verification = await module6Db.getVerification(rideId);
  if (!verification) throw new Error('No verification record for this trip.');

  // UC6.6 precondition: trip completion confirmed (UC6.4).
  if (verification.verificationStatus !== VERIFICATION_STATUS.COMPLETED) {
    throw new Error('The exchange can only be confirmed after the trip is completed.');
  }
  if (verification.exchange?.[party]) {
    throw new Error('You have already submitted your confirmation for this trip.');
  }

  const exchange = {
    ...verification.exchange,
    [party]: outcome,
    [`${party}At`]: module6Db.now(),
    [`${party}Defaulted`]: false
  };
  await module6Db.saveVerification(rideId, { exchange });

  const bothIn = Boolean(exchange.host && exchange.client);
  if (!bothIn) return { bothIn: false, awaiting: other(party) };

  // UC6.6 BF-4 - both responses present, so hand off to UC6.7.
  const dispute = await evaluateDispute(rideId);
  return { bothIn: true, dispute };
}

/**
 * UC6.6 BF-3 - what a given party is allowed to see right now.
 * The GUI layer calls this rather than reading the raw record, so the withholding
 * rule is enforced in business logic and cannot be bypassed by a component that
 * happens to render the wrong field.
 */
export function getVisibleExchange(verification, viewerParty) {
  const exchange = verification.exchange || {};
  const bothIn = Boolean(exchange.host && exchange.client);

  return {
    bothIn,
    yours: exchange[viewerParty] || null,
    yoursAt: exchange[`${viewerParty}At`] || null,
    // Withheld until both are submitted - then it becomes visible to everyone.
    theirs: bothIn ? exchange[other(viewerParty)] : null,
    theirsWithheld: !bothIn && Boolean(exchange[other(viewerParty)])
  };
}

/**
 * UC6.22 - at the 48-hour mark, any party still silent has their confirmation
 * recorded as "Not Fulfilled".
 *
 * The postcondition is pointed about this: "No Trip is left permanently unresolved
 * due to silence". Defaulting to Not Fulfilled rather than Fulfilled is the safe
 * direction - a genuinely fulfilled exchange has a motivated party who will say so,
 * whereas defaulting to Fulfilled would let a no-show host bank a clean record by
 * simply never answering.
 *
 * The defaulted flag is carried so the confidence engine can score it as silence
 * (zero on the timestamp axis) while UC6.7 still treats it as a normal answer.
 */
export async function applyDefaultConfirmations(rideId, now = module6Db.now()) {
  const verification = await module6Db.getVerification(rideId);
  if (!verification) return { applied: false, reason: 'NO_RECORD' };
  if (verification.verificationStatus !== VERIFICATION_STATUS.COMPLETED) {
    return { applied: false, reason: 'NOT_COMPLETED' };
  }

  const exchange = { ...verification.exchange };
  if (exchange.host && exchange.client) return { applied: false, reason: 'ALREADY_COMPLETE' };

  const completedAt = latestCompletionTimestamp(verification);
  if (!completedAt) return { applied: false, reason: 'NO_COMPLETION_TIME' };

  const elapsedHours = (new Date(now) - new Date(completedAt)) / 3600000;
  if (elapsedHours < EXCHANGE_DEFAULT_HOURS) {
    return { applied: false, reason: 'WITHIN_WINDOW', elapsedHours };
  }

  const defaulted = [];
  for (const party of [PARTY.HOST, PARTY.CLIENT]) {
    if (!exchange[party]) {
      exchange[party] = EXCHANGE_OUTCOME.NOT_FULFILLED;
      exchange[`${party}At`] = now;
      exchange[`${party}Defaulted`] = true;
      defaulted.push(party);
    }
  }

  await module6Db.saveVerification(rideId, { exchange });
  const dispute = await evaluateDispute(rideId);
  return { applied: true, defaulted, dispute };
}

// UC6.4 records each party's completion separately; the exchange window opens once
// the trip is actually finished, which is the later of the two.
function latestCompletionTimestamp(verification) {
  const { host, client } = verification.completeConfirm || {};
  const stamps = [host, client].filter(Boolean).map((t) => new Date(t).getTime());
  return stamps.length ? new Date(Math.max(...stamps)).toISOString() : null;
}

/**
 * UC6.7 - compare the two confirmations, and on a mismatch run UC6.8 (score) and
 * UC6.9 (route) as the use case's A1 branch specifies.
 */
export async function evaluateDispute(rideId) {
  const verification = await module6Db.getVerification(rideId);
  if (!verification) throw new Error('No verification record for this trip.');

  const exchange = verification.exchange || {};
  if (!exchange.host || !exchange.client) {
    return { status: DISPUTE_STATUS.NONE, reason: 'AWAITING_CONFIRMATIONS' };
  }

  // Confirmations agree - settled with the matching outcome, no dispute (UC6.7 BF-3).
  if (exchange.host === exchange.client) {
    const settled = {
      status: DISPUTE_STATUS.NONE,
      confidenceScore: null,
      signals: null,
      outcome: exchange.host,
      resolvedBy: 'agreement',
      resolvedAt: module6Db.now()
    };
    await module6Db.saveVerification(rideId, { dispute: settled });
    return settled;
  }

  // UC6.7 A1 -> UC6.8 -> UC6.9.
  const context = await TripContractAdapter.getDisputeContext(verification);
  const { score, signals } = DisputeConfidenceEngine.scoreDispute(verification, context);
  const routing = DisputeConfidenceEngine.routeDispute(score);

  if (routing === 'manual-review') {
    const pending = {
      status: DISPUTE_STATUS.PENDING_REVIEW,
      confidenceScore: score,
      signals,
      outcome: null,
      resolvedBy: null,
      resolvedAt: null
    };
    await module6Db.saveVerification(rideId, { dispute: pending });
    return pending;
  }

  const outcome = DisputeConfidenceEngine.decideAutoOutcome(verification, context);
  const resolvedAt = module6Db.now();
  const resolved = {
    status: DISPUTE_STATUS.AUTO_RESOLVED,
    confidenceScore: score,
    signals,
    outcome,
    resolvedBy: 'system',
    resolvedAt
  };
  await module6Db.saveVerification(rideId, { dispute: resolved });
  await recordDisputeAftermath(verification, resolved);
  return resolved;
}

/**
 * Shared by the auto-resolve path here and the admin path in DisputeResolutionService:
 * both parties' dispute counts go up, and the outcome is published for Module 1.
 *
 * Counts are incremented only after scoring, never before - otherwise the dispute
 * being scored would count as part of its own history and drag its own score down.
 */
export async function recordDisputeAftermath(verification, dispute) {
  await Promise.all([
    module6Db.incrementDisputeHistory(verification.hostId),
    module6Db.incrementDisputeHistory(verification.clientId)
  ]);

  await VerificationEventFeed.emitDisputeResolved({
    rideId: verification.rideId,
    hostId: verification.hostId,
    clientId: verification.clientId,
    outcome: dispute.outcome || DISPUTE_OUTCOME.INCONCLUSIVE,
    confidenceScore: dispute.confidenceScore,
    resolvedBy: dispute.resolvedBy,
    resolvedAt: dispute.resolvedAt
  });
}

export const ExchangeSettlementService = {
  PARTY,
  confirmExchange,
  getVisibleExchange,
  applyDefaultConfirmations,
  evaluateDispute,
  recordDisputeAftermath
};
