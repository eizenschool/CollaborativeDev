import { describe, expect, it } from 'vitest';
import {
  calculateReputationScore,
  cancellationReputationEvent,
  getRideEligibility,
  REPUTATION_POLICY,
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
});
