// ===== BUSINESS LOGIC LAYER (TripContractAdapter) =====
//
// THE ONLY FILE IN MODULE 6 THAT IMPORTS ANOTHER MODULE'S CODE.
//
// Module 6 sits downstream of two modules that are still being built:
//   - Module 2 owns the trip itself and its lifecycle (Draft -> Published -> Matched
//     -> In Transit -> Completed -> Cancelled). Today only Draft and Published are
//     implemented, and there is no join/request flow, so no trip ever actually
//     reaches Matched - which is the precondition for every UC in Module 6.
//   - Module 1 owns the Reputation Score that feeds the dispute confidence engine.
//
// Rather than wait for either, or reach into their files and add what Module 6 needs,
// everything Module 6 consumes is funnelled through this adapter. It normalises what
// those modules expose today, fills the gaps with documented defaults, and gives the
// rest of Module 6 one stable shape to code against. When Module 2 lands its real
// lifecycle, this file changes and nothing else in Module 6 does.
//
// Strictly read-only in both directions:
//   - it never writes to `rides` (Module 2 owns that row)
//   - it never calls into Module 1 to trigger a recalculation (see VerificationEventFeed)

import { RideService } from '../RideService.js';
import { HostImpactEngine } from '../HostImpactEngine.js';
import { module6Db } from '../../data-access/module6Store.js';

/**
 * Module 2 exposes a read-only ride snapshot. Production lifecycle writes remain a
 * service-role-only backend contract and are intentionally unavailable here.
 */
export async function getRideSnapshot(rideId) {
  const ride = await RideService.getRide(rideId);
  if (!ride) return null;

  return {
    id: ride.id,
    hostId: ride.hostId,
    pickup: ride.pickup,
    destination: ride.destination,
    date: ride.date,
    time: ride.time,
    journeyScale: ride.journeyScale,
    contribution: ride.contribution,
    host: ride.host,

    // Module 2 stores one authoritative UTC instant and only derives date/time for UI.
    scheduledPickupAt: ride.departureAt,

    // UC6.11 (out of this slice) needs an ETA that Module 2's FR-2.17 will provide.
    // Explicitly null rather than guessed, so overdue detection cannot silently run
    // on a fabricated number when it is built.
    etaTimestamp: null
  };
}

/**
 * Assembles the Module 1 + Module 6 context the confidence engine scores against.
 *
 * Reputation comes from Module 1's HostImpactEngine, whose own header comment states
 * it exists so "Module 6 (dispute/verification) and future modules can reuse the
 * exact same weighting" - so this is a sanctioned read, not a reach across the fence.
 * Dispute history is Module 6's own record and comes from Module 6's own store.
 */
export async function getDisputeContext(verification) {
  const [hostImpact, clientImpact, hostHistory, clientHistory] = await Promise.all([
    safeImpact(verification.hostId),
    safeImpact(verification.clientId),
    module6Db.getDisputeHistory(verification.hostId),
    module6Db.getDisputeHistory(verification.clientId)
  ]);

  return {
    hostReputation: hostImpact?.reputationScore ?? 0,
    clientReputation: clientImpact?.reputationScore ?? 0,
    hostPriorDisputes: hostHistory.priorDisputes,
    clientPriorDisputes: clientHistory.priorDisputes
  };
}

// A missing impact row must not take the dispute flow down with it. UC6.8's job is to
// score the evidence available, and an absent reputation is simply a zero signal.
async function safeImpact(userId) {
  if (!userId) return null;
  try {
    return await HostImpactEngine.getImpactSummary(userId);
  } catch {
    return null;
  }
}

/**
 * Module 6 detects that a trip should move (PIN verified -> In Transit, both parties
 * confirmed -> Completed) but does NOT own `rides.status`. The transition is recorded
 * against Module 6's own shadow field and returned as a request.
 *
 * When Module 2 exposes a real transition API, the one-line delegation goes here and
 * no other Module 6 file is touched.
 */
export async function requestStatusTransition(rideId, nextStatus) {
  const updated = await module6Db.saveVerification(rideId, { verificationStatus: nextStatus });
  return { rideId, requested: nextStatus, applied: updated.verificationStatus, delegated: false };
}

export const TripContractAdapter = {
  getRideSnapshot,
  getDisputeContext,
  requestStatusTransition
};
