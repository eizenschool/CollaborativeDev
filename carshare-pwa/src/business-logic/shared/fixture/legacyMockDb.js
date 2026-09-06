import {
  configureLegacyMockDataStore,
  mockDb,
} from '../../../data-access/shared/fixture/legacyMockDataStore.js';
import {
  DEPARTURE_GRACE_MINUTES,
  rideIntervalsOverlap,
} from '../../m2-rides/rideDateTime.js';
import {
  cancellationReputationEvent,
  clampReputationScore,
  describeReputationEvent,
  getRideEligibility,
  isReputationEventType,
  REPUTATION_EVENT_DELTAS,
  REPUTATION_POLICY,
  reputationEvidenceCount,
  reputationStanding,
  reviewReputationDelta,
} from '../../m1-profile/ReputationPolicy.js';
import {
  buildPublicProfile,
  DEFAULT_PROFILE_VISIBILITY,
  normalizeProfileVisibility,
} from '../../m1-profile/PublicProfilePolicy.js';

configureLegacyMockDataStore({
  DEPARTURE_GRACE_MINUTES,
  rideIntervalsOverlap,
  cancellationReputationEvent,
  clampReputationScore,
  describeReputationEvent,
  getRideEligibility,
  isReputationEventType,
  REPUTATION_EVENT_DELTAS,
  REPUTATION_POLICY,
  reputationEvidenceCount,
  reputationStanding,
  reviewReputationDelta,
  buildPublicProfile,
  DEFAULT_PROFILE_VISIBILITY,
  normalizeProfileVisibility,
});

export { mockDb };
