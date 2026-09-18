// ===== BUSINESS LOGIC LAYER (RideRequestService) =====
import { rideRequestSupabaseAdapter } from '../../data-access/m2-rides/rideRequestSupabaseAdapter.js';
import '../shared/fixture/legacyMockDb.js';
import { rideMockAdapter } from '../../data-access/m2-rides/rideMockAdapter.js';
import { attachDestinationPhotoPlaceIds, mapRideRow, RideService } from './RideService.js';
import { getCurrentPosition, MAX_CHECK_IN_ACCURACY_METRES } from '../shared/GooglePlacesService.js';
import { ReputationService } from '../m1-profile/ReputationService.js';
import { IdentityVerificationService } from '../m1-profile/IdentityVerificationService.js';

function isMissingEstimatedArrival(error) {
  const detail = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`;
  return error?.code === '42703' || /estimated_arrival_at/i.test(detail);
}

function cleanCompanionNames(names = []) {
  return names.map((name) => name.trim()).filter(Boolean);
}

export function validateRideRequest({ seatsRequested, companionNames = [] }) {
  const seats = Number(seatsRequested);
  if (!Number.isInteger(seats) || seats < 1 || seats > 8) {
    throw new Error('Seats requested must be between 1 and 8.');
  }
  const names = cleanCompanionNames(companionNames);
  if (names.length !== seats - 1) {
    throw new Error(`Provide ${seats - 1} companion name${seats === 2 ? '' : 's'} for the additional seats.`);
  }
  return { seatsRequested: seats, companionNames: names };
}

export function mapRideRequestRow(row) {
  const stats = row.requester?.host_impact_stats?.[0] || row.requester?.host_impact_stats || null;
  return {
    id: row.id,
    rideId: row.ride_id ?? row.rideId,
    requesterId: row.requester_id ?? row.requesterId,
    seatsRequested: row.seats_requested ?? row.seatsRequested,
    companionNames: row.companion_names || row.companionNames || [],
    status: row.status,
    decisionReason: row.decision_reason ?? row.decisionReason ?? null,
    cancelledBy: row.cancelled_by ?? row.cancelledBy ?? null,
    createdAt: row.created_at ?? row.createdAt,
    updatedAt: row.updated_at ?? row.updatedAt,
    processedAt: row.processed_at ?? row.processedAt ?? null,
    acceptedAt: row.accepted_at ?? row.acceptedAt ?? null,
    cancelledAt: row.cancelled_at ?? row.cancelledAt ?? null,
    boardingStatus: row.boarding_status ?? row.boardingStatus ?? 'Pending',
    checkedInAt: row.checked_in_at ?? row.checkedInAt ?? null,
    checkInDistanceMeters: row.check_in_distance_meters ?? row.checkInDistanceMeters ?? null,
    checkInAccuracyMeters: row.check_in_accuracy_meters ?? row.checkInAccuracyMeters ?? null,
    noShowAt: row.no_show_at ?? row.noShowAt ?? null,
    noShowMarkedBy: row.no_show_marked_by ?? row.noShowMarkedBy ?? null,
    arrivalConfirmedAt: row.arrival_confirmed_at ?? row.arrivalConfirmedAt ?? null,
    requester: row.requester ? {
      id: row.requester.id,
      fullName: row.requester.full_name ?? row.requester.fullName,
      profilePhotoUrl: row.requester.profile_photo_url ?? row.requester.profilePhotoUrl,
      completedTrips: stats?.completed_trips ?? stats?.completedTrips ?? 0,
      reputationScore: stats?.reputation_score ?? stats?.reputationScore ?? 0,
      rating: stats?.rating ?? null
    } : null,
    ride: row.ride ? mapRideRow(row.ride) : null
  };
}

export async function attachRequestRidePhotoPlaceIds(requests = []) {
  const rides = requests.map((request) => request?.ride).filter(Boolean);
  if (!rides.length) return requests;

  const enrichedRides = await attachDestinationPhotoPlaceIds(rides);
  const rideById = new Map(enrichedRides.map((ride) => [ride.id, ride]));

  if (rideRequestSupabaseAdapter.isConfigured) {
    const missingAcceptedRideIds = [...new Set(requests
      .filter((request) => request?.ride
        && (request.status === 'Accepted' || request.acceptedAt)
        && !rideById.get(request.ride.id)?.destinationPhotoPlaceId
        && !rideById.get(request.ride.id)?.destinationLocation?.placeId)
      .map((request) => request.ride.id)
      .filter(Boolean))];

    const detailPhotoPlaceIds = await Promise.all(missingAcceptedRideIds.map(async (rideId) => {
      try {
        const detail = await RideService.getRide(rideId);
        return [rideId, detail?.destinationPhotoPlaceId || detail?.destinationLocation?.placeId || null];
      } catch {
        return [rideId, null];
      }
    }));

    detailPhotoPlaceIds.forEach(([rideId, placeId]) => {
      if (!placeId) return;
      rideById.set(rideId, { ...rideById.get(rideId), destinationPhotoPlaceId: placeId });
    });
  }

  return requests.map((request) => request.ride
    ? { ...request, ride: rideById.get(request.ride.id) || request.ride }
    : request);
}

function normalizeError(error) {
  return Object.assign(new Error(error?.message?.replace(/^.*?: /, '') || 'The request could not be processed.'), { code: error?.code });
}

export const RideRequestService = {
  backend: rideRequestSupabaseAdapter.isConfigured ? 'supabase' : 'mock',

  async submitRequest(requesterId, { rideId, seatsRequested, companionNames }) {
    await ReputationService.requireEligibility(requesterId, 'traveller');
    await IdentityVerificationService.requireVerifiedIdentity(requesterId);
    const request = validateRideRequest({ seatsRequested, companionNames });
    if (rideRequestSupabaseAdapter.isConfigured) {
      const { data: requestId, error } = await rideRequestSupabaseAdapter.submit({ rideId, ...request });
      if (error) throw normalizeError(error);
      let { data, error: readError } = await rideRequestSupabaseAdapter.getById(requestId);
      if (readError && isMissingEstimatedArrival(readError)) {
        ({ data, error: readError } = await rideRequestSupabaseAdapter.getById(requestId, { legacy: true }));
      }
      if (readError) throw normalizeError(readError);
      return (await attachRequestRidePhotoPlaceIds([mapRideRequestRow(data)]))[0];
    }
    return (await attachRequestRidePhotoPlaceIds([await rideMockAdapter.submitRideRequest(requesterId, { rideId, ...request })]))[0];
  },

  async listMyRequests(requesterId) {
    if (rideRequestSupabaseAdapter.isConfigured) {
      let { data, error } = await rideRequestSupabaseAdapter.listByRequester(requesterId);
      if (error && isMissingEstimatedArrival(error)) ({ data, error } = await rideRequestSupabaseAdapter.listByRequester(requesterId, { legacy: true }));
      if (error) throw normalizeError(error);
      return attachRequestRidePhotoPlaceIds(data.map(mapRideRequestRow));
    }
    return attachRequestRidePhotoPlaceIds(await rideMockAdapter.listMyRideRequests(requesterId));
  },

  async listRideRequests(rideId) {
    if (rideRequestSupabaseAdapter.isConfigured) {
      let { data, error } = await rideRequestSupabaseAdapter.listByRide(rideId);
      if (error && isMissingEstimatedArrival(error)) ({ data, error } = await rideRequestSupabaseAdapter.listByRide(rideId, { legacy: true }));
      if (error) throw normalizeError(error);
      return attachRequestRidePhotoPlaceIds(data.map(mapRideRequestRow));
    }
    return attachRequestRidePhotoPlaceIds(await rideMockAdapter.listRideRequests(rideId));
  },

  async acceptRequest(requestId) {
    if (rideRequestSupabaseAdapter.isConfigured) {
      const { error } = await rideRequestSupabaseAdapter.respond(requestId, 'Accepted');
      if (error) throw normalizeError(error);
      return true;
    }
    return rideMockAdapter.respondToRideRequest(requestId, 'Accepted');
  },

  async rejectRequest(requestId, reason = 'Host declined the request') {
    if (rideRequestSupabaseAdapter.isConfigured) {
      const { error } = await rideRequestSupabaseAdapter.respond(requestId, 'Rejected', reason);
      if (error) throw normalizeError(error);
      return true;
    }
    return rideMockAdapter.respondToRideRequest(requestId, 'Rejected', reason);
  },

  async cancelRequest(requestId, reason) {
    if (!reason?.trim()) throw new Error('A cancellation reason is required.');
    if (rideRequestSupabaseAdapter.isConfigured) {
      const { error } = await rideRequestSupabaseAdapter.cancel(requestId, reason.trim());
      if (error) throw normalizeError(error);
      return true;
    }
    return rideMockAdapter.cancelRideRequest(requestId, reason.trim());
  },

  async checkIn(requestId) {
    const position = await getCurrentPosition();
    const { latitude, longitude, accuracy } = position.coords;
    if (!Number.isFinite(accuracy) || accuracy > MAX_CHECK_IN_ACCURACY_METRES) {
      throw new Error(`GPS accuracy must be ${MAX_CHECK_IN_ACCURACY_METRES} metres or better for passenger check-in.`);
    }
    if (rideRequestSupabaseAdapter.isConfigured) {
      const { error } = await rideRequestSupabaseAdapter.checkIn(requestId, { latitude, longitude, accuracy });
      if (error) throw normalizeError(error);
      return true;
    }
    return rideMockAdapter.checkInRideRequest(requestId, { latitude, longitude, accuracy });
  },

  async markNoShow(requestId) {
    if (rideRequestSupabaseAdapter.isConfigured) {
      const { error } = await rideRequestSupabaseAdapter.markNoShow(requestId);
      if (error) throw normalizeError(error);
      return true;
    }
    return rideMockAdapter.markRideRequestNoShow(requestId);
  },

  async confirmArrival(requestId) {
    if (rideRequestSupabaseAdapter.isConfigured) {
      const { error } = await rideRequestSupabaseAdapter.confirmArrival(requestId);
      if (error) throw normalizeError(error);
      return true;
    }
    return rideMockAdapter.confirmPassengerArrival(requestId);
  }
};
