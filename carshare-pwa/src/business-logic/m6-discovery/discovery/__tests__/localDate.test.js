// The timezone trap, on the other side of the meridian.
//
// SeasonalCalendar.js already avoids Date entirely for window boundaries. The
// screens still built their default travel date from toISOString(), which reads
// the UTC calendar - so east of Greenwich the early hours report yesterday.

import { describe, expect, it } from 'vitest';
import { todayIso } from '../localDate.js';

describe('todayIso', () => {
  it('formats as YYYY-MM-DD', () => {
    expect(todayIso(new Date(2026, 7, 14, 12, 0))).toBe('2026-08-14');
  });

  it('pads single-digit months and days', () => {
    expect(todayIso(new Date(2026, 0, 5, 12, 0))).toBe('2026-01-05');
  });

  // The regression. A local Date of 00:48 on the 14th is 16:48 UTC on the 13th
  // at UTC+8, so toISOString() reported the 13th and every screen opened before
  // 08:00 defaulted to a travel date already in the past.
  it('reports the local day just after midnight, not the UTC one', () => {
    expect(todayIso(new Date(2026, 7, 14, 0, 48))).toBe('2026-08-14');
  });

  it('holds at the last minute of the day', () => {
    expect(todayIso(new Date(2026, 7, 14, 23, 59))).toBe('2026-08-14');
  });

  it('rolls the month over on its last day', () => {
    expect(todayIso(new Date(2026, 10, 30, 23, 59))).toBe('2026-11-30');
    expect(todayIso(new Date(2026, 11, 1, 0, 1))).toBe('2026-12-01');
  });

  it('handles a leap day', () => {
    expect(todayIso(new Date(2028, 1, 29, 0, 30))).toBe('2028-02-29');
  });
});
