import { isSupabaseConfigured, supabase } from '../shared/supabase/supabaseClient.js';

function requireClient() {
  if (!isSupabaseConfigured || !supabase) throw new Error('Reputation requires a configured Supabase connection.');
  return supabase;
}

export const reputationSupabaseAdapter = {
  isConfigured: isSupabaseConfigured,

  async getSummary(userId) {
    return requireClient().rpc('get_reputation_summary', { p_user_id: userId });
  },

  async getLegacySummary(userId) {
    const client = requireClient();
    const [{ data: stats, error: statsError }, { count, error: reviewError }] = await Promise.all([
      client.from('host_impact_stats')
        .select('completed_trips, reputation_score, rating')
        .eq('user_id', userId)
        .single(),
      client.from('ride_reviews').select('id', { count: 'exact', head: true }).eq('reviewee_id', userId),
    ]);
    if (statsError) throw statsError;
    return { ...stats, review_count: reviewError ? 0 : count, events: [] };
  },

  async getHostImpact(userId) {
    const { data, error } = await requireClient()
      .from('host_impact_stats')
      .select('completed_trips, co2_saved_kg, reputation_score, reputation_hold')
      .eq('user_id', userId)
      .single();
    if (error) throw error;
    return data;
  },
};
