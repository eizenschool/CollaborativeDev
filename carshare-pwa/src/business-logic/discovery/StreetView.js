// ===== BUSINESS LOGIC LAYER (StreetView) =====
// FR-6.15. Street View for a place that has no Google photograph of its own.
//
// Split the way WeatherGate.js is: metadata coverage is a thin network
// boundary, URL building is pure, and the caller decides what to render.
// Metadata is free and unmetered; the image is billed at the Street View
// Static tier. That price difference is the entire reason FR-6.15 specifies a
// metadata call before ever requesting a photograph - so this module makes
// requesting the image without checking metadata first impossible to reach
// through hasStreetViewCoverage, rather than a rule a caller has to remember.
//
// Held under its own browser-restricted key, VITE_GOOGLE_STREETVIEW_API_KEY,
// deliberately separate from Module 2's VITE_GOOGLE_MAPS_PLACES_API_KEY.
// GOOGLE-MAPS-SETUP.md records that key's boundary as excluding Street View by
// name; reusing it here would widen a cost decision Module 2 already accepted
// without Module 2's sign-off. See docs/MODULE6-API-SETUP.md §3.4.
//
// With no key configured - true today - every function here returns null or
// false immediately and no request is ever attempted. The illustration tier
// (PlacePoster.jsx) is what a caller falls back to, exactly as it already does
// when a place carries no fetchable photo reference.

const configuredApiKey = import.meta.env.VITE_GOOGLE_STREETVIEW_API_KEY?.trim() || '';

const METADATA_URL = 'https://maps.googleapis.com/maps/api/streetview/metadata';
const IMAGE_URL = 'https://maps.googleapis.com/maps/api/streetview';

// Google's documented ceiling for the Street View Static free tier.
const MAX_DIMENSION = 640;

function validCoordinate(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng);
}

/** Whether a Street View key is configured at all - the cheap check a caller
 * makes before doing anything else, so an unconfigured deployment never even
 * builds a metadata URL. */
export function hasStreetViewKey(apiKey = configuredApiKey) {
  return Boolean(apiKey);
}

/** The free, unmetered metadata request. `null` when it cannot be built at all. */
export function buildStreetViewMetadataUrl(lat, lng, { apiKey = configuredApiKey } = {}) {
  if (!apiKey || !validCoordinate(lat, lng)) return null;
  return `${METADATA_URL}?location=${lat},${lng}&key=${encodeURIComponent(apiKey)}`;
}

/** The billed image request. Same guards as the metadata URL, plus a clamp to
 * what Google's free tier actually serves. */
export function buildStreetViewImageUrl(
  lat, lng, { apiKey = configuredApiKey, width = 600, height = 400 } = {},
) {
  if (!apiKey || !validCoordinate(lat, lng)) return null;
  const w = Math.max(1, Math.min(MAX_DIMENSION, Math.round(width) || 1));
  const h = Math.max(1, Math.min(MAX_DIMENSION, Math.round(height) || 1));
  return `${IMAGE_URL}?location=${lat},${lng}&size=${w}x${h}&key=${encodeURIComponent(apiKey)}`;
}

/**
 * FR-6.15. Whether Street View imagery actually exists for this coordinate.
 *
 * Fails closed to "no coverage" on a missing key, bad coordinates, a network
 * error, or any response that is not an explicit `"status": "OK"` - Google's
 * metadata response uses `ZERO_RESULTS` for genuinely uncovered locations, but
 * an ambiguous or unrecognised status is not evidence of coverage either, so it
 * is treated the same as none. The caller's next fallback (the illustration
 * tier) is always available regardless of why this returned false.
 */
export async function hasStreetViewCoverage(
  lat, lng, { apiKey = configuredApiKey, fetchImpl = globalThis.fetch } = {},
) {
  const url = buildStreetViewMetadataUrl(lat, lng, { apiKey });
  if (!url || typeof fetchImpl !== 'function') return false;
  try {
    const response = await fetchImpl(url);
    if (!response?.ok) return false;
    const body = await response.json();
    return body?.status === 'OK';
  } catch {
    return false;
  }
}
