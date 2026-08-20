import { describe, expect, it } from 'vitest';
import { groupHistoryByMonth, summariseHistory } from '../TripHistoryEngine.js';

function trip(overrides = {}) {
  return {
    id: 't1', role: 'Host', status: 'Completed', date: '2026-08-10',
    carbonSavedKg: 0, ...overrides
  };
}

describe('Module 5 history summary', () => {
  it('reads zero for an empty history rather than failing', () => {
    expect(summariseHistory([])).toEqual({
      total: 0, hosted: 0, joined: 0, completed: 0, carbonSavedKg: 0, byStatus: {}
    });
    expect(summariseHistory()).toMatchObject({ total: 0 });
  });

  it('splits hosted from joined', () => {
    const s = summariseHistory([
      trip({ role: 'Host' }), trip({ role: 'Host' }), trip({ role: 'Passenger' })
    ]);
    expect(s).toMatchObject({ total: 3, hosted: 2, joined: 1 });
  });

  it('counts each status for its filter chip', () => {
    const s = summariseHistory([
      trip({ status: 'Completed' }), trip({ status: 'Completed' }),
      trip({ status: 'Expired' }), trip({ status: 'Draft' })
    ]);
    expect(s.byStatus).toEqual({ Completed: 2, Expired: 1, Draft: 1 });
    expect(s.completed).toBe(2);
  });

  it('only totals carbon from completed trips', () => {
    // An expired ride carries no carbon, and must not be added even if a stale
    // value were present on the card.
    const s = summariseHistory([
      trip({ status: 'Completed', carbonSavedKg: 40.8 }),
      trip({ status: 'Completed', carbonSavedKg: 2.2 }),
      trip({ status: 'Expired', carbonSavedKg: 99 })
    ]);
    expect(s.carbonSavedKg).toBe(43);
  });
});

describe('Module 5 history month grouping', () => {
  it('groups nothing into nothing', () => {
    expect(groupHistoryByMonth([])).toEqual([]);
  });

  it('puts the newest month first and keeps trips inside it', () => {
    const groups = groupHistoryByMonth([
      trip({ id: 'a', date: '2026-08-20' }),
      trip({ id: 'b', date: '2026-07-02' }),
      trip({ id: 'c', date: '2026-08-05' })
    ]);
    expect(groups.map((g) => g.label)).toEqual(['August 2026', 'July 2026']);
    expect(groups[0].trips.map((t) => t.id)).toEqual(['a', 'c']);
    expect(groups[1].trips.map((t) => t.id)).toEqual(['b']);
  });

  it('orders across a year boundary by date, not by month number', () => {
    const groups = groupHistoryByMonth([
      trip({ date: '2025-12-30' }), trip({ date: '2026-01-03' })
    ]);
    expect(groups.map((g) => g.label)).toEqual(['January 2026', 'December 2025']);
  });

  it('reports a zero-indexed month alongside the label', () => {
    const [group] = groupHistoryByMonth([trip({ date: '2026-08-10' })]);
    expect(group).toMatchObject({ year: 2026, month: 7, key: '2026-08' });
  });
});

// The stepper's month arithmetic is pure and worth pinning: an off-by-one at a
// year boundary is invisible until December.
import { shiftMonth } from '../../presentation/components/trip/MonthStepper.jsx';

describe('Module 5 month stepper arithmetic', () => {
  it('steps within a year', () => {
    expect(shiftMonth(2026, 7, -1)).toEqual({ year: 2026, month: 6 });
    expect(shiftMonth(2026, 7, 1)).toEqual({ year: 2026, month: 8 });
  });

  it('rolls backwards across the new year', () => {
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
  });

  it('rolls forwards across the new year', () => {
    expect(shiftMonth(2025, 11, 1)).toEqual({ year: 2026, month: 0 });
  });

  it('survives a jump of more than a year', () => {
    expect(shiftMonth(2026, 5, -18)).toEqual({ year: 2024, month: 11 });
  });
});
