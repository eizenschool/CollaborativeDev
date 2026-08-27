import { isSupabaseConfigured, supabase } from '../data-access/supabaseClient.js';
import { mockDb } from '../data-access/mockDataStore.js';
import {
  getRideEligibility,
  reputationEvidenceCount,
  reputationStanding,
  REPUTATION_POLICY
} from './ReputationPolicy.js';

function missingReputationContract(error) {
  const detail = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`;
  return error?.code === 'PGRST202' || /get_reputation_summary|get_ride_eligibility/i.test(detail);
}

function mapSummary(value = {}) {
  const events = value.events || [];
  const completedTrips = Number(value.completedTrips ?? value.completed_trips ?? 0);
  const evidenceCount = Number(value.evidenceCount ?? value.evidence_count ?? reputationEvidenceCount(events, completedTrips));
  const score = Number(value.score ?? value.reputationScore ?? value.reputation_score ?? REPUTATION_POLICY.baseScore);
  const hold = Boolean(value.hold ?? value.reputation_hold);
  const provisional = evidenceCount < REPUTATION_POLICY.minEvidenceRides;
  return {
    score,
    evidenceCount,
    provisional,
    hold,
    standing: reputationStanding(score, { provisional, hold }),
    rating: value.rating == null ? null : Number(value.rating),
    reviewCount: Number(value.reviewCount ?? value.review_count ?? 0),
    events: events.map((event) => ({
      id: event.id,
      rideId: event.rideId ?? event.ride_id ?? null,
      type: event.type ?? event.event_type,
      delta: Number(event.delta || 0),
      reason: event.reason || '',
      createdAt: event.createdAt ?? event.created_at
    }))
  };
}

export const ReputationService = {
  backend: isSupabaseConfigured ? 'supabase' : 'mock',

  async getSummary(userId) {
    if (!isSupabaseConfigured) return mapSummary(await mockDb.getReputationSummary(userId));

    const { data, error } = await supabase.rpc('get_reputation_summary', { p_user_id: userId });
    if (!error) return mapSummary(data || {});
    if (!missingReputationContract(error)) throw error;

    const [{ data: stats, error: statsError }, { count, error: reviewError }] = await Promise.all([
      supabase.from('host_impact_stats')
        .select('completed_trips, reputation_score, rating')
        .eq('user_id', userId)
        .single(),
      supabase.from('ride_reviews').select('id', { count: 'exact', head: true }).eq('reviewee_id', userId)
    ]);
    if (statsError) throw statsError;
    return mapSummary({ ...stats, review_count: reviewError ? 0 : count, events: [] });
  },

  async getEligibility(userId, role) {
    const summary = await this.getSummary(userId);
    return { ...getRideEligibility(summary, role), score: summary.score, evidenceCount: summary.evidenceCount };
  },

  async requireEligibility(userId, role) {
    const result = await this.getEligibility(userId, role);
    if (!result.eligible) {
      const error = new Error(result.reason);
      error.code = 'REPUTATION_RESTRICTED';
      throw error;
    }
    return result;
  }
};

