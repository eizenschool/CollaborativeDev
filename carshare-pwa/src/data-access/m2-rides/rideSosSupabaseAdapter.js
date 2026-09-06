import { isSupabaseConfigured, supabase } from '../shared/supabase/supabaseClient.js';

function invoke(name, params) {
  return supabase.rpc(name, params);
}

export const rideSosSupabaseAdapter = {
  isConfigured: isSupabaseConfigured,
  activate: (rideId) => invoke('activate_m2_sos', { p_ride_id: rideId }),
  getActive: (rideId) => invoke('get_active_m2_sos', { p_ride_id: rideId }),
  resolve: (eventId) => invoke('resolve_m2_sos', { p_event_id: eventId }),
  getFamilySnapshot: (eventId) => invoke('get_m2_sos_family_snapshot', { p_event_id: eventId })
};
