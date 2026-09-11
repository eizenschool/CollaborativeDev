import { RideRequestService } from './RideRequestService.js';
import { RideService } from './RideService.js';
import { RideSOSService } from './RideSOSService.js';
import { DEPARTURE_GRACE_MINUTES, REQUEST_CUTOFF_HOURS } from './rideDateTime.js';
import { getRideJourneyState, isTripModeEligible } from './rideJourneyState.js';

const POTENTIALLY_ACTIVE_RIDE_STATUSES = new Set(['Published', 'Matched', 'In Transit']);

function departureTime(ride) {
  const value = new Date(ride?.departureAt || '').getTime();
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function couldBeInSOSWindow(ride, now) {
  if (!POTENTIALLY_ACTIVE_RIDE_STATUSES.has(ride.status)) return false;
  if (ride.status === 'In Transit') return true;
  const departureAt = departureTime(ride);
  const nowTime = new Date(now).getTime();
  return departureAt - nowTime <= REQUEST_CUTOFF_HOURS * 60 * 60 * 1000
    && nowTime < departureAt + DEPARTURE_GRACE_MINUTES * 60 * 1000;
}

export function compareSOSLauncherCandidates(left, right) {
  const leftInTransit = left.ride?.status === 'In Transit';
  const rightInTransit = right.ride?.status === 'In Transit';
  if (leftInTransit !== rightInTransit) return leftInTransit ? -1 : 1;
  const departureDifference = departureTime(left.ride) - departureTime(right.ride);
  if (departureDifference) return departureDifference;
  return left.role === right.role ? 0 : left.role === 'driver' ? -1 : 1;
}

export function selectSOSLauncherCandidates({
  hosting = [],
  passengerRequests = [],
  requestsByRide = {},
  now = new Date(),
}) {
  const driverCandidates = hosting.map((ride) => ({
    ride,
    role: 'driver',
    state: getRideJourneyState({
      ride,
      role: 'driver',
      requests: requestsByRide[ride.id] || [],
      now,
    }),
  }));
  const passengerCandidates = passengerRequests
    .filter((request) => request.ride)
    .map((request) => ({
      ride: request.ride,
      request,
      role: 'passenger',
      state: getRideJourneyState({
        ride: request.ride,
        role: 'passenger',
        request,
        now,
      }),
    }));

  const uniqueByRide = new Map();
  [...driverCandidates, ...passengerCandidates]
    .filter((candidate) => isTripModeEligible(candidate.state))
    .sort(compareSOSLauncherCandidates)
    .forEach((candidate) => {
      if (!uniqueByRide.has(candidate.ride.id)) uniqueByRide.set(candidate.ride.id, candidate);
    });

  return [...uniqueByRide.values()];
}

export const SOSLauncherService = {
  async listCandidates(userId, now = new Date()) {
    const [rides, passengerRequests] = await Promise.all([
      RideService.listMyRides(userId),
      RideRequestService.listMyRequests(userId),
    ]);
    const hosting = rides.hosting || [];
    const activeHosted = hosting.filter((ride) => couldBeInSOSWindow(ride, now));
    const requestPairs = await Promise.all(activeHosted.map(async (ride) => [
      ride.id,
      await RideRequestService.listRideRequests(ride.id),
    ]));

    return selectSOSLauncherCandidates({
      hosting,
      passengerRequests,
      requestsByRide: Object.fromEntries(requestPairs),
      now,
    });
  },

  async findActiveCandidate(candidates) {
    const activeEvents = await Promise.all(candidates.map(async (candidate) => {
      try {
        return await RideSOSService.getActive(candidate.ride.id);
      } catch {
        return null;
      }
    }));
    const index = activeEvents.findIndex(Boolean);
    return index < 0 ? null : { candidate: candidates[index], event: activeEvents[index] };
  },
};
