import { describe, expect, it } from 'vitest';
import {
  calculateReputationScore,
  cancellationReputationEvent,
  conductEscalationCounts,
  describeConductSeverity,
  describeReputationEvent,
  getRideEligibility,
  REPUTATION_EVENT_DELTAS,
  REPUTATION_POLICY,
  reputationEvidenceCount,
  resolveConductSeverity,
  reputationStanding,
  reviewReputationDelta
} from '../ReputationPolicy.js';

describe('Module 1 reputation policy', () => {
  it('does not award points for ordinary login activity', () => {
    expect(calculateReputationScore([{ type: 'daily_login', delta: 2 }])).toBe(100);
  });

  it('balances verified positive and negative ride outcomes', () => {
    expect(calculateReputationScore([
      { type: 'ride_completed', delta: 1 },
      { type: 'review_5_star', delta: 2 },
      { type: 'no_show', delta: -10 }
    ])).toBe(90);
  });

  it('does not bank positive credit earned at the 100 ceiling', () => {
    const goodThenBad = calculateReputationScore([
      { type: 'ride_completed', delta: 1 },
      { type: 'review_5_star', delta: 2 },
      { type: 'no_show', delta: -10 }
    ]);
    const badOnly = calculateReputationScore([{ type: 'no_show', delta: -10 }]);
    expect(goodThenBad).toBe(badOnly);
    expect(calculateReputationScore([{ type: 'review_5_star', delta: 2 }])).toBe(100);
  });

  it('lets positive outcomes restore standing that was actually lost', () => {
    expect(calculateReputationScore([
      { type: 'no_show', delta: -10 },
      { type: 'ride_completed', delta: 1 },
      { type: 'review_5_star', delta: 2 }
    ])).toBe(93);
  });

  it('maps review ratings to deliberately asymmetric trust changes', () => {
    expect([1, 2, 3, 4, 5].map(reviewReputationDelta)).toEqual([-6, -3, 0, 1, 2]);
  });

  it('uses cancellation timing and role in the event reason', () => {
    const departure = '2026-08-28T12:00:00.000Z';
    expect(cancellationReputationEvent('host', departure, '2026-08-27T10:00:00.000Z')).toBe('host_cancelled_early');
    expect(cancellationReputationEvent('traveller', departure, '2026-08-28T08:00:00.000Z')).toBe('traveller_cancelled_very_late');
  });

  it('classifies every cancellation timing bracket for both roles', () => {
    const departure = '2026-08-28T12:00:00.000Z';
    // >24h before -> early, 6-24h before -> late, <6h before -> very late.
    expect(cancellationReputationEvent('host', departure, '2026-08-26T11:00:00.000Z')).toBe('host_cancelled_early');
    expect(cancellationReputationEvent('host', departure, '2026-08-28T00:00:00.000Z')).toBe('host_cancelled_late');
    expect(cancellationReputationEvent('host', departure, '2026-08-28T10:00:00.000Z')).toBe('host_cancelled_very_late');
    expect(cancellationReputationEvent('traveller', departure, '2026-08-26T11:00:00.000Z')).toBe('traveller_cancelled_early');
    expect(cancellationReputationEvent('traveller', departure, '2026-08-28T00:00:00.000Z')).toBe('traveller_cancelled_late');
    expect(cancellationReputationEvent('traveller', departure, '2026-08-28T10:00:00.000Z')).toBe('traveller_cancelled_very_late');
  });

  it('holds every automatic event to its documented delta value', () => {
    expect(REPUTATION_EVENT_DELTAS).toMatchObject({
      ride_completed: 1,
      on_time_check_in: 1,
      host_cancelled_early: -1,
      host_cancelled_late: -3,
      host_cancelled_very_late: -6,
      traveller_cancelled_early: -1,
      traveller_cancelled_late: -3,
      traveller_cancelled_very_late: -6,
      no_show: -10
    });
  });

  it('computes evidence as the greater of distinct ride ids or completed trips', () => {
    expect(reputationEvidenceCount([], 0)).toBe(0);
    expect(reputationEvidenceCount([{ rideId: 'r1' }, { rideId: 'r1' }, { rideId: 'r2' }], 0)).toBe(2);
    expect(reputationEvidenceCount([{ rideId: 'r1' }], 5)).toBe(5);
  });

  it('allows provisional members but applies a higher Driver threshold afterwards', () => {
    expect(getRideEligibility({ score: 40, evidenceCount: 2 }, 'host').eligible).toBe(true);
    expect(getRideEligibility({ score: 85, evidenceCount: 3 }, 'host').eligible).toBe(false);
    expect(getRideEligibility({ score: 85, evidenceCount: 3 }, 'traveller').eligible).toBe(true);
    expect(getRideEligibility({ score: 90, evidenceCount: 3 }, 'host').eligible).toBe(true);
    expect(getRideEligibility({ score: 74, evidenceCount: 3 }, 'traveller').eligible).toBe(false);
  });

  it('aligns every tier boundary with a capability boundary', () => {
    expect(reputationStanding(100).label).toBe('Trusted');
    expect(reputationStanding(REPUTATION_POLICY.hostMinimum).label).toBe('Standard');
    expect(reputationStanding(REPUTATION_POLICY.hostMinimum - 1).label).toBe('Limited');
    expect(reputationStanding(REPUTATION_POLICY.travellerMinimum).label).toBe('Limited');
    expect(reputationStanding(REPUTATION_POLICY.travellerMinimum - 1).label).toBe('Restricted');
  });

  it('lets a confirmed safety hold override a high score', () => {
    const eligibility = getRideEligibility({ score: 95, evidenceCount: 20, hold: true }, 'host');
    expect(eligibility.eligible).toBe(false);
    expect(reputationStanding(95, { hold: true }).label).toBe('Safety hold');
  });

  describe('graduated conduct severity (104_m1)', () => {
    it('gives each tier a distinct delta instead of only two values', () => {
      expect(describeConductSeverity('confirmed_minor_conduct').delta).toBe(-8);
      expect(describeConductSeverity('confirmed_moderate_conduct').delta).toBe(-14);
      expect(describeConductSeverity('confirmed_serious_conduct').delta).toBe(-20);
      expect(describeConductSeverity('confirmed_severe_conduct').delta).toBe(-30);
    });

    it('only holds ride actions automatically from Major upward', () => {
      expect(describeConductSeverity('confirmed_minor_conduct').hold).toBe(false);
      expect(describeConductSeverity('confirmed_moderate_conduct').hold).toBe(false);
      expect(describeConductSeverity('confirmed_serious_conduct').hold).toBe(true);
      expect(describeConductSeverity('confirmed_severe_conduct').hold).toBe(true);
    });

    it('applies a first confirmed minor case at face value', () => {
      const outcome = resolveConductSeverity('confirmed_minor_conduct', { confirmed_minor_conduct: 0 });
      expect(outcome).toMatchObject({ effectiveType: 'confirmed_minor_conduct', delta: -8, hold: false, escalated: false });
    });

    it('escalates the 3rd confirmed minor case within its window to Moderate', () => {
      const secondCase = resolveConductSeverity('confirmed_minor_conduct', { confirmed_minor_conduct: 1 });
      expect(secondCase.escalated).toBe(false);
      const thirdCase = resolveConductSeverity('confirmed_minor_conduct', { confirmed_minor_conduct: 2 });
      expect(thirdCase).toMatchObject({ effectiveType: 'confirmed_moderate_conduct', delta: -14, hold: false, escalated: true, requestedType: 'confirmed_minor_conduct' });
    });

    it('escalates the 2nd confirmed moderate case within its window to Major, with a hold', () => {
      const outcome = resolveConductSeverity('confirmed_moderate_conduct', { confirmed_moderate_conduct: 1 });
      expect(outcome).toMatchObject({ effectiveType: 'confirmed_serious_conduct', delta: -20, hold: true, escalated: true });
    });

    it('escalates a repeat confirmed Major case to Severe', () => {
      const outcome = resolveConductSeverity('confirmed_serious_conduct', { confirmed_serious_conduct: 1 });
      expect(outcome).toMatchObject({ effectiveType: 'confirmed_severe_conduct', delta: -30, hold: true, escalated: true });
    });

    it('never escalates Severe further - it is the ceiling', () => {
      const outcome = resolveConductSeverity('confirmed_severe_conduct', { confirmed_severe_conduct: 50 });
      expect(outcome).toMatchObject({ effectiveType: 'confirmed_severe_conduct', delta: -30, escalated: false });
    });

    it('rejects an unknown severity key rather than silently applying no penalty', () => {
      expect(() => describeConductSeverity('confirmed_extreme_conduct')).toThrow();
    });
  });

  describe('conductEscalationCounts (106_m1 admin reviewer preview)', () => {
    const now = new Date('2026-09-14T00:00:00.000Z');

    it('counts only same-tier prior events inside that tier\'s own window', () => {
      const events = [
        { type: 'confirmed_minor_conduct', createdAt: '2026-08-20T00:00:00.000Z' }, // 25 days ago - inside 90
        { type: 'confirmed_minor_conduct', createdAt: '2026-05-01T00:00:00.000Z' }, // >90 days ago - outside
        { type: 'confirmed_moderate_conduct', createdAt: '2026-08-01T00:00:00.000Z' } // different tier entirely
      ];
      expect(conductEscalationCounts(events, now)).toMatchObject({ confirmed_minor_conduct: 1 });
    });

    it('counts every prior Serious event ever for the Serious -> Severe window (null = unbounded)', () => {
      const events = [
        { type: 'confirmed_serious_conduct', createdAt: '2020-01-01T00:00:00.000Z' },
        { type: 'confirmed_serious_conduct', createdAt: '2026-09-01T00:00:00.000Z' }
      ];
      expect(conductEscalationCounts(events, now).confirmed_serious_conduct).toBe(2);
    });

    it('feeds resolveConductSeverity to reproduce the exact SQL escalation a reviewer will get', () => {
      const events = [
        { type: 'confirmed_minor_conduct', createdAt: '2026-09-01T00:00:00.000Z' },
        { type: 'confirmed_minor_conduct', createdAt: '2026-09-05T00:00:00.000Z' }
      ];
      const outcome = resolveConductSeverity('confirmed_minor_conduct', conductEscalationCounts(events, now));
      expect(outcome).toMatchObject({ effectiveType: 'confirmed_moderate_conduct', delta: -14, escalated: true });
    });
  });

  describe('identity verification overdue penalty (105_m1)', () => {
    it('is a lighter, non-holding deduction distinct from confirmed conduct', () => {
      expect(REPUTATION_EVENT_DELTAS.identity_verification_overdue).toBe(-5);
      expect(REPUTATION_EVENT_DELTAS.identity_verification_overdue)
        .toBeGreaterThan(REPUTATION_EVENT_DELTAS.confirmed_minor_conduct);
    });

    it('describes the event for the member-facing ledger', () => {
      expect(describeReputationEvent('identity_verification_overdue')).toBe('Identity verification overdue since signup');
    });

    it('still only fires through the deliberate manual admin action, never automatically', () => {
      expect(calculateReputationScore([{ type: 'identity_verification_overdue', delta: -5 }])).toBe(95);
    });
  });
});
