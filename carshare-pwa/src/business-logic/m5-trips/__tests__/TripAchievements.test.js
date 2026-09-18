import { describe, expect, it } from 'vitest';
import { evaluateAchievements, longestMonthlyStreak, summariseForAchievements } from '../TripAchievements.js';

// Shaped like a TripHistoryEngine history card, which is the only input.
function trip({ role = 'Host', carbon = 0, distance = 0, seatsTotal = 4, seatsAvailable = 4, date = '2026-08-10' } = {}) {
  return { role, carbonSavedKg: carbon, distanceKm: distance, seatsTotal, seatsAvailable, date };
}

describe('Module 5 milestone summary', () => {
  it('credits passengers to the host only', () => {
    const summary = summariseForAchievements([
      trip({ role: 'Host', seatsTotal: 4, seatsAvailable: 1 }),
      trip({ role: 'Passenger', seatsTotal: 4, seatsAvailable: 0 })
    ]);
    expect(summary.passengersCarried).toBe(3);
    expect(summary.hostedTrips).toBe(1);
    expect(summary.trips).toBe(2);
  });

  it('remembers the fullest car and the longest single trip', () => {
    const summary = summariseForAchievements([
      trip({ seatsTotal: 4, seatsAvailable: 2, distance: 18 }),
      trip({ seatsTotal: 4, seatsAvailable: 0, distance: 340 })
    ]);
    expect(summary.fullestCar).toBe(4);
    expect(summary.longestTripKm).toBe(340);
  });
});

describe('Module 5 monthly streak', () => {
  it('counts consecutive months, not the total spread', () => {
    expect(longestMonthlyStreak([
      trip({ date: '2026-01-04' }), trip({ date: '2026-02-19' }), trip({ date: '2026-03-02' }),
      trip({ date: '2026-09-01' })
    ])).toBe(3);
  });

  it('does not double count two trips in the same month', () => {
    expect(longestMonthlyStreak([trip({ date: '2026-08-01' }), trip({ date: '2026-08-28' })])).toBe(1);
  });

  it('carries a streak across a year boundary', () => {
    expect(longestMonthlyStreak([trip({ date: '2025-12-30' }), trip({ date: '2026-01-03' })])).toBe(2);
  });

  it('is zero with no completed trips', () => {
    expect(longestMonthlyStreak([])).toBe(0);
  });
});

describe('Module 5 milestones', () => {
  it('locks everything and still reports progress with no trips', () => {
    const result = evaluateAchievements([]);
    expect(result.earnedCount).toBe(0);
    expect(result.milestones).toHaveLength(result.total);
    // A locked wall must still describe itself, not render blank.
    expect(result.milestones.every((m) => m.target > 0 && m.ratio === 0)).toBe(true);
    expect(result.nextUp).toBeTruthy();
  });

  it('earns the first-trip milestone on a single completed trip', () => {
    const result = evaluateAchievements([trip({ carbon: 2.2, distance: 18, seatsAvailable: 3 })]);
    const first = result.milestones.find((m) => m.id === 'first-trip');
    expect(first.earned).toBe(true);
    expect(result.earnedCount).toBe(1);
  });

  it('earns carbon tiers cumulatively', () => {
    const result = evaluateAchievements([trip({ carbon: 60, distance: 340, seatsAvailable: 3 })]);
    const byId = Object.fromEntries(result.milestones.map((m) => [m.id, m]));
    expect(byId['carbon-10'].earned).toBe(true);
    expect(byId['carbon-50'].earned).toBe(true);
    expect(byId['carbon-200'].earned).toBe(false);
    expect(byId['carbon-200'].ratio).toBeCloseTo(0.3, 5);
  });

  it('names the closest locked milestone as the next goal', () => {
    // 9 of 10 kg is nearer than any other target.
    const result = evaluateAchievements([trip({ carbon: 9, distance: 18, seatsAvailable: 3 })]);
    expect(result.nextUp.id).toBe('carbon-10');
  });

  it('never reports progress above its target', () => {
    const result = evaluateAchievements([trip({ carbon: 9999, distance: 9999, seatsAvailable: 0 })]);
    expect(result.milestones.every((m) => m.ratio <= 1)).toBe(true);
  });
});

describe('Module 5 milestone labels', () => {
  it('does not pluralise unit symbols', () => {
    const { milestones } = evaluateAchievements([]);
    const byId = Object.fromEntries(milestones.map((m) => [m.id, m]));
    expect(byId['carbon-50'].targetLabel).toBe('kg');
    expect(byId['distance-500'].targetLabel).toBe('km');
  });

  it('pluralises counted things, but not when the target is one', () => {
    const { milestones } = evaluateAchievements([]);
    const byId = Object.fromEntries(milestones.map((m) => [m.id, m]));
    expect(byId['full-car'].targetLabel).toBe('seats');
    expect(byId['passengers-10'].targetLabel).toBe('passengers');
    expect(byId['first-trip'].targetLabel).toBe('trip');
  });
});
