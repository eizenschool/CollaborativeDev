// ===== BUSINESS LOGIC LAYER (DisputeResolutionService) =====
// UC6.10 RESOLVE DISPUTE.
//
// Backs the Admin console (AdminDisputeConsole.jsx) - this is the QA Lead's own
// Viewpoint-Oriented-Analysis actor from the proposal: the System Administrator who
// is "the final arbiter for contested outcomes". Everything here only applies to
// trips UC6.9 already routed to manual review; a trip with a confidence score at or
// above the auto-resolve threshold never reaches this file.

import { module6Db } from '../../data-access/module6Store.js';
import { recordDisputeAftermath } from './ExchangeSettlementService.js';
import { DISPUTE_OUTCOME, DISPUTE_STATUS } from './constants.js';

/**
 * UC6.10 BF-1 - what the admin queue lists. Deliberately only the trips actually
 * awaiting a human, not every dispute ever raised - an admin console that also
 * showed already-resolved trips would bury the ones that need a decision today.
 */
export async function listPendingReview() {
  const all = await module6Db.listVerifications();
  return all.filter((v) => v.dispute?.status === DISPUTE_STATUS.PENDING_REVIEW);
}

/**
 * UC6.10 BF-2/3/4 - the admin's three-state decision, recorded and forwarded to
 * Module 1 exactly the same way an auto-resolution is (recordDisputeAftermath is
 * shared with the auto-resolve path in ExchangeSettlementService), so a human
 * ruling and a system ruling are indistinguishable downstream.
 */
export async function resolveDispute(rideId, outcome, resolvedBy = 'admin') {
  if (!Object.values(DISPUTE_OUTCOME).includes(outcome)) {
    throw new Error('Resolution outcome must be Fulfilled, Not Fulfilled, or Inconclusive.');
  }

  const verification = await module6Db.getVerification(rideId);
  if (!verification) throw new Error('No verification record for this trip.');

  if (verification.dispute?.status !== DISPUTE_STATUS.PENDING_REVIEW) {
    throw new Error('This trip is not awaiting manual review.');
  }

  const resolvedAt = module6Db.now();
  const resolved = {
    ...verification.dispute,
    status: DISPUTE_STATUS.RESOLVED,
    outcome,
    resolvedBy,
    resolvedAt
  };

  await module6Db.saveVerification(rideId, { dispute: resolved });
  await recordDisputeAftermath(verification, resolved);

  return resolved;
}

export const DisputeResolutionService = {
  listPendingReview,
  resolveDispute
};
