// ===== BUSINESS LOGIC LAYER (TripConfirmationService) =====
// UC6.2 VERIFY PIN / UC6.3 VERIFY LOCATION (orchestration) / UC6.4 CONFIRM TRIP
// STATUS / UC6.5 RECORD NO-SHOW.
//
// The pure rules live in PinService and GeoVerification; this file is the part that
// reads and writes state around them. Every time-dependent rule takes `now` as an
// argument rather than calling Date.now() internally, so the demo clock and the unit
// tests can both drive it without the service knowing either exists.

import { module6Db } from '../../data-access/module6Store.js';
import { GeoVerification } from './GeoVerification.js';
import { PinService } from './PinService.js';
import { TripContractAdapter } from './TripContractAdapter.js';
import { VerificationEventFeed } from './VerificationEventFeed.js';
import { GPS_RESULT, NO_SHOW_WINDOW_MIN, VERIFICATION_STATUS } from './constants.js';

const PARTY = { HOST: 'host', CLIENT: 'client' };

/**
 * UC6.1 - issue a PIN for a trip that has just reached Matched.
 * Collision checking is against every live trip's PIN, not just this one's history.
 */
export async function issuePin(rideId) {
  const verification = await module6Db.getVerification(rideId);
  if (!verification) throw new Error('No verification record for this trip.');

  const activePins = await module6Db.listActivePins();
  const otherPins = activePins.filter((p) => p !== verification.pin);
  const { pin } = PinService.generatePin(otherPins);

  return module6Db.saveVerification(rideId, { pin, pinGeneratedAt: module6Db.now() });
}

/**
 * UC6.2 basic flow, with UC6.3 included at step 4.
 *
 * Order matters and follows the use case exactly: the PIN is validated first, and
 * only a correct PIN gets as far as the GPS cross-check. A wrong PIN returns without
 * touching state, so a Host guessing PINs cannot generate location records.
 *
 * A GPS mismatch does NOT block the transition (UC6.3 A1) - it is recorded and
 * carried forward as an input to the dispute score. Refusing to start the trip would
 * strand two people at the kerb over a phone with poor signal.
 */
export async function confirmPickup(rideId, { enteredPin, hostCoords, clientCoords }) {
  const verification = await module6Db.getVerification(rideId);
  if (!verification) throw new Error('No verification record for this trip.');

  if (verification.verificationStatus !== VERIFICATION_STATUS.MATCHED) {
    throw new Error('Pickup can only be confirmed while the trip is Matched.');
  }

  if (!PinService.verifyPin(verification.pin, enteredPin)) {
    // UC6.2 A1 - surface the mismatch and let the Host re-enter. No state written.
    return { ok: false, reason: 'PIN_MISMATCH' };
  }

  const gps = GeoVerification.evaluateGpsCrossCheck(hostCoords, clientCoords);
  const confirmedAt = module6Db.now();

  await module6Db.saveVerification(rideId, {
    pickup: { confirmedAt, gpsCheck: gps.result, gpsDistanceM: gps.distanceM }
  });

  // Module 6 does not own rides.status - it requests the transition (see adapter).
  await TripContractAdapter.requestStatusTransition(rideId, VERIFICATION_STATUS.IN_TRANSIT);

  return {
    ok: true,
    gpsCheck: gps.result,
    gpsDistanceM: gps.distanceM,
    // Worth surfacing in the UI: the trip proceeded, but the pickup is now carrying
    // evidence that will count against it if this trip is later disputed.
    gpsFlagged: gps.result === GPS_RESULT.MISMATCH
  };
}

/**
 * UC6.4 - "Executes once independently for each party" and the postcondition is
 * explicit that a party's confirmation is "recorded independently, not merged with
 * the other party's confirmation". Each side therefore gets its own timestamp field,
 * and the trip only advances once both are present.
 */
export async function confirmTripStatus(rideId, party, phase) {
  if (![PARTY.HOST, PARTY.CLIENT].includes(party)) throw new Error('Unknown party.');
  if (!['start', 'completion'].includes(phase)) throw new Error('Unknown confirmation phase.');

  const verification = await module6Db.getVerification(rideId);
  if (!verification) throw new Error('No verification record for this trip.');

  if (phase === 'completion' && verification.verificationStatus !== VERIFICATION_STATUS.IN_TRANSIT) {
    throw new Error('Completion can only be confirmed while the trip is In Transit.');
  }

  const field = phase === 'start' ? 'startConfirm' : 'completeConfirm';
  const updated = { ...verification[field], [party]: module6Db.now() };
  await module6Db.saveVerification(rideId, { [field]: updated });

  const bothConfirmed = Boolean(updated.host && updated.client);

  if (bothConfirmed && phase === 'completion') {
    await TripContractAdapter.requestStatusTransition(rideId, VERIFICATION_STATUS.COMPLETED);
  }

  return { bothConfirmed, confirmations: updated };
}

/**
 * UC6.5 - no-show detection. Runs against the scheduled pickup time from Module 2
 * (via the adapter), not against when the PIN was issued, because the window the
 * proposal defines is "15 minutes of the Trip's scheduled pickup time".
 *
 * Attributed to the Client: the Host verifying a PIN is what constitutes pickup
 * confirmation (UC6.2), so an absent confirmation means the passenger never appeared
 * to present one.
 */
export async function checkNoShow(rideId, now = module6Db.now()) {
  const verification = await module6Db.getVerification(rideId);
  if (!verification) return { noShow: false, reason: 'NO_RECORD' };

  if (verification.noShow) return { noShow: true, alreadyRecorded: true };
  if (verification.pickup?.confirmedAt) return { noShow: false, reason: 'PICKUP_CONFIRMED' };
  if (verification.verificationStatus !== VERIFICATION_STATUS.MATCHED) {
    return { noShow: false, reason: 'NOT_AWAITING_PICKUP' };
  }

  const ride = await TripContractAdapter.getRideSnapshot(rideId);
  if (!ride?.scheduledPickupAt) return { noShow: false, reason: 'NO_SCHEDULED_TIME' };

  const elapsedMin = (new Date(now) - new Date(ride.scheduledPickupAt)) / 60000;
  if (elapsedMin < NO_SHOW_WINDOW_MIN) {
    return { noShow: false, reason: 'WITHIN_WINDOW', elapsedMin };
  }

  const noShow = { party: PARTY.CLIENT, recordedAt: now };
  await module6Db.saveVerification(rideId, { noShow });

  // Forwarded to Module 1 through the event log, never by calling Module 1 directly.
  await VerificationEventFeed.emitNoShow({
    rideId,
    attributedTo: verification.clientId,
    scheduledPickupAt: ride.scheduledPickupAt,
    detectedAt: now
  });

  return { noShow: true, elapsedMin, attributedTo: verification.clientId };
}

// Thin pass-throughs so the presentation layer never touches module6Db directly -
// backs the /safety hub list and the single-trip panel respectively.
export async function listAllVerifications() {
  return module6Db.listVerifications();
}

export async function getVerification(rideId) {
  return module6Db.getVerification(rideId);
}

export const TripConfirmationService = {
  PARTY,
  issuePin,
  confirmPickup,
  confirmTripStatus,
  checkNoShow,
  listAllVerifications,
  getVerification
};
