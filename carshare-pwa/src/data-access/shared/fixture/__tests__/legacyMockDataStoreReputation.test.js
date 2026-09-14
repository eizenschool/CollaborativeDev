// ===== DATA ACCESS LAYER TEST (legacyMockDataStore reputation ledger) =====
// The offline fallback store (see legacyMockDataStore.js's own header) is the
// one place this repository can actually execute the +3-per-ride cap and
// idempotent-ledger rules end to end without a live Supabase project: the
// real enforcement lives in deployed/authored SQL (072_m1, 105_m1) that
// Module1ReputationSql.test.js can only string-match, not run. This file
// proves the mirrored JS logic in legacyMockDataStore.js actually behaves,
// not just that its source text contains the right tokens.
//
// vitest.config.js runs tests under a plain Node environment (no DOM), so
// localStorage - which load()/save() depend on - does not exist globally.
// This in-memory polyfill is local to this file and never touches the real
// browser storage a running app would use.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map();
vi.stubGlobal('localStorage', {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear()
});

// Registers the real ReputationPolicy.js implementations into the store,
// exactly as production code does (see ReputationPolicy.js's own import of
// this same file) - not a second, parallel mock of the policy.
await import('../../../../business-logic/shared/fixture/legacyMockDb.js');
const { mockDb } = await import('../legacyMockDataStore.js');

const U_DEMO_1 = 'u_demo_1'; // seeded createdAt 2026-02-10
const U_DEMO_2 = 'u_demo_2'; // seeded createdAt 2026-01-01 (earlier signup)

beforeEach(() => {
  store.clear();
});

describe('legacyMockDataStore reputation ledger', () => {
  it('applies the +3-per-ride positive cap across three separate positive events on one ride', async () => {
    // U_DEMO_2 carries no seeded host_impact_stats row, so it initializes at
    // REPUTATION_POLICY.baseScore (100) - U_DEMO_1's fixture score (96) would
    // make the arithmetic below depend on an unrelated seed value.
    // Push the score down first so the ceiling-clamp cannot mask the cap.
    await mockDb.recordReputationEvent({
      userId: U_DEMO_2, rideId: 'r_cap_setup', sourceModule: 'm2',
      sourceEventId: 'setup:no_show', type: 'no_show', role: 'traveller', delta: -10
    });
    let summary = await mockDb.getReputationSummary(U_DEMO_2);
    expect(summary.score).toBe(90);

    await mockDb.recordReputationEvent({
      userId: U_DEMO_2, rideId: 'r_cap', sourceModule: 'm2',
      sourceEventId: 'r_cap:completed', type: 'ride_completed', role: 'traveller', delta: 1
    });
    await mockDb.recordReputationEvent({
      userId: U_DEMO_2, rideId: 'r_cap', sourceModule: 'm2',
      sourceEventId: 'r_cap:check-in', type: 'on_time_check_in', role: 'traveller', delta: 1
    });
    // Requests +2 (a 5-star review) but only +1 of headroom remains under the
    // +3 cap (1 + 1 already applied on this ride) - the cap must trim it,
    // not reject it outright.
    await mockDb.recordReputationEvent({
      userId: U_DEMO_2, rideId: 'r_cap', sourceModule: 'm1',
      sourceEventId: 'r_cap:review', type: 'review_5_star', role: 'traveller', delta: 2
    });

    summary = await mockDb.getReputationSummary(U_DEMO_2);
    expect(summary.score).toBe(93); // 90 + 1 + 1 + 1 (capped), never 94
  });

  it('never applies the same source event twice (idempotent ledger)', async () => {
    const event = {
      userId: U_DEMO_2, rideId: 'r_dup', sourceModule: 'm2',
      sourceEventId: 'r_dup:no_show', type: 'no_show', role: 'traveller', delta: -10
    };
    await mockDb.recordReputationEvent(event);
    await mockDb.recordReputationEvent(event); // same identity - must be a no-op
    await mockDb.recordReputationEvent(event);

    const summary = await mockDb.getReputationSummary(U_DEMO_2);
    expect(summary.score).toBe(90); // one -10, not three
  });

  it('clamps the ledger to 0-100 regardless of how large a single delta is', async () => {
    await mockDb.recordReputationEvent({
      userId: U_DEMO_1, rideId: null, sourceModule: 'm2',
      sourceEventId: 'extreme:negative', type: 'no_show', role: 'traveller', delta: -500
    });
    let summary = await mockDb.getReputationSummary(U_DEMO_1);
    expect(summary.score).toBe(0);

    await mockDb.recordReputationEvent({
      userId: U_DEMO_1, rideId: 'r_over', sourceModule: 'm2',
      sourceEventId: 'r_over:review', type: 'review_5_star', role: 'traveller', delta: 200
    });
    summary = await mockDb.getReputationSummary(U_DEMO_1);
    expect(summary.score).toBeLessThanOrEqual(100);
  });

  describe('identity verification overdue (105_m1)', () => {
    it('lists every seeded member with zero identity_verifications row, oldest signup first', async () => {
      const rows = await mockDb.adminListUnverifiedMembers();
      const ids = rows.map((row) => row.userId);
      expect(ids).toContain(U_DEMO_1);
      expect(ids).toContain(U_DEMO_2);
      // u_demo_2 signed up 2026-01-01, before u_demo_1's 2026-02-10.
      expect(ids.indexOf(U_DEMO_2)).toBeLessThan(ids.indexOf(U_DEMO_1));
    });

    it('excludes a member as soon as they have any identity_verifications row, even pending', async () => {
      await mockDb.submitIdentityVerification(U_DEMO_1, {
        file: { type: 'image/jpeg', size: 1024 }, icNumber: '990101145678', mode: 'passenger', documentType: 'mykad'
      });
      const rows = await mockDb.adminListUnverifiedMembers();
      expect(rows.map((row) => row.userId)).not.toContain(U_DEMO_1);
    });

    it('applies a -5, non-holding penalty and keeps the member on the unverified list', async () => {
      const before = await mockDb.getReputationSummary(U_DEMO_1);
      await mockDb.adminApplyIdentityOverduePenalty(U_DEMO_1);
      const after = await mockDb.getReputationSummary(U_DEMO_1);

      expect(after.score).toBe(before.score - 5);
      expect(after.hold).toBe(false);
      // Applying the penalty is not the same action as submitting a document -
      // the member stays on the "Not verified" tab until they actually submit.
      const rows = await mockDb.adminListUnverifiedMembers();
      expect(rows.map((row) => row.userId)).toContain(U_DEMO_1);
    });

    it('applies the penalty at most once per calendar day, however many times it is triggered', async () => {
      // U_DEMO_2 again, for the same unseeded-starting-score reason as above.
      await mockDb.adminApplyIdentityOverduePenalty(U_DEMO_2);
      await mockDb.adminApplyIdentityOverduePenalty(U_DEMO_2);
      await mockDb.adminApplyIdentityOverduePenalty(U_DEMO_2);

      const summary = await mockDb.getReputationSummary(U_DEMO_2);
      expect(summary.score).toBe(95); // one -5, not three
    });
  });

  describe('admin conduct review (106_m1)', () => {
    it('applies a first confirmed Minor case at face value and reports no hold', async () => {
      const applied = await mockDb.adminApplyConductOutcome(U_DEMO_2, 'confirmed_minor_conduct', 'Confirmed rudeness, both accounts corroborate.');
      expect(applied).toBe(true);

      const summary = await mockDb.getReputationSummary(U_DEMO_2);
      expect(summary.score).toBe(92); // 100 - 8
      expect(summary.hold).toBe(false);

      const adminSummary = await mockDb.adminGetReputationSummary(U_DEMO_2);
      expect(adminSummary.hold).toBe(false);
      expect(adminSummary.conductEvents).toHaveLength(1);
      expect(adminSummary.conductEvents[0]).toMatchObject({ type: 'confirmed_minor_conduct', delta: -8 });
    });

    it('escalates a repeat confirmed case exactly like private.apply_conduct_outcome, not at face value', async () => {
      // Two prior confirmed Minor cases already on record.
      await mockDb.adminApplyConductOutcome(U_DEMO_2, 'confirmed_minor_conduct', 'First lapse.');
      await mockDb.adminApplyConductOutcome(U_DEMO_2, 'confirmed_minor_conduct', 'Second lapse.');
      // A reviewer requests Minor again for the 3rd case - the store must
      // record it as Moderate instead, exactly as the SQL function would.
      await mockDb.adminApplyConductOutcome(U_DEMO_2, 'confirmed_minor_conduct', 'Third lapse within 90 days.');

      const adminSummary = await mockDb.adminGetReputationSummary(U_DEMO_2);
      expect(adminSummary.conductEvents[0]).toMatchObject({ type: 'confirmed_moderate_conduct', delta: -14 });
      const summary = await mockDb.getReputationSummary(U_DEMO_2);
      expect(summary.score).toBe(100 - 8 - 8 - 14);
    });

    it('automatically holds the account on a Serious confirmed case and blocks nothing else about the score', async () => {
      await mockDb.adminApplyConductOutcome(U_DEMO_2, 'confirmed_serious_conduct', 'Confirmed unsafe driving.');
      const summary = await mockDb.getReputationSummary(U_DEMO_2);
      expect(summary.score).toBe(80); // 100 - 20
      expect(summary.hold).toBe(true);
    });

    it('lets an admin clear a hold without inserting a compensating score event', async () => {
      await mockDb.adminApplyConductOutcome(U_DEMO_2, 'confirmed_serious_conduct', 'Confirmed unsafe driving.');
      await mockDb.adminClearReputationHold(U_DEMO_2);

      const summary = await mockDb.getReputationSummary(U_DEMO_2);
      expect(summary.hold).toBe(false);
      expect(summary.score).toBe(80); // the -20 stands; clearing a hold is not an appeal reversal
    });

    it('keeps two separate same-day confirmed cases distinct instead of collapsing them into one', async () => {
      await mockDb.adminApplyConductOutcome(U_DEMO_2, 'confirmed_minor_conduct', 'Incident A.');
      await mockDb.adminApplyConductOutcome(U_DEMO_2, 'confirmed_minor_conduct', 'Incident B.');

      const adminSummary = await mockDb.adminGetReputationSummary(U_DEMO_2);
      expect(adminSummary.conductEvents).toHaveLength(2);
      const summary = await mockDb.getReputationSummary(U_DEMO_2);
      expect(summary.score).toBe(84); // 100 - 8 - 8, neither call swallowed by the other
    });
  });

  describe('safety report queue (107_m1)', () => {
    it('rejects a self-report, an empty reason, and a report against a member who does not exist', async () => {
      await expect(mockDb.submitSafetyReport(U_DEMO_1, U_DEMO_1, 'Reporting myself')).rejects.toThrow(/cannot report yourself/i);
      await expect(mockDb.submitSafetyReport(U_DEMO_1, U_DEMO_2, '   ')).rejects.toThrow(/reason is required/i);
      await expect(mockDb.submitSafetyReport(U_DEMO_1, 'not_a_real_user', 'Rude behaviour')).rejects.toThrow(/could not be found/i);
    });

    it('lists a submitted report as open, oldest first, with reporter/reported names resolved', async () => {
      await mockDb.submitSafetyReport(U_DEMO_1, U_DEMO_2, 'Was rude and aggressive during the ride.');
      const open = await mockDb.adminListSafetyReports('open');

      expect(open).toHaveLength(1);
      expect(open[0]).toMatchObject({
        reporterId: U_DEMO_1,
        reportedUserId: U_DEMO_2,
        status: 'open',
        reason: 'Was rude and aggressive during the ride.'
      });
      expect(open[0].reporterName).toBeTruthy();
      expect(open[0].reportedName).toBeTruthy();
    });

    it('blocks a second open report from the same reporter against the same member', async () => {
      await mockDb.submitSafetyReport(U_DEMO_1, U_DEMO_2, 'First incident.');
      await expect(mockDb.submitSafetyReport(U_DEMO_1, U_DEMO_2, 'Second incident.')).rejects.toThrow(/already have an open report/i);

      const open = await mockDb.adminListSafetyReports('open');
      expect(open).toHaveLength(1);
    });

    it('allows a fresh report once the earlier one against the same member is resolved', async () => {
      const firstId = await mockDb.submitSafetyReport(U_DEMO_1, U_DEMO_2, 'First incident.');
      await mockDb.adminResolveSafetyReport(firstId, 'dismissed', 'No evidence found.');

      await expect(mockDb.submitSafetyReport(U_DEMO_1, U_DEMO_2, 'Second, unrelated incident.')).resolves.toBeTruthy();
      const open = await mockDb.adminListSafetyReports('open');
      expect(open).toHaveLength(1);
      expect(open[0].reason).toBe('Second, unrelated incident.');
    });

    it('resolving or dismissing a report never applies a reputation event on its own', async () => {
      const before = await mockDb.getReputationSummary(U_DEMO_2);
      const id = await mockDb.submitSafetyReport(U_DEMO_1, U_DEMO_2, 'Suspicious behaviour.');
      await mockDb.adminResolveSafetyReport(id, 'resolved', 'Handled via a confirmed Trust Case separately.');

      const after = await mockDb.getReputationSummary(U_DEMO_2);
      expect(after.score).toBe(before.score);

      const open = await mockDb.adminListSafetyReports('open');
      expect(open).toHaveLength(0);
      const resolved = await mockDb.adminListSafetyReports('resolved');
      expect(resolved).toHaveLength(1);
      expect(resolved[0].resolutionNote).toBe('Handled via a confirmed Trust Case separately.');
    });

    it('rejects resolving a report that is not open', async () => {
      const id = await mockDb.submitSafetyReport(U_DEMO_1, U_DEMO_2, 'Suspicious behaviour.');
      await mockDb.adminResolveSafetyReport(id, 'dismissed');
      await expect(mockDb.adminResolveSafetyReport(id, 'resolved')).rejects.toThrow(/no longer open/i);
    });
  });
});
