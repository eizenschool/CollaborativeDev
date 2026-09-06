import { isSupabaseConfigured, supabase } from '../shared/supabase/supabaseClient.js';

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

const requestSelect = (legacy) => legacy ? LEGACY_REQUEST_SELECT : REQUEST_SELECT;

export const rideRequestSupabaseAdapter = {
  isConfigured: isSupabaseConfigured,

  submit({ rideId, seatsRequested, companionNames }) {
    return supabase.rpc('submit_ride_request', {
      p_ride_id: rideId,
      p_seats_requested: seatsRequested,
      p_companion_names: companionNames
    });
  },

  getById(requestId, { legacy = false } = {}) {
    return supabase.from('ride_requests').select(requestSelect(legacy)).eq('id', requestId).single();
  },

  listByRequester(requesterId, { legacy = false } = {}) {
    return supabase.from('ride_requests').select(requestSelect(legacy))
      .eq('requester_id', requesterId).order('created_at', { ascending: false });
  },

  listByRide(rideId, { legacy = false } = {}) {
    return supabase.from('ride_requests').select(requestSelect(legacy))
      .eq('ride_id', rideId).order('created_at', { ascending: true });
  },

  respond(requestId, decision, reason = null) {
    return supabase.rpc('respond_to_ride_request', {
      p_request_id: requestId,
      p_decision: decision,
      p_reason: reason
    });
  },

  cancel(requestId, reason) {
    return supabase.rpc('cancel_ride_request', { p_request_id: requestId, p_reason: reason });
  },

  checkIn(requestId, { latitude, longitude, accuracy }) {
    return supabase.rpc('check_in_ride_request', {
      p_request_id: requestId,
      p_latitude: latitude,
      p_longitude: longitude,
      p_accuracy_meters: accuracy
    });
  },

  markNoShow: (requestId) => supabase.rpc('mark_ride_request_no_show', { p_request_id: requestId }),
  confirmArrival: (requestId) => supabase.rpc('confirm_passenger_arrival', { p_request_id: requestId })
};
