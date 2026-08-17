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
 */
export async function checkStreetViewCoverage(
  lat, lng, { baseUrl = configuredBaseUrl, fetchImpl = globalThis.fetch } = {},
) {
  if (!baseUrl || !validCoordinate(lat, lng) || typeof fetchImpl !== 'function') {
    return NOT_COVERED;
  }
  const base = baseUrl.replace(/\/$/, '');
  const url = `${base}/${CHECK_PATH}?lat=${lat}&lng=${lng}`;
  try {
    const response = await fetchImpl(url);
    if (!response.ok) return NOT_COVERED;
    const body = await response.json();
    if (!body?.covered) return NOT_COVERED;
    return {
      covered: true,
      heading: Number.isFinite(body.heading) ? body.heading : null,
      capturedAt: typeof body.capturedAt === 'string' ? body.capturedAt : null
    };
  } catch {
    return NOT_COVERED;
  }
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
