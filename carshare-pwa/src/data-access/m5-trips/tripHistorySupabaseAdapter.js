import { isSupabaseConfigured, supabase } from '../shared/supabase/supabaseClient.js';

export const tripHistorySupabaseAdapter = {
  isConfigured: isSupabaseConfigured,

  listHostsWithCompletedTrips() {
    return supabase.from('host_impact_stats').select('user_id').gt('completed_trips', 0);
  },

  listProfileNames(userIds) {
    return supabase.from('profiles').select('id, full_name').in('id', userIds);
  }
};
