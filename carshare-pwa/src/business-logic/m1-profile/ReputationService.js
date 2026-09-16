import { reputationSupabaseAdapter } from '../../data-access/m1-profile/reputationSupabaseAdapter.js';
import '../shared/fixture/legacyMockDb.js';
import { profileMockAdapter } from '../../data-access/m1-profile/profileMockAdapter.js';
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

export function normalizeSafetyReport(value = {}) {
  return {
    ...value,
    messageEvidenceId: value.messageEvidenceId ?? value.message_evidence_id ?? null,
  };
}

export const ReputationService = {
  backend: reputationSupabaseAdapter.isConfigured ? 'supabase' : 'mock',

  async getSummary(userId) {
    if (!reputationSupabaseAdapter.isConfigured) return mapSummary(await profileMockAdapter.getReputationSummary(userId));

    const { data, error } = await reputationSupabaseAdapter.getSummary(userId);
    if (!error) return mapSummary(data || {});
    if (!missingReputationContract(error)) throw error;
    return mapSummary(await reputationSupabaseAdapter.getLegacySummary(userId));
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
  },

  // Admin-only (106_m1). get_reputation_summary (072_m1) hard-requires
  // auth.uid() = p_user_id, so a reviewer confirming a case about someone
  // else cannot use it - this routes through admin_get_reputation_summary,
  // which re-checks the allowlist server-side, and only ever returns
  // Safety-sourced (confirmed conduct) history, not the member's full ride
  // ledger.
  async adminGetSummary(userId) {
    if (!reputationSupabaseAdapter.isConfigured) {
      const data = await profileMockAdapter.adminGetReputationSummary(userId);
      return mapSummary({ ...data, events: data.conductEvents });
    }
    const { data, error } = await reputationSupabaseAdapter.adminGetSummary(userId);
    if (error) throw error;
    return mapSummary({ ...(data || {}), events: (data || {}).conductEvents });
  },

  // Admin-only (106_m1). Routes through admin_apply_conduct_outcome, which
  // re-checks the allowlist and requires a non-empty reason before it will
  // ever call private.apply_conduct_outcome - a reviewer cannot confirm a
  // case with no stated reason. The server generates its own source_event_id
  // per call, so confirming two separate incidents the same day never
  // collapses into one.
  async adminApplyConductOutcome(userId, eventType, reason, { rideId = null, setHold = false } = {}) {
    if (!reputationSupabaseAdapter.isConfigured) {
      return profileMockAdapter.adminApplyConductOutcome(userId, eventType, reason, rideId, setHold);
    }
    const { data, error } = await reputationSupabaseAdapter.adminApplyConductOutcome(userId, eventType, reason, rideId, setHold);
    if (error) throw error;
    return Boolean(data);
  },

  // Admin-only (106_m1). Only clears the hold flag - it does not insert a
  // compensating score event. A full appeal path that nets the score back is
  // separate, larger work this does not attempt (see the Conduct Severity
  // Rulebook's appeal section).
  async adminClearHold(userId, reason = null) {
    if (!reputationSupabaseAdapter.isConfigured) return profileMockAdapter.adminClearReputationHold(userId, reason);
    const { error } = await reputationSupabaseAdapter.adminClearHold(userId, reason);
    if (error) throw error;
  },

  // Self-service Safety Report intake (107_m1) - any signed-in member can
  // flag another member with a reason and an optional ride ID. This is
  // deliberately the narrow slice of the case queue that stays inside
  // Module 1: it does not pull ride/message/trip evidence from M2/M3/M5,
  // it just gives a Trust & Safety reviewer a starting point instead of
  // requiring they already know a member's user ID from outside the app.
  async submitSafetyReport(reporterId, reportedUserId, reason, rideId = null) {
    if (!reputationSupabaseAdapter.isConfigured) {
      return profileMockAdapter.submitSafetyReport(reporterId, reportedUserId, reason, rideId);
    }
    const { data, error } = await reputationSupabaseAdapter.submitSafetyReport(reportedUserId, reason, rideId);
    if (error) throw error;
    return data;
  },

  // Admin-only (107_m1). 'open' (the default) is queue order - oldest
  // first; 'resolved'/'dismissed'/'all' are a resolution history instead.
  async adminListSafetyReports(status = 'open') {
    if (!reputationSupabaseAdapter.isConfigured) {
      const reports = await profileMockAdapter.adminListSafetyReports(status);
      return reports.map(normalizeSafetyReport);
    }
    const { data, error } = await reputationSupabaseAdapter.adminListSafetyReports(status);
    if (error) throw error;
    return (data || []).map(normalizeSafetyReport);
  },

  // Admin-only (107_m1). Resolving/dismissing a queue entry is separate
  // from confirming a Trust Case (adminApplyConductOutcome above) - a
  // report can be dismissed with no conduct outcome, and one confirmed
  // case might close several open reports about the same member at once.
  async adminResolveSafetyReport(reportId, status, note = null) {
    if (!reputationSupabaseAdapter.isConfigured) {
      return profileMockAdapter.adminResolveSafetyReport(reportId, status, note);
    }
    const { error } = await reputationSupabaseAdapter.adminResolveSafetyReport(reportId, status, note);
    if (error) throw error;
  }
};

