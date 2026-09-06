import { describe, expect, it } from 'vitest';
import {
  badgeIsWithheld,
  calculateCompositeHostImpact,
  getBadgeForStats,
  HostImpactEngine
} from '../HostImpactEngine.js';
import { REPUTATION_POLICY } from '../ReputationPolicy.js';

const newAccount = { completedTrips: 0, co2SavedKg: 0, reputationScore: REPUTATION_POLICY.baseScore };

describe('Host Impact badge', () => {
  // Regression: while reputation was a term in the composite, moving the base
  // to 100 (D034) scored every new account at 100 x 0.8 = 80, which was exactly
  // the Silver threshold - a member with no completed trips was shown a Silver
  // badge and a reduced-fee perk.
  it('leaves a brand-new account at Bronze', () => {
    expect(calculateCompositeHostImpact(newAccount)).toBe(0);
    expect(getBadgeForStats(newAccount).name).toBe('Bronze Host');
  });

  it('ignores reputation when computing the composite', () => {
    const low = { completedTrips: 10, co2SavedKg: 20, reputationScore: 50 };
    const high = { completedTrips: 10, co2SavedKg: 20, reputationScore: 100 };
    expect(calculateCompositeHostImpact(low)).toBe(calculateCompositeHostImpact(high));
    expect(calculateCompositeHostImpact(high)).toBe(30);
  });

  it('awards tiers on contribution alone', () => {
    expect(getBadgeForStats({ completedTrips: 25, co2SavedKg: 0, reputationScore: 100 }).name).toBe('Silver Host');
    expect(getBadgeForStats({ completedTrips: 60, co2SavedKg: 0, reputationScore: 100 }).name).toBe('Gold Host');
    expect(getBadgeForStats({ completedTrips: 100, co2SavedKg: 0, reputationScore: 100 }).name).toBe('Platinum Host');
  });

  it('withholds every tier above Bronze below the Driver threshold', () => {
    const platinum = { completedTrips: 100, co2SavedKg: 0 };
    expect(getBadgeForStats({ ...platinum, reputationScore: REPUTATION_POLICY.hostMinimum }).name).toBe('Platinum Host');
    expect(getBadgeForStats({ ...platinum, reputationScore: REPUTATION_POLICY.hostMinimum - 1 }).name).toBe('Bronze Host');
    expect(getBadgeForStats({ ...platinum, reputationScore: 100, reputationHold: true }).name).toBe('Bronze Host');
  });

  it('never raises a tier that contribution has not earned', () => {
    expect(getBadgeForStats({ completedTrips: 1, co2SavedKg: 0, reputationScore: 100 }).name).toBe('Bronze Host');
  });

  // Let's Tumpang is non-monetary (PROJECT.md): a Ride's contribution is free
  // text, and there is no fee, fare or payment path in the codebase. A perk
  // promising a commission discount would be the only place the app claims
  // otherwise, so it must not come back.
  it('never advertises a monetary perk', () => {
    const perks = HostImpactEngine.badgeTiers.flatMap((tier) => tier.perks);
    expect(perks.length).toBeGreaterThan(0);
    perks.forEach((perk) => {
      expect(perk).not.toMatch(/fee|fare|price|payment|commission|RM\s*\d|%/i);
    });
  });

  it('treats an absent score as unknown rather than restricted', () => {
    expect(badgeIsWithheld({ completedTrips: 100 })).toBe(false);
    expect(badgeIsWithheld({ reputationScore: null })).toBe(false);
    // Ride cards default a missing stats row to 0; such a host has no trips to
    // show either, so the badge must not be reported as withheld.
    expect(badgeIsWithheld({ reputationScore: 0 })).toBe(false);
    expect(badgeIsWithheld({ reputationScore: 60 })).toBe(true);
    expect(badgeIsWithheld({ hold: true })).toBe(true);
  });
});

// 098_m1 replicates this exact formula server-side to decide whether to
// notify a host of a tier change - these assertions keep that SQL copy from
// silently drifting the way the reputation-weighted one in this project's own
// report already had, before this migration existed.
describe('Module 1 badge tier change notification SQL contract (098_m1)', () => {
  async function readSql() {
    return import('node:fs/promises').then(({ readFile }) => readFile(
      new URL('../../../../database/sql/098_m1_badge_tier_change_notification.sql', import.meta.url),
      'utf8'
    ));
  }

  it('mirrors HostImpactEngine.js\'s current (reputation-excluded) formula and thresholds', async () => {
    const sql = await readSql();
    expect(sql).toContain("p_completed_trips, 0) * 2.0 + coalesce(p_co2_saved_kg, 0) * 0.5");
    expect(sql).toContain(">= 200 then 'Platinum Host'");
    expect(sql).toContain(">= 120 then 'Gold Host'");
    expect(sql).toContain(">= 50 then 'Silver Host'");
    // The composite formula itself must never reference reputation_score -
    // only the withheld check below may.
    const formulaLine = sql.split('\n').find((line) => line.includes('* 2.0 + coalesce'));
    expect(formulaLine).not.toMatch(/reputation/i);
  });

  it('withholds above Bronze on a safety hold or a score below the host minimum (65)', async () => {
    const sql = await readSql();
    expect(sql).toContain('coalesce(p_reputation_hold, false)');
    expect(sql).toContain('p_reputation_score < 65');
    expect(sql).toContain("then 'Bronze Host'");
  });

  it('only notifies on an actual transition, never on a brand-new row', async () => {
    const sql = await readSql();
    expect(sql).toContain("tg_op = 'INSERT' or old.last_badge_tier is null");
    expect(sql).toContain('v_new_tier is distinct from old.last_badge_tier');
  });

  it('routes through the existing shared notification function, not a new table', async () => {
    const sql = await readSql();
    expect(sql).toContain('perform private.create_user_notification(');
    expect(sql).not.toMatch(/create table.*notification/i);
  });

  it('keeps the helper functions locked down like every other private.* function', async () => {
    const sql = await readSql();
    expect(sql).toMatch(/revoke all on function private\.badge_tier_for_stats\(int, numeric, int, boolean\) from public, anon, authenticated;/);
    expect(sql).toMatch(/revoke all on function private\.badge_tier_rank\(text\) from public, anon, authenticated;/);
    expect(sql).toMatch(/revoke all on function private\.notify_badge_tier_change\(\) from public, anon, authenticated;/);
  });
});
