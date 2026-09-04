import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEFAULT_MALAYSIA_CITY, FORECAST_HORIZON_DAYS, fetchGuideForecast, geocodeMalaysianPlace, malaysiaToday,
  matchMalaysianCityInText, MAX_FORECAST_SPAN_DAYS, resolveForecastWindow, resolveMalaysianCity,
  weatherSeverity, wmoConditionKey
} from '../weather.ts';

afterEach(() => vi.useRealTimers());

describe('Tumpang Guide deterministic weather (get_weather_forecast)', () => {
  it('classifies WMO codes into the same clear/advisory/severe boundaries the old retrieval.ts sets used', () => {
    expect(weatherSeverity(0)).toBe('clear');
    expect(weatherSeverity(61)).toBe('clear');
    for (const code of [45, 48, 63, 65, 73, 75, 80, 81, 95]) expect(weatherSeverity(code)).toBe('advisory');
    for (const code of [57, 67, 82, 96, 99]) expect(weatherSeverity(code)).toBe('severe');
  });

  it('maps every WMO code family to a distinct condition key', () => {
    expect(wmoConditionKey(0)).toBe('clear');
    expect(wmoConditionKey(61)).toBe('rain');
    expect(wmoConditionKey(65)).toBe('heavy_rain');
    expect(wmoConditionKey(80)).toBe('showers');
    expect(wmoConditionKey(82)).toBe('violent_showers');
    expect(wmoConditionKey(95)).toBe('thunderstorm');
    expect(wmoConditionKey(99)).toBe('thunderstorm_hail');
  });

  it('returns the Malaysia-local date, not the UTC date, near the day boundary', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-03T17:30:00Z'));
    expect(malaysiaToday()).toBe('2026-09-04');
    vi.setSystemTime(new Date('2026-09-03T10:00:00Z'));
    expect(malaysiaToday()).toBe('2026-09-03');
  });

  it('assumes today..+2 days when no date is given, and flags it', () => {
    const window = resolveForecastWindow('', '', null, null, '2026-09-03');
    expect(window).toMatchObject({ startDate: '2026-09-03', endDate: '2026-09-05', datesWereAssumed: true, entirelyBeyondHorizon: false });
  });

  it('falls back to the Travel Brief dates when the model gave none', () => {
    const window = resolveForecastWindow('', '', '2026-09-05', '2026-09-06', '2026-09-03');
    expect(window).toMatchObject({ startDate: '2026-09-05', endDate: '2026-09-06', datesWereAssumed: false });
  });

  it('clamps a past start date up to today', () => {
    const window = resolveForecastWindow('2026-08-01', '2026-08-02', null, null, '2026-09-03');
    expect(window).toMatchObject({ startDate: '2026-09-03', clampedFromPast: true });
  });

  it(`clamps the end date to today+${FORECAST_HORIZON_DAYS - 1} when it runs past the forecast horizon (start chosen close enough to the horizon that the 7-day span cap does not also bind)`, () => {
    const window = resolveForecastWindow('2026-09-15', '2026-10-01', null, null, '2026-09-03');
    expect(window).toMatchObject({ startDate: '2026-09-15', endDate: '2026-09-18', clampedToHorizon: true, entirelyBeyondHorizon: false });
  });

  it('never calls Open-Meteo when the entire requested range is beyond the forecast horizon', () => {
    const window = resolveForecastWindow('2026-10-01', '2026-10-05', null, null, '2026-09-03');
    expect(window.entirelyBeyondHorizon).toBe(true);
  });

  it(`caps the span at ${MAX_FORECAST_SPAN_DAYS} days, matching sanitizePlanState's own cap`, () => {
    const window = resolveForecastWindow('2026-09-03', '2026-09-20', null, null, '2026-09-03');
    expect(window.endDate).toBe('2026-09-09');
  });

  it('builds the Open-Meteo request with every field the answer needs and normalizes a single-coordinate object response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        daily: {
          time: ['2026-09-05', '2026-09-06'],
          weather_code: [80, 61],
          precipitation_probability_max: [70, 30],
          precipitation_sum: [12.5, 2],
          precipitation_hours: [4, 1],
          temperature_2m_max: [32, 33],
          temperature_2m_min: [25, 24],
          apparent_temperature_max: [36, 35]
        }
      })
    });
    const forecast = await fetchGuideForecast({
      latitude: 3.139, longitude: 101.6869, locationName: 'Kuala Lumpur',
      startDate: '2026-09-05', endDate: '2026-09-06', fetchImpl
    });
    const url = new URL(fetchImpl.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe('https://api.open-meteo.com/v1/forecast');
    expect(url.searchParams.get('daily')).toBe(
      'weather_code,precipitation_probability_max,precipitation_sum,precipitation_hours,temperature_2m_max,temperature_2m_min,apparent_temperature_max'
    );
    expect(url.searchParams.get('timezone')).toBe('Asia/Kuala_Lumpur');
    expect(url.searchParams.get('start_date')).toBe('2026-09-05');
    expect(url.searchParams.get('end_date')).toBe('2026-09-06');
    expect(forecast.days).toHaveLength(2);
    expect(forecast.days[0]).toMatchObject({
      date: '2026-09-05', weatherCode: 80, conditionKey: 'showers', severity: 'advisory',
      precipitationProbabilityMax: 70, temperatureMaxC: 32, apparentTemperatureMaxC: 36
    });
  });

  it('normalizes an array-of-one Open-Meteo response the same way', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ([{
        daily: { time: ['2026-09-05'], weather_code: [0], precipitation_probability_max: [5],
          precipitation_sum: [0], precipitation_hours: [0], temperature_2m_max: [34], temperature_2m_min: [26], apparent_temperature_max: [37] }
      }])
    });
    const forecast = await fetchGuideForecast({
      latitude: 3.139, longitude: 101.6869, locationName: 'Kuala Lumpur',
      startDate: '2026-09-05', endDate: '2026-09-05', fetchImpl
    });
    expect(forecast.days[0]).toMatchObject({ date: '2026-09-05', conditionKey: 'clear', severity: 'clear' });
  });

  it('throws on an HTTP failure instead of silently returning an empty forecast', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    await expect(fetchGuideForecast({
      latitude: 3.139, longitude: 101.6869, locationName: 'Kuala Lumpur',
      startDate: '2026-09-05', endDate: '2026-09-05', fetchImpl
    })).rejects.toThrow();
  });

  it('throws when the request aborts on timeout', async () => {
    const fetchImpl = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    await expect(fetchGuideForecast({
      latitude: 3.139, longitude: 101.6869, locationName: 'Kuala Lumpur',
      startDate: '2026-09-05', endDate: '2026-09-05', fetchImpl, timeoutMs: 5
    })).rejects.toThrow();
  });
});

describe('Tumpang Guide free Malaysia city/state lookup (regression: "Melaka"/"Penang" used to have no way to resolve at all - a named city that just wasn\'t a specific catalogue attraction fell straight through to whatever default existed, which was either "ask again forever" or, worse, silently substituting an unrelated origin)', () => {
  it('resolves major cities by their common English name, case-insensitively and with surrounding whitespace', () => {
    expect(resolveMalaysianCity('Melaka')).toMatchObject({ name: 'Malacca City', state: 'Malacca' });
    expect(resolveMalaysianCity('  penang  ')).toMatchObject({ name: 'George Town', state: 'Penang' });
    expect(resolveMalaysianCity('JOHOR BAHRU')).toMatchObject({ name: 'Johor Bahru', state: 'Johor' });
  });

  it('resolves the exact real-world Chinese names that were logged failing to match the catalogue', () => {
    expect(resolveMalaysianCity('马六甲')).toMatchObject({ name: 'Malacca City' });
    expect(resolveMalaysianCity('馬六甲')).toMatchObject({ name: 'Malacca City' });
  });

  it('resolves a landmark the routing prompt is asked to normalise down to its city (KLCC -> Kuala Lumpur)', () => {
    expect(resolveMalaysianCity('KLCC')).toMatchObject({ name: 'Kuala Lumpur', state: 'Kuala Lumpur' });
    expect(resolveMalaysianCity('kl')).toMatchObject({ name: 'Kuala Lumpur' });
  });

  it('returns null for empty input and for a place it genuinely does not recognise, never a wrong guess', () => {
    expect(resolveMalaysianCity('')).toBeNull();
    expect(resolveMalaysianCity('   ')).toBeNull();
    expect(resolveMalaysianCity('Timbuktu')).toBeNull();
  });

  it('every major city resolves to coordinates that actually fall within Malaysia', () => {
    for (const name of ['Kuala Lumpur', 'George Town', 'Johor Bahru', 'Malacca City', 'Ipoh', 'Kota Kinabalu', 'Kuching']) {
      const resolved = resolveMalaysianCity(name.toLowerCase());
      expect(resolved).not.toBeNull();
      expect(resolved.lat).toBeGreaterThan(0.5);
      expect(resolved.lat).toBeLessThan(7.5);
      expect(resolved.lng).toBeGreaterThan(99);
      expect(resolved.lng).toBeLessThan(120);
    }
    // DEFAULT_MALAYSIA_CITY must itself be a real, resolvable entry - it is
    // the last-resort fallback when nothing else is known at all.
    expect(DEFAULT_MALAYSIA_CITY.name).toBe('Kuala Lumpur');
    expect(resolveMalaysianCity(DEFAULT_MALAYSIA_CITY.name.toLowerCase())).toMatchObject({ name: DEFAULT_MALAYSIA_CITY.name });
  });

  it('matches a city named inside a longer phrase, which exact resolution cannot', () => {
    expect(matchMalaysianCityInText('melaka city centre')).toMatchObject({ name: 'Malacca City' });
    expect(matchMalaysianCityInText('somewhere around KL')).toMatchObject({ name: 'Kuala Lumpur' });
    expect(matchMalaysianCityInText('明天馬六甲的天氣')).toMatchObject({ name: 'Malacca City' });
  });

  it('prefers the longest matching alias so a two-letter alias never claims a phrase that names the city in full', () => {
    // "kuala lumpur" contains no standalone "kl", but "kota kinabalu" would
    // be claimed by "kk" if aliases were tried shortest-first in a table
    // where a longer alias also matches.
    expect(matchMalaysianCityInText('kota kinabalu waterfront')).toMatchObject({ name: 'Kota Kinabalu' });
    expect(matchMalaysianCityInText('kuala lumpur')).toMatchObject({ name: 'Kuala Lumpur' });
  });

  it('never matches a Latin alias inside a longer word - "Klang" is not KL, "Jbeil" is not Johor Bahru', () => {
    expect(matchMalaysianCityInText('Klang')).toBeNull();
    expect(matchMalaysianCityInText('Jbeil')).toBeNull();
    expect(matchMalaysianCityInText('Timbuktu')).toBeNull();
    expect(matchMalaysianCityInText('')).toBeNull();
  });

  it('no alias is shared between two different cities - a shared alias would make resolution ambiguous and silently pick whichever city happens to be listed first', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../weather.ts'), 'utf8');
    const tableSource = source.slice(source.indexOf('const MALAYSIA_CITIES'), source.indexOf('function normaliseCityQuery'));
    const aliasArrays = [...tableSource.matchAll(/aliases:\s*\[([^\]]+)\]/g)].map((match) =>
      match[1].split(',').map((entry) => entry.trim().replace(/^"|"$/g, '')).filter(Boolean));
    const seen = new Set();
    for (const aliases of aliasArrays) {
      for (const alias of aliases) {
        expect(seen.has(alias)).toBe(false);
        seen.add(alias);
      }
    }
    expect(aliasArrays.length).toBeGreaterThanOrEqual(15);
  });
});

describe("Tumpang Guide free town-level geocoding (Open-Meteo's own keyless service - the tier between the fifteen hand-written cities and a paid Google lookup)", () => {
  const okResponse = (results) => ({ ok: true, status: 200, json: async () => ({ results }) });

  it('asks the keyless Open-Meteo geocoder for Malaysian results and normalizes the first usable one', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse([
      { name: 'Sungai Petani', country_code: 'MY', admin1: 'Kedah', latitude: 5.6470, longitude: 100.4870 }
    ]));
    const place = await geocodeMalaysianPlace('Sungai Petani', { fetchImpl });
    const url = new URL(fetchImpl.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe('https://geocoding-api.open-meteo.com/v1/search');
    expect(url.searchParams.get('name')).toBe('Sungai Petani');
    expect(url.searchParams.get('countryCode')).toBe('MY');
    expect(place).toMatchObject({ name: 'Sungai Petani', state: 'Kedah', lat: 5.6470, lng: 100.4870 });
  });

  it('never accepts a same-named place outside Malaysia, even when the service returns it first', () => {
    // The country filter is also sent as a query parameter, but the response
    // is what decides - a Malaysian traveller asking about "Victoria" must
    // not be given a forecast for Victoria, Australia.
    const fetchImpl = vi.fn().mockResolvedValue(okResponse([
      { name: 'Victoria', country_code: 'AU', admin1: 'Victoria', latitude: -37.0, longitude: 144.0 },
      { name: 'Victoria', country_code: 'HK', admin1: '', latitude: 22.28, longitude: 114.15 }
    ]));
    return expect(geocodeMalaysianPlace('Victoria', { fetchImpl })).resolves.toBeNull();
  });

  it('skips a result with unusable coordinates instead of producing NaN latitude', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse([
      { name: 'Broken', country_code: 'MY', latitude: null, longitude: null },
      { name: 'Taiping', country_code: 'MY', admin1: 'Perak', latitude: 4.85, longitude: 100.74 }
    ]));
    expect(await geocodeMalaysianPlace('Taiping', { fetchImpl })).toMatchObject({ name: 'Taiping', lat: 4.85 });
  });

  it('returns null - never throws - on an empty result set, an HTTP failure, malformed JSON or a timeout, because this is a resolution tier and not the answer', async () => {
    expect(await geocodeMalaysianPlace('Nowhere', { fetchImpl: vi.fn().mockResolvedValue(okResponse([])) })).toBeNull();
    expect(await geocodeMalaysianPlace('Nowhere', { fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }) })).toBeNull();
    expect(await geocodeMalaysianPlace('Nowhere', { fetchImpl: vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new Error('bad json'); } }) })).toBeNull();
    const hangs = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    expect(await geocodeMalaysianPlace('Nowhere', { fetchImpl: hangs, timeoutMs: 5 })).toBeNull();
  });

  it('never spends a network call on an empty or whitespace-only name', async () => {
    const fetchImpl = vi.fn();
    expect(await geocodeMalaysianPlace('   ', { fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
