import { isSupabaseConfigured, supabase } from '../shared/supabase/supabaseClient.js';

const PUBLIC_RIDE_SELECT = `
  id, host_id, pickup, destination,
  departure_at, journey_scale,
  seats_total, seats_available, contribution, restriction_tags,
  status, estimated_arrival_at,
  host:profiles!rides_host_id_fkey(id, full_name, profile_photo_url,
    host_impact_stats(completed_trips, co2_saved_kg, reputation_score, rating)
  )
`;

const LEGACY_PUBLIC_RIDE_SELECT = `
  id, host_id, pickup, destination,
  departure_at, journey_scale,
  seats_total, seats_available, contribution, restriction_tags,
  status,
  host:profiles!rides_host_id_fkey(id, full_name, profile_photo_url,
    host_impact_stats(completed_trips, co2_saved_kg, reputation_score, rating)
  )
`;

const LEGACY_HOST_RIDE_SELECT = `
  *,
  host:profiles!rides_host_id_fkey(id, full_name, profile_photo_url,
    host_impact_stats(completed_trips, co2_saved_kg, reputation_score, rating)
  )
`;

function rideSelect(mode) {
  if (mode === 'legacy-public') return LEGACY_PUBLIC_RIDE_SELECT;
  if (mode === 'legacy-host') return LEGACY_HOST_RIDE_SELECT;
  return PUBLIC_RIDE_SELECT;
}

export const rideSupabaseAdapter = {
  isConfigured: isSupabaseConfigured,

  invokeRoute(body) {
    return supabase.functions.invoke('m2-route-quote', { body });
  },

  getDestinationPhotoPlaceIds(rideIds) {
    return supabase.rpc('get_ride_destination_photo_place_ids', { p_ride_ids: rideIds });
  },

  searchConfirmed(params) {
    return supabase.rpc('search_public_rides_with_confirmed_locations', params);
  },

  searchCompatible(params) {
    return supabase.rpc('search_public_rides_with_compatibility', params);
  },

  searchNearDestination(params) {
    return supabase.rpc('search_public_rides_near_destination', params);
  },

  searchPublished({ from, to, range, legacy = false }) {
    let query = supabase.from('rides').select(rideSelect(legacy ? 'legacy-public' : 'public')).eq('status', 'Published');
    if (from) query = query.ilike('pickup', `%${from}%`);
    if (to) query = query.ilike('destination', `%${to}%`);
    if (range) query = query.gte('departure_at', range.start).lt('departure_at', range.end);
    return query.order('departure_at', { ascending: true });
  },

  searchMultiLeg(params, { confirmed = false } = {}) {
    const rpcName = confirmed
      ? 'search_public_multi_leg_journeys_with_confirmed_locations'
      : 'search_public_multi_leg_journeys';
    return supabase.rpc(rpcName, params);
  },

  listByHost(userId, { legacy = false } = {}) {
    return supabase.from('rides').select(rideSelect(legacy ? 'legacy-public' : 'public'))
      .eq('host_id', userId).order('departure_at', { ascending: false });
  },

  getSession() {
    return supabase.auth.getSession();
  },

  getRide(rideId, { mode = 'public' } = {}) {
    return supabase.from('rides').select(rideSelect(mode)).eq('id', rideId).maybeSingle();
  },

  getParticipantDetail(rideId) {
    return supabase.rpc('get_participant_ride_detail', { p_ride_id: rideId });
  },

  getPublicPickupContext(rideId) {
    return supabase.rpc('get_public_ride_pickup_context', { p_ride_id: rideId });
  },

  updateRide(rideId, values) {
    return supabase.rpc('update_ride', { p_ride_id: rideId, ...values });
  },

  createDraft(values) {
    return supabase.rpc('create_ride', { ...values, p_publish: false });
  },

  deleteDraft: (rideId) => supabase.rpc('delete_draft_ride', { p_ride_id: rideId }),
  republishAsDraft: (rideId) => supabase.rpc('republish_m2_ride_as_draft', { p_ride_id: rideId }),
  cancel: (rideId, reason) => supabase.rpc('cancel_ride', { p_ride_id: rideId, p_reason: reason }),
  closeRecruitment: (rideId) => supabase.rpc('close_ride_recruitment', { p_ride_id: rideId }),
  reopenRecruitment: (rideId) => supabase.rpc('reopen_ride_recruitment', { p_ride_id: rideId }),
  getLifecycleContext: (rideId) => supabase.rpc('get_ride_lifecycle_context', { p_ride_id: rideId }),

  confirmDriverArrival(rideId, position) {
    return supabase.rpc('confirm_driver_arrival', {
      p_ride_id: rideId,
      p_latitude: position.latitude,
      p_longitude: position.longitude,
      p_accuracy_meters: position.accuracy
    });
  }
};
