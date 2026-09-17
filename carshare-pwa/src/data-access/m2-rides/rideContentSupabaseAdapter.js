import { isSupabaseConfigured, supabase } from '../shared/supabase/supabaseClient.js';

export const rideContentSupabaseAdapter = {
  isConfigured: isSupabaseConfigured,
  check(body) { return supabase.functions.invoke('m2-content-check', { body }); },
};
