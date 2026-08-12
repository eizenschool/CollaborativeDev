// ===== BUSINESS LOGIC LAYER (RideRequestService) =====
import { supabase, isSupabaseConfigured } from '../data-access/supabaseClient.js';
import { mockDb } from '../data-access/mockDataStore.js';
import { mapRideRow } from './RideService.js';

const REQUEST_SELECT = `
  *,
  requester:profiles!ride_requests_requester_id_fkey(
    id, full_name, profile_photo_url,
    host_impact_stats(completed_trips, reputation_score, rating)
  ),
  ride:rides(
    *,
    host:profiles(id, full_name, profile_photo_url, host_impact_stats(completed_trips, co2_saved_kg, reputation_score, rating))
  )
`;

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
    cancelledAt: row.cancelled_at ?? row.cancelledAt ?? null,
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

function normalizeError(error) {
  return Object.assign(new Error(error?.message?.replace(/^.*?: /, '') || 'The request could not be processed.'), { code: error?.code });
}

export const RideRequestService = {
  backend: isSupabaseConfigured ? 'supabase' : 'mock',

  async submitRequest(requesterId, { rideId, seatsRequested, companionNames }) {
    const request = validateRideRequest({ seatsRequested, companionNames });
    if (isSupabaseConfigured) {
      const { data: requestId, error } = await supabase.rpc('submit_ride_request', {
        p_ride_id: rideId,
        p_seats_requested: request.seatsRequested,
        p_companion_names: request.companionNames
      });
      if (error) throw normalizeError(error);
      const { data, error: readError } = await supabase.from('ride_requests').select(REQUEST_SELECT).eq('id', requestId).single();
      if (readError) throw normalizeError(readError);
      return mapRideRequestRow(data);
    }
    return mockDb.submitRideRequest(requesterId, { rideId, ...request });
  },

  async listMyRequests(requesterId) {
    if (isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('ride_requests')
        .select(REQUEST_SELECT)
        .eq('requester_id', requesterId)
        .order('created_at', { ascending: false });
      if (error) throw normalizeError(error);
      return data.map(mapRideRequestRow);
    }
    return mockDb.listMyRideRequests(requesterId);
  },

  async listRideRequests(rideId) {
    if (isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('ride_requests')
        .select(REQUEST_SELECT)
        .eq('ride_id', rideId)
        .order('created_at', { ascending: true });
      if (error) throw normalizeError(error);
      return data.map(mapRideRequestRow);
    }
    return mockDb.listRideRequests(rideId);
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
  }
};
