// ===== BUSINESS LOGIC LAYER (WeatherGate) =====
// UC6.11 / FR-6.22 withhold outdoor destinations under a severe warning /
// FR-6.23 flag adverse but non-severe conditions / FR-6.38 forecast retrieval.
//
// Weather is a gate on the candidate set, not a scoring signal. A severe warning
// is not a matter of degree that a strong personal affinity should be able to
// outweigh, so it is applied *before* scoring rather than inside it.
//
// Split in two on purpose:
//   - applyWeatherGate() is pure and holds every rule, so the whole decision
//     table is unit-testable with literal inputs and zero network access.
//   - fetchForecasts() is a thin boundary that only turns coordinates into
//     forecast objects.
//
// Source is Open-Meteo: free, no API key, and therefore nothing to leak from the
// client. FR-6.38's requirement that "the service credential is never exposed to
// the client" is satisfied trivially because there is no credential. If the team
// later moves to a keyed provider, only fetchForecasts() moves server-side.

import { OUTDOOR_CATEGORIES } from './constants.js';
import { getWeatherOverrideCode } from './DiscoveryDemoControls.js';

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

// WMO weather interpretation codes, as published by Open-Meteo.
// Severe: thunderstorms with hail (96, 99), violent rain (82), heavy freezing
// rain (67, 57). These are conditions where a trip should not be recommended.
const SEVERE_CODES = new Set([57, 67, 82, 96, 99]);
// Adverse but not severe: moderate/heavy rain and showers, snow, dense fog.
// Worth a warning, not worth withholding.
const ADVERSE_CODES = new Set([45, 48, 63, 65, 73, 75, 80, 81, 95]);

export const WEATHER = {
  CLEAR: 'clear',
  ADVISORY: 'advisory',
  SEVERE: 'severe',
  UNKNOWN: 'unknown'
};

/** A place is weather-exposed when its category is enjoyed outdoors. */
export function isOutdoorCategory(category) {
  return OUTDOOR_CATEGORIES.includes(category);
}

/** Classifies one forecast. An absent or unrecognised forecast is UNKNOWN, never CLEAR. */
export function classifyForecast(forecast) {
  const code = Number(forecast?.weatherCode);
  if (!Number.isFinite(code)) return WEATHER.UNKNOWN;
  if (SEVERE_CODES.has(code)) return WEATHER.SEVERE;
  if (ADVERSE_CODES.has(code)) return WEATHER.ADVISORY;
  return WEATHER.CLEAR;
}

/**
 * Applies the gate to a candidate set.
 *
 * Returns `{ candidates, withheld }` rather than mutating: the caller still needs
 * the withheld list to explain an unexpectedly short set to the user.
 *
 * Three rules, in the order UC6.11 states them:
 *   A2 - severe warning on an outdoor candidate  -> withheld entirely
 *   A3 - adverse but non-severe                  -> kept, advisory attached
 *   A1 - no forecast available                   -> no constraint applied at all
 *
 * A1 matters more than it looks. Absent information is not evidence of good
 * weather or bad, so a forecast outage must not silently empty the outdoor half
 * of the catalogue, and must not silently mark everything safe either.
 */
export function applyWeatherGate(candidates = [], forecastsByPlaceId = new Map()) {
  const kept = [];
  const withheld = [];

  for (const candidate of candidates) {
    const forecast = forecastsByPlaceId.get?.(candidate.id) ?? forecastsByPlaceId[candidate.id];
    const verdict = classifyForecast(forecast);
    const outdoor = isOutdoorCategory(candidate.category);

    if (verdict === WEATHER.SEVERE && outdoor) {
      withheld.push({ ...candidate, weather: WEATHER.SEVERE, weatherReason: forecast?.summary || 'Severe weather warning' });
      continue;
    }

    // An indoor candidate is never withheld, but is downgraded to an advisory
    // rather than passed through as severe: the journey there is outdoors even
    // when the destination is not.
    //
    // In practice this only fires if a caller supplies a forecast for an indoor
    // place. `fetchForecasts` deliberately does not - an indoor destination
    // cannot be withheld on weather, so buying a forecast to produce a soft
    // advisory is not worth a request. Indoor candidates therefore carry
    // UNKNOWN, which is the honest answer: nothing was checked.
    const weather = verdict === WEATHER.SEVERE ? WEATHER.ADVISORY : verdict;
    kept.push({
      ...candidate,
      weather,
      weatherAdvisory: weather === WEATHER.ADVISORY ? (forecast?.summary || 'Adverse conditions expected') : null
    });
  }

  return { candidates: kept, withheld };
}

// A forecast for one place on one date does not change between two screens
// opening seconds apart, so it is held for the session. This is a weather cache,
// not a ranking cache: the scores it feeds are still recomputed on every request,
// which is what the specification actually forbids caching.
const forecastCache = new Map();
const cacheKey = (placeId, date) => `${date}::${placeId}`;

/**
 * Retrieves the daily forecast for every outdoor candidate in **one** request.
 *
 * Open-Meteo accepts comma-separated coordinates and answers with an array in
 * the same order. That matters: one request per place meant 24 calls and about
 * six seconds of network time before the home screen could paint, for data that
 * arrives in roughly 200ms when asked for together.
 *
 * Indoor candidates are never requested at all - an indoor destination cannot be
 * withheld on weather, so its forecast would be fetched and then ignored.
 *
 * Returns an empty Map on any failure, so the gate degrades to "no constraint"
 * rather than taking the view down.
 */
export async function fetchForecasts(places = [], travelDate, { fetchImpl = globalThis.fetch } = {}) {
  const outdoor = places.filter((p) => isOutdoorCategory(p.category));
  if (!outdoor.length || !travelDate) return new Map();

  // A demonstration override replaces what the forecast *says*, never what the
  // gate does with it - applyWeatherGate below cannot tell the difference, so
  // what gets demonstrated is the real rule. Short-circuits before the network,
  // so simulating weather costs nothing and works offline.
  const overrideCode = getWeatherOverrideCode();
  if (overrideCode !== null) {
    return new Map(outdoor.map((place) => [
      place.id,
      { weatherCode: overrideCode, summary: `${describeCode(overrideCode)} (simulated)` }
    ]));
  }

  if (typeof fetchImpl !== 'function') return new Map();

  const found = new Map();
  const missing = [];
  for (const place of outdoor) {
    const cached = forecastCache.get(cacheKey(place.id, travelDate));
    if (cached) found.set(place.id, cached);
    else missing.push(place);
  }

  if (missing.length === 0) return found;

  try {
    const url = `${OPEN_METEO_URL}`
      + `?latitude=${missing.map((p) => p.lat).join(',')}`
      + `&longitude=${missing.map((p) => p.lng).join(',')}`
      + `&daily=weather_code&start_date=${travelDate}&end_date=${travelDate}`
      + `&timezone=Asia%2FKuala_Lumpur`;

    const response = await fetchImpl(url);
    if (!response?.ok) return found;

    // A single coordinate returns one object; several return an array. Normalise
    // so the same code reads both.
    const body = await response.json();
    const entries = Array.isArray(body) ? body : [body];

    missing.forEach((place, index) => {
      const weatherCode = entries[index]?.daily?.weather_code?.[0];
      if (weatherCode === undefined || weatherCode === null) return;

      const forecast = { weatherCode, summary: describeCode(weatherCode) };
      forecastCache.set(cacheKey(place.id, travelDate), forecast);
      found.set(place.id, forecast);
    });

    return found;
  } catch {
    return found;
  }
}

/** Test hook, so one case's cached forecasts cannot leak into the next. */
export function __clearForecastCache() {
  forecastCache.clear();
}

function describeCode(code) {
  if (SEVERE_CODES.has(Number(code))) return 'Severe weather warning for this date';
  if (ADVERSE_CODES.has(Number(code))) return 'Rain or poor visibility expected';
  return 'Clear conditions expected';
}

export const WeatherGate = {
  WEATHER,
  isOutdoorCategory,
  classifyForecast,
  applyWeatherGate,
  fetchForecasts,
  __clearForecastCache
};
