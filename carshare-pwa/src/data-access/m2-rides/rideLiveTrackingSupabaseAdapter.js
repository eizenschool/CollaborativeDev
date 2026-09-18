import { isSupabaseConfigured, supabase } from '../shared/supabase/supabaseClient.js';

function invoke(name, params) {
  return supabase.rpc(name, params);
}

export const rideLiveTrackingSupabaseAdapter = {
  isConfigured: isSupabaseConfigured,
  startSharing: (rideId, consentVersion) => invoke('start_m2_location_sharing', { p_ride_id: rideId, p_consent_version: consentVersion }),
  publishLocation: (rideId, point) => invoke('publish_m2_live_location', {
    p_ride_id: rideId,
    p_latitude: Number(point.lat),
    p_longitude: Number(point.lng),
    p_accuracy_meters: Number(point.accuracyM),
    p_heading_degrees: point.headingDeg == null ? null : Number(point.headingDeg),
    p_speed_mps: point.speedMps == null ? null : Number(point.speedMps),
    p_captured_at: point.capturedAt || new Date().toISOString()
  }),
  stopSharing: (rideId) => invoke('stop_m2_location_sharing', { p_ride_id: rideId }),
  getLiveSnapshot: (rideId) => invoke('get_m2_live_locations', { p_ride_id: rideId }),
  getHistory: (rideId, after, limit) => invoke('get_m2_location_history', { p_ride_id: rideId, p_after: after, p_limit: limit }),
  hideHistory: (rideId) => invoke('hide_m2_location_history', { p_ride_id: rideId }),
  createFamilyShare: (rideId) => invoke('create_m2_family_location_share', { p_ride_id: rideId }),
  revokeFamilyShare: (shareId) => invoke('revoke_m2_family_location_share', { p_share_id: shareId }),
  consumeDynamicMapLoad: (pageSessionId) => invoke('consume_m2_dynamic_map_load', { p_page_session_id: pageSessionId }),

  subscribe(rideId, suffix, onPayload, onStatus) {
    const channel = supabase
      .channel(`m2-live:${rideId}:${suffix}`, { config: { private: true } })
      .on('broadcast', { event: 'LOCATION' }, onPayload)
      .subscribe(onStatus);
    return () => { void supabase.removeChannel(channel); };
  }
};
