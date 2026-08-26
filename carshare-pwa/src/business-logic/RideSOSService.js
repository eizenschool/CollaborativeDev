import { supabase, isSupabaseConfigured } from '../data-access/supabaseClient.js';

function clientOrThrow() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('SOS requires a configured Supabase connection.');
  }
  return supabase;
}

async function rpc(name, params, fallback) {
  const { data, error } = await clientOrThrow().rpc(name, params);
  if (error) throw new Error(error.message?.replace(/^.*?: /, '') || fallback);
  return data;
}

export const RideSOSService = {
  backend: isSupabaseConfigured ? 'supabase' : 'unconfigured',

  activate(rideId) {
    return rpc('activate_m2_sos', { p_ride_id: rideId }, 'Unable to activate SOS.');
  },

  getActive(rideId) {
    return rpc('get_active_m2_sos', { p_ride_id: rideId }, 'Unable to restore SOS status.');
  },

  resolve(eventId) {
    return rpc('resolve_m2_sos', { p_event_id: eventId }, 'Unable to resolve SOS.');
  },

  getFamilySnapshot(eventId) {
    return rpc('get_m2_sos_family_snapshot', { p_event_id: eventId }, 'Unable to load this SOS alert.');
  }
};
