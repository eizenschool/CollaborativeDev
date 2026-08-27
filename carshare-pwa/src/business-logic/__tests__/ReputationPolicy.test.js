import { describe, expect, it } from 'vitest';
import {
  calculateReputationScore,
  cancellationReputationEvent,
  getRideEligibility,
  reputationStanding,
  reviewReputationDelta
} from '../ReputationPolicy.js';

describe('Module 1 reputation policy', () => {
  it('does not award points for ordinary login activity', () => {
    expect(calculateReputationScore([{ type: 'daily_login', delta: 2 }])).toBe(70);
  });

  it('balances verified positive and negative ride outcomes', () => {
    expect(calculateReputationScore([
      { type: 'ride_completed', delta: 1 },
      { type: 'review_5_star', delta: 2 },
      { type: 'no_show', delta: -10 }
    ])).toBe(63);
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
    expect(getRideEligibility({ score: 60, evidenceCount: 3 }, 'host').eligible).toBe(false);
    expect(getRideEligibility({ score: 60, evidenceCount: 3 }, 'traveller').eligible).toBe(true);
  });

  it('lets a confirmed safety hold override a high score', () => {
    const eligibility = getRideEligibility({ score: 95, evidenceCount: 20, hold: true }, 'host');
    expect(eligibility.eligible).toBe(false);
    expect(reputationStanding(95, { hold: true }).label).toBe('Safety hold');
  });
});
