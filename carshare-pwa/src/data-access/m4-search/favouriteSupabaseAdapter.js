import { isSupabaseConfigured, supabase } from '../shared/supabase/supabaseClient.js';

function requireClient() {
  if (!isSupabaseConfigured || !supabase) throw new Error('Favourites require a configured Supabase connection.');
  return supabase;
}

export const favouriteSupabaseAdapter = {
  isConfigured: isSupabaseConfigured,

  async list() {
    const { data, error } = await requireClient().rpc('list_my_favourite_rides');
    if (error) throw error;
    return data || [];
  },

  async add(rideId) {
    const { error } = await requireClient().rpc('add_ride_favourite', { p_ride_id: rideId });
    if (error) throw error;
  },

  async remove(rideId) {
    const { error } = await requireClient().rpc('remove_ride_favourite', { p_ride_id: rideId });
    if (error) throw error;
  },
};
