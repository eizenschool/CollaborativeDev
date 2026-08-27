// ===== BUSINESS LOGIC LAYER (RideRequestService) =====
import { supabase, isSupabaseConfigured } from '../data-access/supabaseClient.js';
import { mockDb } from '../data-access/mockDataStore.js';
import { attachDestinationPhotoPlaceIds, mapRideRow, RideService } from './RideService.js';
import { getCurrentPosition, MAX_CHECK_IN_ACCURACY_METRES } from './GooglePlacesService.js';
import { ReputationService } from './ReputationService.js';

const REQUEST_SELECT = `
  *,
  requester:profiles!ride_requests_requester_id_fkey(
    id, full_name, profile_photo_url,
    host_impact_stats(completed_trips, reputation_score, rating)
  ),
  ride:rides(
    id, host_id, pickup, destination, departure_at, journey_scale,
    seats_total, seats_available, contribution, restriction_tags,
    status, estimated_arrival_at,
    host:profiles!rides_host_id_fkey(id, full_name, profile_photo_url, host_impact_stats(completed_trips, co2_saved_kg, reputation_score, rating))
  )
`;
const LEGACY_REQUEST_SELECT = `
  *,
  requester:profiles!ride_requests_requester_id_fkey(
    id, full_name, profile_photo_url,
    host_impact_stats(completed_trips, reputation_score, rating)
  ),
  ride:rides(
    id, host_id, pickup, destination, departure_at, journey_scale,
    seats_total, seats_available, contribution, restriction_tags, status,
    host:profiles!rides_host_id_fkey(id, full_name, profile_photo_url, host_impact_stats(completed_trips, co2_saved_kg, reputation_score, rating))
  )
`;

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

  if (isSupabaseConfigured) {
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
  backend: isSupabaseConfigured ? 'supabase' : 'mock',

  async submitRequest(requesterId, { rideId, seatsRequested, companionNames }) {
    await ReputationService.requireEligibility(requesterId, 'traveller');
    const request = validateRideRequest({ seatsRequested, companionNames });
    if (isSupabaseConfigured) {
      const { data: requestId, error } = await supabase.rpc('submit_ride_request', {
        p_ride_id: rideId,
        p_seats_requested: request.seatsRequested,
        p_companion_names: request.companionNames
      });
      if (error) throw normalizeError(error);
      let { data, error: readError } = await supabase.from('ride_requests').select(REQUEST_SELECT).eq('id', requestId).single();
      if (readError && isMissingEstimatedArrival(readError)) {
        ({ data, error: readError } = await supabase.from('ride_requests').select(LEGACY_REQUEST_SELECT).eq('id', requestId).single());
      }
      if (readError) throw normalizeError(readError);
      return (await attachRequestRidePhotoPlaceIds([mapRideRequestRow(data)]))[0];
    }
    return (await attachRequestRidePhotoPlaceIds([await mockDb.submitRideRequest(requesterId, { rideId, ...request })]))[0];
  },

  async listMyRequests(requesterId) {
    if (isSupabaseConfigured) {
      const run = (select) => supabase.from('ride_requests').select(select)
        .eq('requester_id', requesterId).order('created_at', { ascending: false });
      let { data, error } = await run(REQUEST_SELECT);
      if (error && isMissingEstimatedArrival(error)) ({ data, error } = await run(LEGACY_REQUEST_SELECT));
      if (error) throw normalizeError(error);
      return attachRequestRidePhotoPlaceIds(data.map(mapRideRequestRow));
    }
    return attachRequestRidePhotoPlaceIds(await mockDb.listMyRideRequests(requesterId));
  },

  async listRideRequests(rideId) {
    if (isSupabaseConfigured) {
      const run = (select) => supabase.from('ride_requests').select(select)
        .eq('ride_id', rideId).order('created_at', { ascending: true });
      let { data, error } = await run(REQUEST_SELECT);
      if (error && isMissingEstimatedArrival(error)) ({ data, error } = await run(LEGACY_REQUEST_SELECT));
      if (error) throw normalizeError(error);
      return attachRequestRidePhotoPlaceIds(data.map(mapRideRequestRow));
    }
    return attachRequestRidePhotoPlaceIds(await mockDb.listRideRequests(rideId));
  },

  async acceptRequest(requestId) {
    if (isSupabaseConfigured) {
      const { error } = await supabase.rpc('respond_to_ride_request', {
        p_request_id: requestId,
        p_decision: 'Accepted',
        p_reason: null
      });
      if (error) throw normalizeError(error);
      return true;
    }
    return mockDb.respondToRideRequest(requestId, 'Accepted');
  },

  async rejectRequest(requestId, reason = 'Host declined the request') {
    if (isSupabaseConfigured) {
      const { error } = await supabase.rpc('respond_to_ride_request', {
        p_request_id: requestId,
        p_decision: 'Rejected',
        p_reason: reason
      });
      if (error) throw normalizeError(error);
      return true;
    }
    return mockDb.respondToRideRequest(requestId, 'Rejected', reason);
  },

  async cancelRequest(requestId, reason) {
    if (!reason?.trim()) throw new Error('A cancellation reason is required.');
    if (isSupabaseConfigured) {
      const { error } = await supabase.rpc('cancel_ride_request', {
        p_request_id: requestId,
        p_reason: reason.trim()
      });
      if (error) throw normalizeError(error);
      return true;
    }
    return mockDb.cancelRideRequest(requestId, reason.trim());
  },

  async checkIn(requestId) {
    const position = await getCurrentPosition();
    const { latitude, longitude, accuracy } = position.coords;
    if (!Number.isFinite(accuracy) || accuracy > MAX_CHECK_IN_ACCURACY_METRES) {
      throw new Error(`GPS accuracy must be ${MAX_CHECK_IN_ACCURACY_METRES} metres or better for passenger check-in.`);
    }
    if (isSupabaseConfigured) {
      const { error } = await supabase.rpc('check_in_ride_request', {
        p_request_id: requestId,
        p_latitude: latitude,
        p_longitude: longitude,
        p_accuracy_meters: accuracy
      });
      if (error) throw normalizeError(error);
      return true;
    }
    return mockDb.checkInRideRequest(requestId, { latitude, longitude, accuracy });
  },

  async markNoShow(requestId) {
    if (isSupabaseConfigured) {
      const { error } = await supabase.rpc('mark_ride_request_no_show', { p_request_id: requestId });
      if (error) throw normalizeError(error);
      return true;
    }
    return mockDb.markRideRequestNoShow(requestId);
  },

  async confirmArrival(requestId) {
    if (isSupabaseConfigured) {
      const { error } = await supabase.rpc('confirm_passenger_arrival', { p_request_id: requestId });
      if (error) throw normalizeError(error);
      return true;
    }
    return mockDb.confirmPassengerArrival(requestId);
  }
};
