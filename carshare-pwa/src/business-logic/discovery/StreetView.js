// ===== BUSINESS LOGIC LAYER (StreetView) =====
// FR-6.15. Interactive Street View for a place, shown as its own carousel
// scene alongside real photographs (see StreetViewFrame.jsx).
//
// Two credentials, two purposes, deliberately not shared:
//   - GOOGLE_PLACES_SERVER_KEY (a Supabase secret) checks coverage. The check
//     needs Street View Static API authorisation, which stays server-side and
//     never reaches the browser - the whole reason it carries no VITE_
//     prefix. supabase/functions/m6-streetview holds it and answers with
//     { covered, heading, capturedAt }, never image bytes.
//   - VITE_GOOGLE_MAPS_EMBED_API_KEY (Module 2's existing browser key,
//     website-restricted) renders the actual interactive panorama, through
//     Maps Embed API's streetview mode - a mode of an API this key already
//     had enabled, not a separate product that needed new console work.
//
// The split is deliberate, not incidental: Maps Embed API's own pricing is
// documented as no-charge (docs/GOOGLE-MAPS-SETUP.md), and the coverage check
// is free and unmetered regardless of which key makes it, so there is no cost
// reason to merge the two credentials - only a reason to keep the narrower
// one narrow.

const configuredBaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() || '';
const configuredEmbedKey = import.meta.env.VITE_GOOGLE_MAPS_EMBED_API_KEY?.trim() || '';

const CHECK_PATH = 'functions/v1/m6-streetview';
const EMBED_URL = 'https://www.google.com/maps/embed/v1/streetview';

function validCoordinate(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng);
}

const NOT_COVERED = { covered: false, heading: null, capturedAt: null };

// A coordinate's coverage, heading, and capture date do not change between two
// screens opening seconds apart - the same reasoning WeatherGate.js's
// forecastCache is built on. Held for the session, not the ranking cache
// FR-6.11 forbids: this is display metadata, not a scoring input. Without it,
// switching away from the carousel's Street View frame and back re-ran the
// check and re-fetched from Supabase on every single mount - which is also
// why the JSON response itself now sets a day-long Cache-Control
// (m6-streetview/index.ts): this cache and that header both exist because one
// alone would still leave a repeat visit either re-parsing a fresh network
// round trip in JS or a flash of "Checking Street View…" before an
// instant cache hit resolves.
const coverageCache = new Map();
const cacheKey = (lat, lng) => `${lat},${lng}`;

/** Whether the embed key is configured - needed to render anything at all,
 * independent of whether a given coordinate has coverage. */
export function hasStreetViewEmbedKey(apiKey = configuredEmbedKey) {
  return Boolean(apiKey);
}

/**
 * Whether a coordinate has Street View coverage, and if so, which way to
 * point the camera and how old the imagery is.
 *
 * Never throws and never reports coverage on a failure of any kind - a
 * network error, a malformed response, or no Supabase project configured all
 * collapse to `NOT_COVERED`, so the caller's fallback (the illustration) is
 * always the safe choice when this cannot answer confidently. This matters
 * more for an embed than it did for a plain `<img>`: an iframe has no clean
 * "this failed" signal the way `onError` does, so the decision to render one
 * at all has to be made correctly *before* it exists, not corrected after.
 *
 * A failure is deliberately not cached - only a confident answer, covered or
 * not, is worth remembering. A transient network error should get a fresh
 * chance next time, not be frozen into "no coverage" for the rest of the
 * session.
 */
export async function checkStreetViewCoverage(
  lat, lng, { baseUrl = configuredBaseUrl, fetchImpl = globalThis.fetch } = {},
) {
  if (!baseUrl || !validCoordinate(lat, lng) || typeof fetchImpl !== 'function') {
    return NOT_COVERED;
  }

  const key = cacheKey(lat, lng);
  const cached = coverageCache.get(key);
  if (cached) return cached;

  const base = baseUrl.replace(/\/$/, '');
  const url = `${base}/${CHECK_PATH}?lat=${lat}&lng=${lng}`;
  try {
    const response = await fetchImpl(url);
    if (!response.ok) return NOT_COVERED;
    const body = await response.json();
    const result = !body?.covered
      ? NOT_COVERED
      : {
          covered: true,
          heading: Number.isFinite(body.heading) ? body.heading : null,
          capturedAt: typeof body.capturedAt === 'string' ? body.capturedAt : null
        };
    coverageCache.set(key, result);
    return result;
  } catch {
    return NOT_COVERED;
  }
}

/** Test hook, so one case's cached coverage cannot leak into the next. */
export function __clearCoverageCache() {
  coverageCache.clear();
}

/**
 * The interactive embed URL. `null` when the embed key is not configured or
 * the coordinate is not real - never a URL that would render Google's own
 * error state for a reason the caller could have avoided building it at all.
 */
export function buildStreetViewEmbedUrl(
  lat, lng, { apiKey = configuredEmbedKey, heading } = {},
) {
  if (!apiKey || !validCoordinate(lat, lng)) return null;
  const headingParam = Number.isFinite(heading) ? `&heading=${heading}` : '';
  return `${EMBED_URL}?key=${encodeURIComponent(apiKey)}&location=${lat},${lng}${headingParam}`;
}
