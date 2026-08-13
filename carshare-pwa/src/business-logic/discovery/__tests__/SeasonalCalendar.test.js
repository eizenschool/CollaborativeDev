// FR-6.24 - seasonal alignment. Boundary Value Analysis on every window edge,
// because a season is defined entirely by where its edges fall.
//
// The wrapping window (November to February) and the leap day get their own
// blocks: both are cases where the obvious implementation is wrong in a way that
// a mid-window test would never reveal.

import { describe, expect, it } from 'vitest';
import {
  isWithinAnnualWindow,
  isWithinEvent,
  resolveSeason,
  SEASON,
  SEASONAL_WINDOWS
} from '../SeasonalCalendar.js';
import { CATEGORY, SEASON_VALUES } from '../constants.js';

const place = (over = {}) => ({
  id: 'p_test', state: 'Selangor', category: CATEGORY.NATURE, ...over
});

describe('isWithinAnnualWindow - BVA on a normal window (Jun 1 - Aug 31)', () => {
  const from = [6, 1];
  const to = [8, 31];

  it('excludes the day before the start', () => {
    expect(isWithinAnnualWindow('2026-05-31', from, to)).toBe(false);
  });

  it('includes the start day', () => {
    expect(isWithinAnnualWindow('2026-06-01', from, to)).toBe(true);
  });

  it('includes the day after the start', () => {
    expect(isWithinAnnualWindow('2026-06-02', from, to)).toBe(true);
  });

  it('includes the day before the end', () => {
    expect(isWithinAnnualWindow('2026-08-30', from, to)).toBe(true);
  });

  it('includes the end day', () => {
    expect(isWithinAnnualWindow('2026-08-31', from, to)).toBe(true);
  });

  it('excludes the day after the end', () => {
    expect(isWithinAnnualWindow('2026-09-01', from, to)).toBe(false);
  });

  it('excludes a date on the far side of the year', () => {
    expect(isWithinAnnualWindow('2026-01-15', from, to)).toBe(false);
  });
});

describe('isWithinAnnualWindow - BVA on a wrapping window (Nov 1 - Feb 29)', () => {
  const from = [11, 1];
  const to = [2, 29];

  it('excludes the day before the start', () => {
    expect(isWithinAnnualWindow('2026-10-31', from, to)).toBe(false);
  });

  it('includes the start day', () => {
    expect(isWithinAnnualWindow('2026-11-01', from, to)).toBe(true);
  });

  // The case a naive start <= date <= end comparison gets exactly backwards.
  it('includes December, on the near side of the year boundary', () => {
    expect(isWithinAnnualWindow('2026-12-15', from, to)).toBe(true);
  });

  it('includes January, on the far side of the year boundary', () => {
    expect(isWithinAnnualWindow('2027-01-15', from, to)).toBe(true);
  });

  it('includes the end day', () => {
    expect(isWithinAnnualWindow('2027-02-28', from, to)).toBe(true);
  });

  it('excludes the day after the end', () => {
    expect(isWithinAnnualWindow('2027-03-01', from, to)).toBe(false);
  });

  it('excludes a mid-year date', () => {
    expect(isWithinAnnualWindow('2026-07-01', from, to)).toBe(false);
  });
});

describe('isWithinAnnualWindow - the leap day', () => {
  // The monsoon does not stop early because February is short, so the window is
  // declared to the 29th. In a common year that date never arrives and the 28th
  // is still the last day inside.
  it('includes 29 February in a leap year', () => {
    expect(isWithinAnnualWindow('2028-02-29', [11, 1], [2, 29])).toBe(true);
  });

  it('still includes 28 February in a common year', () => {
    expect(isWithinAnnualWindow('2027-02-28', [11, 1], [2, 29])).toBe(true);
  });

  it('excludes 29 February from a window that ends on the 28th', () => {
    expect(isWithinAnnualWindow('2028-02-29', [11, 1], [2, 28])).toBe(false);
  });
});

describe('isWithinAnnualWindow - malformed input', () => {
  it('returns false rather than throwing', () => {
    expect(isWithinAnnualWindow('', [6, 1], [8, 31])).toBe(false);
    expect(isWithinAnnualWindow(undefined, [6, 1], [8, 31])).toBe(false);
    expect(isWithinAnnualWindow('15/06/2026', [6, 1], [8, 31])).toBe(false);
    expect(isWithinAnnualWindow('2026-06-15', null, [8, 31])).toBe(false);
  });
});

describe('isWithinEvent', () => {
  const event = { name: 'Test Festival', start: '2026-07-10', end: '2026-07-12' };

  it('excludes the day before', () => {
    expect(isWithinEvent('2026-07-09', event)).toBe(false);
  });

  it('includes the first day', () => {
    expect(isWithinEvent('2026-07-10', event)).toBe(true);
  });

  it('includes the last day', () => {
    expect(isWithinEvent('2026-07-12', event)).toBe(true);
  });

  it('excludes the day after', () => {
    expect(isWithinEvent('2026-07-13', event)).toBe(false);
  });

  it('distinguishes the same dates in a different year', () => {
    expect(isWithinEvent('2027-07-11', event)).toBe(false);
  });

  it('returns false where no event is registered', () => {
    expect(isWithinEvent('2026-07-11', null)).toBe(false);
    expect(isWithinEvent('2026-07-11', {})).toBe(false);
  });
});

describe('resolveSeason - the three outcomes', () => {
  it('scores an undeclared place at the neutral value, not a penalty', () => {
    const result = resolveSeason(place({ id: 'p_unknown', category: CATEGORY.HERITAGE }), '2026-03-15');
    expect(result.value).toBe(SEASON_VALUES.UNDECLARED);
    expect(result.state).toBe(SEASON.UNDECLARED);
  });

  it('scores an aligned window at full value', () => {
    const result = resolveSeason(place({ id: 'p_cameron', state: 'Pahang' }), '2026-07-15');
    expect(result.value).toBe(SEASON_VALUES.ALIGNED);
    expect(result.state).toBe(SEASON.ALIGNED);
    expect(result.label).toBe('Highland dry months');
  });

  it('scores a declared off-season at the reduced value', () => {
    const result = resolveSeason(
      place({ id: 'p_beach', state: 'Terengganu', category: CATEGORY.NATURE }),
      '2026-12-20'
    );
    expect(result.value).toBe(SEASON_VALUES.OFF_SEASON);
    expect(result.state).toBe(SEASON.OFF);
    expect(result.label).toBe('North-east monsoon');
  });

  it('always returns a reason the score breakdown can show', () => {
    for (const date of ['2026-01-15', '2026-07-15', '2026-12-20']) {
      const result = resolveSeason(place({ state: 'Terengganu' }), date);
      expect(result.label).toBeTruthy();
      expect(result.note).toBeTruthy();
    }
  });
});

describe('resolveSeason - specificity', () => {
  // A rule about one place beats a rule about its whole state, which is what
  // stops a broad regional window flattening every destination inside it.
  it('lets a place rule beat a state rule', () => {
    const guaTempurung = place({ id: 'p_gua_tempurung', state: 'Perak', category: CATEGORY.NATURE });
    const result = resolveSeason(guaTempurung, '2026-12-15');

    expect(result.label).toBe('Cave flood risk');
    expect(result.state).toBe(SEASON.OFF);
  });

  it('does not apply a state rule to a state it does not name', () => {
    const selangorPark = place({ id: 'p_other', state: 'Selangor', category: CATEGORY.NATURE });
    expect(resolveSeason(selangorPark, '2026-12-15').state).toBe(SEASON.UNDECLARED);
  });

  it('does not apply a category rule to a different category', () => {
    const heritage = place({ id: 'p_other', state: 'Penang', category: CATEGORY.HERITAGE });
    expect(resolveSeason(heritage, '2026-07-15').state).toBe(SEASON.UNDECLARED);
  });

  it('applies a category-only rule nationally', () => {
    const food = place({ id: 'p_food', state: 'Johor', category: CATEGORY.CULINARY });
    expect(resolveSeason(food, '2026-07-15').label).toBe('Durian season');
  });

  // A monsoon window is scoped to states AND categories, so it must not catch a
  // culinary place in the same state.
  it('requires both scopes to match on a two-scope rule', () => {
    const pahangFood = place({ id: 'p_x', state: 'Pahang', category: CATEGORY.CULINARY });
    expect(resolveSeason(pahangFood, '2026-12-15').state).not.toBe(SEASON.OFF);
  });
});

describe('resolveSeason - registered VM2026 events', () => {
  const festival = place({
    id: 'p_fest',
    state: 'Sarawak',
    category: CATEGORY.EVENT,
    vm2026Event: { name: 'Rainforest World Music Festival 2026', start: '2026-07-10', end: '2026-07-12' }
  });

  it('aligns a date inside the event window', () => {
    const result = resolveSeason(festival, '2026-07-11');
    expect(result.value).toBe(SEASON_VALUES.ALIGNED);
    expect(result.label).toBe('Rainforest World Music Festival 2026');
  });

  // A festival in July should not lift a trip planned for March.
  it('does not align a date outside the event window', () => {
    expect(resolveSeason(festival, '2026-03-11').value).not.toBe(SEASON_VALUES.ALIGNED);
  });

  // An event is a commitment on specific dates; the weather that usually applies
  // to that month does not make it less worth travelling for.
  it('outranks a calendar off-season covering the same date', () => {
    const monsoonFestival = place({
      id: 'p_fest2',
      state: 'Terengganu',
      category: CATEGORY.EVENT,
      vm2026Event: { name: 'Monsoon Cup', start: '2026-11-20', end: '2026-11-24' }
    });

    expect(resolveSeason(monsoonFestival, '2026-11-22').value).toBe(SEASON_VALUES.ALIGNED);
    // The same place outside its event falls back to the monsoon window.
    expect(resolveSeason(monsoonFestival, '2026-12-05').value).toBe(SEASON_VALUES.OFF_SEASON);
  });
});

describe('the declared calendar itself', () => {
  it('gives every window a label, a note and a valid kind', () => {
    for (const window of SEASONAL_WINDOWS) {
      expect(window.label).toBeTruthy();
      expect(window.note).toBeTruthy();
      expect([SEASON.ALIGNED, SEASON.OFF]).toContain(window.kind);
    }
  });

  it('gives every window a usable month/day range', () => {
    for (const window of SEASONAL_WINDOWS) {
      for (const [month, day] of [window.from, window.to]) {
        expect(month).toBeGreaterThanOrEqual(1);
        expect(month).toBeLessThanOrEqual(12);
        expect(day).toBeGreaterThanOrEqual(1);
        expect(day).toBeLessThanOrEqual(31);
      }
    }
  });

  it('scopes every window to at least one of place, state or category', () => {
    for (const window of SEASONAL_WINDOWS) {
      const scoped = window.places?.length || window.states?.length || window.categories?.length;
      expect(scoped).toBeTruthy();
    }
  });

  it('keeps every resolved value inside the 0-1 scale the engine expects', () => {
    const dates = ['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15', '2026-12-15'];
    const places = [
      place({ id: 'p_cameron', state: 'Pahang' }),
      place({ id: 'p_sekinchan', state: 'Selangor' }),
      place({ id: 'p_gua_tempurung', state: 'Perak' }),
      place({ id: 'p_food', state: 'Penang', category: CATEGORY.CULINARY })
    ];

    for (const p of places) {
      for (const date of dates) {
        const { value } = resolveSeason(p, date);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });
});
