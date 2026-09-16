import { supabase, isSupabaseConfigured } from '../shared/supabase/supabaseClient.js';

export const messageReportRepository = {
  async invoke(body) {
    if (!isSupabaseConfigured || !supabase) throw new Error('Message reports require an online connection.');
    const { data, error } = await supabase.functions.invoke('m3-message-reports', { body });
    if (error) {
      const detail = await error.context?.json?.().catch(() => null);
      throw new Error(detail?.error || error.message);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  },
};
