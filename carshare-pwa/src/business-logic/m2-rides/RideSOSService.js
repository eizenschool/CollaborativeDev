import { rideSosSupabaseAdapter } from '../../data-access/m2-rides/rideSosSupabaseAdapter.js';

function assertConfigured() {
  if (!rideSosSupabaseAdapter.isConfigured) {
    throw new Error('SOS requires a configured Supabase connection.');
  }
}

async function run(request, fallback) {
  assertConfigured();
  const { data, error } = await request();
  if (error) throw new Error(error.message?.replace(/^.*?: /, '') || fallback);
  return data;
}

export const RideSOSService = {
  backend: rideSosSupabaseAdapter.isConfigured ? 'supabase' : 'unconfigured',

  activate(rideId) {
    return run(() => rideSosSupabaseAdapter.activate(rideId), 'Unable to activate SOS.');
  },

  getActive(rideId) {
    return run(() => rideSosSupabaseAdapter.getActive(rideId), 'Unable to restore SOS status.');
  },

  resolve(eventId) {
    return run(() => rideSosSupabaseAdapter.resolve(eventId), 'Unable to resolve SOS.');
  },

  getFamilySnapshot(eventId) {
    return run(() => rideSosSupabaseAdapter.getFamilySnapshot(eventId), 'Unable to load this SOS alert.');
  }
};
