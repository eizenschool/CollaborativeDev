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

  adminGetSummary(userId) {
    return requireClient().rpc('admin_get_reputation_summary', { p_user_id: userId });
  },

  adminApplyConductOutcome(userId, eventType, reason, rideId, setHold) {
    return requireClient().rpc('admin_apply_conduct_outcome', {
      p_user_id: userId,
      p_event_type: eventType,
      p_reason: reason,
      p_ride_id: rideId,
      p_set_hold: setHold
    });
  },

  adminClearHold(userId, reason) {
    return requireClient().rpc('admin_clear_reputation_hold', { p_user_id: userId, p_reason: reason });
  },

  submitSafetyReport(reportedUserId, reason, rideId) {
    return requireClient().rpc('submit_safety_report', {
      p_reported_user_id: reportedUserId,
      p_reason: reason,
      p_ride_id: rideId
    });
  },

  adminListSafetyReports(status) {
    return requireClient().rpc('admin_list_safety_reports', { p_status: status });
  },

  adminResolveSafetyReport(reportId, status, note) {
    return requireClient().rpc('admin_resolve_safety_report', {
      p_report_id: reportId,
      p_status: status,
      p_note: note
    });
  },
};
