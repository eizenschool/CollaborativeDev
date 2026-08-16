// ===== BUSINESS LOGIC LAYER (StreetView) =====
// FR-6.15. Street View for a place that has no Google photograph of its own.
//
// This does not build a URL straight to Google, unlike placePhotos.js. The
// credential that authorises Street View is GOOGLE_PLACES_SERVER_KEY, the same
// Supabase secret m6-ingest already holds - it must never reach the browser,
// which is why it carries no VITE_ prefix (docs/MODULE6-API-SETUP.md §2). So
// the browser calls a Supabase Edge Function
// (supabase/functions/m6-streetview) instead, which holds the key server-side,
// runs FR-6.15's metadata-first check, and proxies the image through.
//
// This is why no browser-side Street View key exists at all: a place with no
// coverage gets a plain 404 from the function, which the caller's
// `<img onError>` already treats as "fall back to the illustration" - the same
// contract placePhotos.js's null return keeps for a fixture reference or a
// missing key. One image slot, one fallback contract, regardless of tier.

const configuredBaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() || '';

const FUNCTION_PATH = 'functions/v1/m6-streetview';

// Google's documented ceiling for the Street View Static free tier.
const MAX_DIMENSION = 640;

function validCoordinate(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng);
}

/**
 * Whether the proxy can even be reached - the browser needs to know where
 * Supabase is. `false` in fixture mode or any environment with no Supabase
 * project configured, mirroring `isSupabaseConfigured` elsewhere in this
 * codebase.
 */
export function hasStreetViewProxy(baseUrl = configuredBaseUrl) {
  return Boolean(baseUrl);
}

/**
 * The proxy image URL for a coordinate. `null` when Supabase is not
 * configured or the coordinate is not a real one - never a URL that would
 * 400 or 404 for a reason the caller could have avoided building it at all.
 */
export function buildStreetViewProxyUrl(
  lat, lng, { baseUrl = configuredBaseUrl, width = 600, height = 400 } = {},
) {
  if (!baseUrl || !validCoordinate(lat, lng)) return null;
  const w = Math.max(1, Math.min(MAX_DIMENSION, Math.round(width) || 1));
  const h = Math.max(1, Math.min(MAX_DIMENSION, Math.round(height) || 1));
  const base = baseUrl.replace(/\/$/, '');
  return `${base}/${FUNCTION_PATH}?lat=${lat}&lng=${lng}&w=${w}&h=${h}`;
}
