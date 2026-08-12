// ===== BUSINESS LOGIC LAYER (VerificationEventFeed) =====
//
// Module 6's outbound contract. FR-1.5 says Module 1 recalculates a user's Reputation
// Score from "verified trip outcomes, exchange fulfilment results, no-show records,
// and dispute resolutions from Module 6" - so Module 6 owes Module 1 that data.
//
// The obvious implementation would be for Module 6 to call Module 1's recalculation
// directly when a no-show or dispute lands. That is deliberately NOT what happens
// here, for two reasons:
//   1. Module 1's recalculation (UC1.5) does not exist yet, so there is nothing to
//      call, and stubbing it would mean editing Module 1's files.
//   2. It would point the dependency the wrong way. Module 6 would then need to know
//      Module 1's internals, and every change on either side would ripple.
//
// Instead Module 6 appends to an append-only log and publishes this read API.
// Module 1 pulls from it whenever UC1.5 is built, marks what it has processed, and
// neither module ever imports the other.

import { module6Db } from '../../data-access/module6Store.js';
import { EVENT_TYPE } from './constants.js';

/**
 * UC6.5 - a party failed to confirm pickup inside the no-show window.
 * `attributedTo` is the user whose reputation this should count against.
 */
export async function emitNoShow({ rideId, attributedTo, scheduledPickupAt, detectedAt }) {
  return module6Db.appendEvent({
    type: EVENT_TYPE.NO_SHOW,
    userId: attributedTo,
    rideId,
    payload: { scheduledPickupAt, detectedAt },
    createdAt: detectedAt
  });
}

/**
 * UC6.9 / UC6.10 - a dispute reached a final outcome. Emitted once per party so
 * Module 1 can score each side independently, and carries `resolvedBy` so Module 1
 * can weight an auto-resolution differently from an admin ruling if it chooses.
 */
export async function emitDisputeResolved({
  rideId, hostId, clientId, outcome, confidenceScore, resolvedBy, resolvedAt
}) {
  const payload = { outcome, confidenceScore, resolvedBy };
  return Promise.all([
    module6Db.appendEvent({
      type: EVENT_TYPE.DISPUTE_RESOLVED,
      userId: hostId,
      rideId,
      payload: { ...payload, role: 'host' },
      createdAt: resolvedAt
    }),
    module6Db.appendEvent({
      type: EVENT_TYPE.DISPUTE_RESOLVED,
      userId: clientId,
      rideId,
      payload: { ...payload, role: 'client' },
      createdAt: resolvedAt
    })
  ]);
}

export const VerificationEventFeed = {
  emitNoShow,
  emitDisputeResolved,

  // --- The public read API Module 1 consumes (FR-1.5) ---
  // Documented in docs/MODULE6-SCHEMA.md as Module 6's outbound interface contract.
  async listUnconsumed() {
    return module6Db.listEvents({ unconsumedOnly: true });
  },

  async listForUser(userId) {
    const events = await module6Db.listEvents();
    return events.filter((e) => e.userId === userId);
  },

  async markConsumed(eventId) {
    return module6Db.markEventConsumed(eventId);
  },

  async listAll() {
    return module6Db.listEvents();
  }
};
