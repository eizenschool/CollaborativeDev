// ===== BUSINESS LOGIC LAYER (ReputationPolicy) =====
// Reputation measures verified ride behaviour. Login frequency, profile
// completeness, CO2 impact and identity documents deliberately do not award
// points: those are engagement, impact or eligibility signals, not evidence
// that somebody reliably carried or travelled with another person.
//
// Every member starts at the 100 ceiling, so the score is standing that is
// kept rather than points that are earned. Positive ride outcomes still count,
// but they can only restore standing already lost - never exceed 100. Because
// nobody starts below the line, the thresholds are set where losses matter:
// each tier boundary is an actual capability boundary (95 spotless, 90 may
// publish, 75 may request, below 50 reads as a safety problem).

export const REPUTATION_POLICY = Object.freeze({
  baseScore: 100,
  maxScore: 100,
  minEvidenceRides: 3,
  positivePointsPerRideCap: 3,
  hostMinimum: 90,
  travellerMinimum: 75
});

export const REPUTATION_EVENT_DELTAS = Object.freeze({
  ride_completed: 1,
  on_time_check_in: 1,
  host_cancelled_early: -1,
  host_cancelled_late: -3,
  host_cancelled_very_late: -6,
  traveller_cancelled_early: -1,
  traveller_cancelled_late: -3,
  traveller_cancelled_very_late: -6,
  no_show: -10,
  confirmed_minor_conduct: -8,
  confirmed_serious_conduct: -20
});

const EVENT_LABELS = Object.freeze({
  ride_completed: 'Completed ride',
  on_time_check_in: 'Checked in on time',
  review_5_star: 'Received a 5-star review',
  review_4_star: 'Received a 4-star review',
  review_3_star: 'Received a 3-star review',
  review_2_star: 'Received a 2-star review',
  review_1_star: 'Received a 1-star review',
  host_cancelled_early: 'Driver cancelled more than 24 hours before departure',
  host_cancelled_late: 'Driver cancelled 6–24 hours before departure',
  host_cancelled_very_late: 'Driver cancelled less than 6 hours before departure',
  traveller_cancelled_early: 'Traveller cancelled more than 24 hours before departure',
  traveller_cancelled_late: 'Traveller cancelled 6–24 hours before departure',
  traveller_cancelled_very_late: 'Traveller cancelled less than 6 hours before departure',
  no_show: 'Verified no-show',
  confirmed_minor_conduct: 'Confirmed conduct issue',
  confirmed_serious_conduct: 'Confirmed serious safety or fraud issue'
});

export function reviewReputationDelta(rating) {
  const normalized = Number(rating);
  if (normalized === 5) return 2;
  if (normalized === 4) return 1;
  if (normalized === 3) return 0;
  if (normalized === 2) return -3;
  if (normalized === 1) return -6;
  throw new Error('Rating must be between 1 and 5.');
}

export function cancellationReputationEvent(role, departureAt, cancelledAt = new Date()) {
  const departure = new Date(departureAt).getTime();
  const cancelled = new Date(cancelledAt).getTime();
  if (!Number.isFinite(departure) || !Number.isFinite(cancelled)) {
    throw new Error('Cancellation timing is unavailable.');
  }
  const hoursBefore = (departure - cancelled) / (60 * 60 * 1000);
  const actor = role === 'host' ? 'host' : 'traveller';
  if (hoursBefore > 24) return `${actor}_cancelled_early`;
  if (hoursBefore >= 6) return `${actor}_cancelled_late`;
  return `${actor}_cancelled_very_late`;
}

export function describeReputationEvent(eventType) {
  return EVENT_LABELS[eventType] || 'Reputation updated';
}

export function isReputationEventType(eventType) {
  return Object.prototype.hasOwnProperty.call(EVENT_LABELS, eventType);
}

export function reputationStanding(score, { provisional = false, hold = false } = {}) {
  if (hold) return { key: 'suspended', label: 'Safety hold' };
  if (provisional) return { key: 'new', label: 'New member' };
  const value = Number(score);
  if (value >= 95) return { key: 'trusted', label: 'Trusted' };
  if (value >= REPUTATION_POLICY.hostMinimum) return { key: 'standard', label: 'Standard' };
  if (value >= REPUTATION_POLICY.travellerMinimum) return { key: 'limited', label: 'Limited' };
  if (value >= 50) return { key: 'restricted', label: 'Restricted' };
  return { key: 'suspended', label: 'Safety hold' };
}

export function clampReputationScore(score) {
  return Math.min(REPUTATION_POLICY.maxScore, Math.max(0, Number(score)));
}

// Clamped per event, not once at the end, to match the server ledger in
// migration 072. It matters now that everybody starts on the ceiling: credit
// earned while already at 100 is spent, not banked against a later penalty.
export function calculateReputationScore(events = [], baseScore = REPUTATION_POLICY.baseScore) {
  return events.reduce((score, event) => (
    isReputationEventType(event.type ?? event.event_type)
      ? clampReputationScore(score + Number(event.delta || 0))
      : score
  ), clampReputationScore(baseScore));
}

export function reputationEvidenceCount(events = [], completedTrips = 0) {
  const rideIds = new Set(events.map((event) => event.rideId || event.ride_id).filter(Boolean));
  return Math.max(rideIds.size, Number(completedTrips) || 0);
}

export function getRideEligibility({
  score = REPUTATION_POLICY.baseScore,
  evidenceCount = 0,
  hold = false
} = {}, role = 'traveller') {
  const normalizedRole = role === 'host' ? 'host' : 'traveller';
  const provisional = Number(evidenceCount) < REPUTATION_POLICY.minEvidenceRides;
  const minimum = normalizedRole === 'host' ? REPUTATION_POLICY.hostMinimum : REPUTATION_POLICY.travellerMinimum;
  const standing = reputationStanding(score, { provisional, hold });

  if (hold) {
    return { eligible: false, provisional, minimum, standing, reason: 'Ride actions are paused while a confirmed safety case is reviewed.' };
  }
  if (provisional) {
    return { eligible: true, provisional, minimum, standing, reason: 'New members can build standing through their first three completed rides.' };
  }
  if (Number(score) < minimum) {
    return {
      eligible: false,
      provisional,
      minimum,
      standing,
      reason: normalizedRole === 'host'
        ? `A reputation score of ${minimum} or higher is required to publish a new ride.`
        : `A reputation score of ${minimum} or higher is required to request a new ride.`
    };
  }
  return { eligible: true, provisional, minimum, standing, reason: 'Your reputation standing allows this ride action.' };
}
