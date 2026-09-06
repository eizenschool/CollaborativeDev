// The demonstration affordance for the weather gate.
//
// The assertion that matters most is that an override never reaches the network
// and never changes a rule: what gets demonstrated has to be the real gate, or
// the demonstration proves nothing.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dateForMonth,
  getWeatherOverride,
  getWeatherOverrideCode,
  isDemoActive,
  resetDemo,
  setWeatherOverride,
  WEATHER_OVERRIDES
} from '../DiscoveryDemoControls.js';
import { applyWeatherGate, fetchForecasts, WEATHER } from '../WeatherGate.js';
import { CATEGORY } from '../constants.js';

const place = (id, category) => ({ id, category, lat: 3.1, lng: 101.6 });

afterEach(() => resetDemo());

describe('weather override state', () => {
  it('starts inactive so ordinary use is never simulated', () => {
    expect(isDemoActive()).toBe(false);
    expect(getWeatherOverride()).toBeNull();
  });

  it('accepts each documented mode', () => {
    for (const mode of WEATHER_OVERRIDES) {
      setWeatherOverride(mode);
      expect(getWeatherOverride()).toBe(mode);
      expect(Number.isFinite(getWeatherOverrideCode())).toBe(true);
    }
  });

  it('ignores a mode it does not recognise rather than half-enabling', () => {
    setWeatherOverride('apocalypse');
    expect(getWeatherOverride()).toBeNull();
    expect(isDemoActive()).toBe(false);
  });

  it('clears on reset', () => {
    setWeatherOverride('severe');
    resetDemo();
    expect(isDemoActive()).toBe(false);
    expect(getWeatherOverrideCode()).toBeNull();
  });
});

describe('fetchForecasts under an override', () => {
  // The whole point: simulating weather must cost nothing and work offline.
  it('makes no network request at all', async () => {
    setWeatherOverride('severe');
    const fetchImpl = vi.fn();

    const result = await fetchForecasts([place('p_park', CATEGORY.NATURE)], '2026-08-20', { fetchImpl });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.get('p_park').weatherCode).toBe(99);
  });

  it('applies to every outdoor candidate and no indoor one', async () => {
    setWeatherOverride('advisory');
    const result = await fetchForecasts([
      place('p_park', CATEGORY.NATURE),
      place('p_fest', CATEGORY.EVENT),
      place('p_food', CATEGORY.CULINARY)
    ], '2026-08-20', { fetchImpl: vi.fn() });

    expect([...result.keys()].sort()).toEqual(['p_fest', 'p_park']);
  });

  it('marks the summary as simulated so it cannot be mistaken for a forecast', async () => {
    setWeatherOverride('severe');
    const result = await fetchForecasts([place('p_park', CATEGORY.NATURE)], '2026-08-20', { fetchImpl: vi.fn() });
    expect(result.get('p_park').summary).toMatch(/simulated/i);
  });
});

describe('the gate behaves identically on simulated input', () => {
  // applyWeatherGate is never told the forecast was simulated, so the rule being
  // demonstrated is the same one that runs in production.
  it('withholds outdoor candidates on a simulated severe warning', async () => {
    setWeatherOverride('severe');
    const candidates = [place('p_park', CATEGORY.NATURE), place('p_food', CATEGORY.CULINARY)];
    const forecasts = await fetchForecasts(candidates, '2026-08-20', { fetchImpl: vi.fn() });

    const { candidates: kept, withheld } = applyWeatherGate(candidates, forecasts);

    expect(withheld.map((c) => c.id)).toEqual(['p_park']);
    // The indoor candidate is untouched and carries UNKNOWN, not an advisory:
    // no forecast is ever requested for a place that cannot be withheld on
    // weather, so nothing was checked and the gate says so rather than implying
    // it found clear skies.
    expect(kept.find((c) => c.id === 'p_food').weather).toBe(WEATHER.UNKNOWN);
  });

  it('keeps outdoor candidates with an advisory on simulated heavy rain', async () => {
    setWeatherOverride('advisory');
    const candidates = [place('p_park', CATEGORY.NATURE)];
    const forecasts = await fetchForecasts(candidates, '2026-08-20', { fetchImpl: vi.fn() });

    const { candidates: kept, withheld } = applyWeatherGate(candidates, forecasts);

    expect(withheld).toHaveLength(0);
    expect(kept[0].weather).toBe(WEATHER.ADVISORY);
    expect(kept[0].weatherAdvisory).toMatch(/simulated/i);
  });

  it('raises nothing at all on simulated clear weather', async () => {
    setWeatherOverride('clear');
    const candidates = [place('p_park', CATEGORY.NATURE)];
    const forecasts = await fetchForecasts(candidates, '2026-08-20', { fetchImpl: vi.fn() });

    const { candidates: kept } = applyWeatherGate(candidates, forecasts);
    expect(kept[0].weather).toBe(WEATHER.CLEAR);
    expect(kept[0].weatherAdvisory).toBeNull();
  });
});

describe('dateForMonth', () => {
  const june2026 = new Date(2026, 5, 20); // 20 June 2026

  it('lands mid-month, clear of every window boundary', () => {
    expect(dateForMonth(7, june2026)).toBe('2026-07-15');
  });

  it('stays in this year for a month still ahead', () => {
    expect(dateForMonth(12, june2026)).toBe('2026-12-15');
  });

  // A travel date in the past is not something the rest of the module should
  // have to reason about.
  it('rolls to next year for a month already gone', () => {
    expect(dateForMonth(2, june2026)).toBe('2027-02-15');
  });

  it('treats the current month as still ahead', () => {
    expect(dateForMonth(6, june2026)).toBe('2026-06-15');
  });

  it('pads single-digit months', () => {
    expect(dateForMonth(9, june2026)).toBe('2026-09-15');
  });
});
