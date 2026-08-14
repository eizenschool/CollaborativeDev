// UC6.11 / FR-6.22 / FR-6.23 - weather as a gate on the candidate set.
//
// Every case uses literal forecast objects. `fetchForecasts` is exercised with an
// injected fetch stub, so the suite makes zero real network calls in line with
// the project rule that automated tests never hit a third-party service.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyWeatherGate,
  classifyForecast,
  fetchForecasts,
  isOutdoorCategory,
  __clearForecastCache,
  WEATHER
} from '../WeatherGate.js';
import { CATEGORY } from '../constants.js';

const place = (id, category) => ({ id, category, lat: 3.1, lng: 101.6 });
const forecast = (weatherCode, summary = 'test') => ({ weatherCode, summary });

describe('isOutdoorCategory', () => {
  it('treats nature and events as weather-exposed', () => {
    expect(isOutdoorCategory(CATEGORY.NATURE)).toBe(true);
    expect(isOutdoorCategory(CATEGORY.EVENT)).toBe(true);
  });

  it('treats culinary and heritage as sheltered', () => {
    expect(isOutdoorCategory(CATEGORY.CULINARY)).toBe(false);
    expect(isOutdoorCategory(CATEGORY.HERITAGE)).toBe(false);
  });
});

describe('classifyForecast', () => {
  it('classifies thunderstorm-with-hail codes as severe', () => {
    expect(classifyForecast(forecast(96))).toBe(WEATHER.SEVERE);
    expect(classifyForecast(forecast(99))).toBe(WEATHER.SEVERE);
    expect(classifyForecast(forecast(82))).toBe(WEATHER.SEVERE);
  });

  it('classifies heavy rain and fog as advisory', () => {
    expect(classifyForecast(forecast(65))).toBe(WEATHER.ADVISORY);
    expect(classifyForecast(forecast(45))).toBe(WEATHER.ADVISORY);
    expect(classifyForecast(forecast(80))).toBe(WEATHER.ADVISORY);
  });

  it('classifies clear-sky codes as clear', () => {
    expect(classifyForecast(forecast(0))).toBe(WEATHER.CLEAR);
    expect(classifyForecast(forecast(1))).toBe(WEATHER.CLEAR);
  });

  // Absent information is not evidence of good weather. UNKNOWN keeps the
  // distinction so the gate can decline to apply rather than assuming fine.
  it('classifies a missing or unusable forecast as unknown, never clear', () => {
    expect(classifyForecast(undefined)).toBe(WEATHER.UNKNOWN);
    expect(classifyForecast({})).toBe(WEATHER.UNKNOWN);
    expect(classifyForecast(forecast('sunny'))).toBe(WEATHER.UNKNOWN);
  });
});

describe('applyWeatherGate - UC6.11 A2: severe warning on an outdoor candidate', () => {
  it('withholds the outdoor candidate entirely', () => {
    const { candidates, withheld } = applyWeatherGate(
      [place('p_park', CATEGORY.NATURE)],
      new Map([['p_park', forecast(99, 'Thunderstorm with hail')]])
    );

    expect(candidates).toHaveLength(0);
    expect(withheld).toHaveLength(1);
    expect(withheld[0].weather).toBe(WEATHER.SEVERE);
    expect(withheld[0].weatherReason).toBe('Thunderstorm with hail');
  });

  // The destination may be indoors but the journey there is not, so the user is
  // still told - just not prevented.
  it('keeps an indoor candidate under the same warning, with an advisory', () => {
    const { candidates, withheld } = applyWeatherGate(
      [place('p_museum', CATEGORY.HERITAGE)],
      new Map([['p_museum', forecast(99)]])
    );

    expect(withheld).toHaveLength(0);
    expect(candidates[0].weather).toBe(WEATHER.ADVISORY);
    expect(candidates[0].weatherAdvisory).toBeTruthy();
  });
});

describe('applyWeatherGate - UC6.11 A3: adverse but non-severe', () => {
  it('keeps the candidate and attaches an advisory', () => {
    const { candidates, withheld } = applyWeatherGate(
      [place('p_hill', CATEGORY.NATURE)],
      new Map([['p_hill', forecast(65, 'Heavy rain expected')]])
    );

    expect(withheld).toHaveLength(0);
    expect(candidates[0].weather).toBe(WEATHER.ADVISORY);
    expect(candidates[0].weatherAdvisory).toBe('Heavy rain expected');
  });

  it('attaches no advisory in clear conditions', () => {
    const { candidates } = applyWeatherGate(
      [place('p_hill', CATEGORY.NATURE)],
      new Map([['p_hill', forecast(0)]])
    );

    expect(candidates[0].weather).toBe(WEATHER.CLEAR);
    expect(candidates[0].weatherAdvisory).toBeNull();
  });
});

describe('applyWeatherGate - UC6.11 A1: no forecast available', () => {
  // The important one. A forecast outage must not silently empty the outdoor half
  // of the catalogue, and must not silently mark everything safe either.
  it('applies no constraint at all when forecasts are missing', () => {
    const candidates = [
      place('p_park', CATEGORY.NATURE),
      place('p_museum', CATEGORY.HERITAGE)
    ];
    const result = applyWeatherGate(candidates, new Map());

    expect(result.withheld).toHaveLength(0);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.every((c) => c.weather === WEATHER.UNKNOWN)).toBe(true);
    expect(result.candidates.every((c) => c.weatherAdvisory === null)).toBe(true);
  });

  it('survives an empty candidate set', () => {
    expect(applyWeatherGate([], new Map())).toEqual({ candidates: [], withheld: [] });
  });

  it('accepts a plain object as well as a Map', () => {
    const { candidates } = applyWeatherGate(
      [place('p_park', CATEGORY.NATURE)],
      { p_park: forecast(65) }
    );
    expect(candidates[0].weather).toBe(WEATHER.ADVISORY);
  });
});

describe('applyWeatherGate - mixed sets', () => {
  it('withholds only the severe outdoor candidates', () => {
    const { candidates, withheld } = applyWeatherGate(
      [
        place('p_park', CATEGORY.NATURE),
        place('p_food', CATEGORY.CULINARY),
        place('p_fest', CATEGORY.EVENT)
      ],
      new Map([
        ['p_park', forecast(99)],
        ['p_food', forecast(0)],
        ['p_fest', forecast(65)]
      ])
    );

    expect(withheld.map((c) => c.id)).toEqual(['p_park']);
    expect(candidates.map((c) => c.id)).toEqual(['p_food', 'p_fest']);
  });
});

describe('fetchForecasts', () => {
  beforeEach(() => __clearForecastCache());

  it('requests nothing when no candidate is weather-exposed', async () => {
    const fetchImpl = vi.fn();
    const result = await fetchForecasts([place('p_food', CATEGORY.CULINARY)], '2026-08-20', { fetchImpl });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.size).toBe(0);
  });

  it('requests one forecast per outdoor candidate', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ daily: { weather_code: [65] } })
    });

    const result = await fetchForecasts(
      [place('p_park', CATEGORY.NATURE), place('p_food', CATEGORY.CULINARY)],
      '2026-08-20',
      { fetchImpl }
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.get('p_park').weatherCode).toBe(65);
  });

  // One request for the whole set, not one per place. Fetching them separately
  // cost six seconds of network time before the home screen could paint.
  it('asks for every outdoor candidate in a single request', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ([
        { daily: { weather_code: [0] } },
        { daily: { weather_code: [65] } },
        { daily: { weather_code: [99] } }
      ])
    });

    const result = await fetchForecasts([
      { id: 'p_a', category: CATEGORY.NATURE, lat: 1, lng: 101 },
      { id: 'p_b', category: CATEGORY.NATURE, lat: 2, lng: 102 },
      { id: 'p_c', category: CATEGORY.EVENT, lat: 3, lng: 103 }
    ], '2026-08-20', { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.size).toBe(3);
    expect(result.get('p_c').weatherCode).toBe(99);

    // Coordinates go in the order the places did, so the response array lines up.
    const url = fetchImpl.mock.calls[0][0];
    expect(url).toContain('latitude=1,2,3');
    expect(url).toContain('longitude=101,102,103');
  });

  it('serves a repeat request for the same date from cache', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ daily: { weather_code: [65] } })
    });
    const places = [place('p_park', CATEGORY.NATURE)];

    await fetchForecasts(places, '2026-08-20', { fetchImpl });
    const second = await fetchForecasts(places, '2026-08-20', { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(second.get('p_park').weatherCode).toBe(65);
  });

  it('does not reuse one date\'s forecast for another', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ daily: { weather_code: [0] } })
    });
    const places = [place('p_park', CATEGORY.NATURE)];

    await fetchForecasts(places, '2026-08-20', { fetchImpl });
    await fetchForecasts(places, '2026-08-21', { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('asks only for the places it does not already hold', async () => {
    const first = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ daily: { weather_code: [0] } })
    });
    await fetchForecasts([place('p_a', CATEGORY.NATURE)], '2026-08-20', { fetchImpl: first });

    const second = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ daily: { weather_code: [65] } })
    });
    const result = await fetchForecasts([
      place('p_a', CATEGORY.NATURE),
      { id: 'p_b', category: CATEGORY.NATURE, lat: 9, lng: 109 }
    ], '2026-08-20', { fetchImpl: second });

    expect(second.mock.calls[0][0]).toContain('latitude=9');
    expect(second.mock.calls[0][0]).not.toContain('latitude=3.1,9');
    expect(result.size).toBe(2);
  });

  // Degrading to "no constraint" is the correct failure mode: the gate then does
  // not apply, rather than the discovery view failing to render.
  it('returns an empty map when the service errors', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    const result = await fetchForecasts([place('p_park', CATEGORY.NATURE)], '2026-08-20', { fetchImpl });
    expect(result.size).toBe(0);
  });

  it('returns an empty map on a non-ok response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false });
    const result = await fetchForecasts([place('p_park', CATEGORY.NATURE)], '2026-08-20', { fetchImpl });
    expect(result.size).toBe(0);
  });

  it('requests nothing without a travel date', async () => {
    const fetchImpl = vi.fn();
    await fetchForecasts([place('p_park', CATEGORY.NATURE)], null, { fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
