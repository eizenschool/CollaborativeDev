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

    // An indoor candidate under a severe warning still gets the advisory: the
    // journey there is outdoors even when the destination is not.
    const weather = verdict === WEATHER.SEVERE ? WEATHER.ADVISORY : verdict;
    kept.push({
      ...candidate,
      weather,
      weatherAdvisory: weather === WEATHER.ADVISORY ? (forecast?.summary || 'Adverse conditions expected') : null
    });
  }

  return { candidates: kept, withheld };
}

/**
 * Retrieves a daily forecast per place. Returns an empty Map on any failure, so
 * the gate degrades to "no constraint" rather than taking the view down.
 *
 * One request per distinct coordinate, and only for outdoor candidates - an
 * indoor destination cannot be withheld on weather, so its forecast would be
 * fetched and then ignored.
 */
export async function fetchForecasts(places = [], travelDate, { fetchImpl = globalThis.fetch } = {}) {
  const outdoor = places.filter((p) => isOutdoorCategory(p.category));
  if (!outdoor.length || !travelDate || typeof fetchImpl !== 'function') return new Map();

  const results = await Promise.all(outdoor.map(async (place) => {
    try {
      const url = `${OPEN_METEO_URL}?latitude=${place.lat}&longitude=${place.lng}`
        + `&daily=weather_code&start_date=${travelDate}&end_date=${travelDate}&timezone=Asia%2FKuala_Lumpur`;
      const response = await fetchImpl(url);
      if (!response?.ok) return null;

      const body = await response.json();
      const weatherCode = body?.daily?.weather_code?.[0];
      if (weatherCode === undefined || weatherCode === null) return null;

      return [place.id, { weatherCode, summary: describeCode(weatherCode) }];
    } catch {
      return null;
    }
  }));

  return new Map(results.filter(Boolean));
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
  fetchForecasts
};
