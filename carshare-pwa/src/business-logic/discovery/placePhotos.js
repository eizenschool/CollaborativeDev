// ===== BUSINESS LOGIC (place photo URLs) =====
//
// FR-6.13/6.14. Google's terms permit storing the photo *reference* but not the
// image bytes, so the catalogue holds references and the picture is requested
// live at display time. This builds that request; nothing here is cached and no
// image is ever copied into project storage.
//
// URL building lives in business logic rather than in the components, matching
// GoogleMapsEmbedService.js - presentation is not where Google's API shape
// belongs.
//
// Cost note: every URL this returns is one billable Places Photo request when
// the browser loads it. Callers render with loading="lazy" so a card scrolled
// past is never paid for.

const configuredApiKey = import.meta.env.VITE_GOOGLE_MAPS_PLACES_API_KEY?.trim() || '';

// Shared width tiers. The Places Photo cache key is the full URL including
// `maxWidthPx` (Google's own Cache-Control, verified live - see
// docs/MODULE6-API-SETUP.md §3.3), so two screens requesting the same photo
// at two slightly different widths each pay for a first view instead of
// sharing one. These three names exist so that coincidence has to be
// deliberate: a screen either matches an existing tier on purpose, or picks
// its own because it genuinely needs a different size.
//
// Only contexts of comparable visual scale share a tier. A home-rail
// thumbnail is not unified with the two below it: forcing it to request a
// larger image would mean downloading it on every single home-screen visit,
// a real bandwidth cost paid whether or not that place is ever opened again -
// a worse trade than the caching it would occasionally save.
export const PHOTO_WIDTH_RAIL = 400;   // DiscoverRail's home-screen strip
export const PHOTO_WIDTH_CARD = 600;   // DestinationCard, UnmetDemandView - list-grid cards
// The hero banner and the detail carousel are unified on purpose: a hero
// card's only action is a button straight into that place's detail page, so
// the same photo at the same width is close to guaranteed to be requested
// twice in one visit. 1200 over 1000 costs a little more on first view, but
// wins back more than that the moment the hero is actually opened.
export const PHOTO_WIDTH_LARGE = 1200; // DiscoverHub's hero, DestinationDetail's carousel

// A live reference is a Google resource name: places/{placeId}/photos/{ref}.
// The fixture catalogue stores `fixture:georgetown-1` placeholders instead,
// which are deliberately not fetchable - those keep the illustration tier, so
// the offline demo and the tests never reach for the network.
const FETCHABLE_REFERENCE = /^places\/[^/]+\/photos\/.+/;

// Google rejects anything above 4800.
const MAX_DIMENSION = 4800;

/**
 * The media URL for a stored photo reference, or null when the photo cannot be
 * fetched - no reference, no configured key, or a fixture placeholder. A null
 * return is the caller's signal to fall back to the generated illustration.
 */
export function buildPlacePhotoUrl(reference, { maxWidthPx = 800, apiKey = configuredApiKey } = {}) {
  if (typeof reference !== 'string' || !reference.trim()) return null;
  if (!apiKey) return null;
  if (!FETCHABLE_REFERENCE.test(reference)) return null;

  const width = Math.max(1, Math.min(MAX_DIMENSION, Math.round(maxWidthPx) || 1));
  return `https://places.googleapis.com/v1/${reference}/media`
    + `?maxWidthPx=${width}&key=${encodeURIComponent(apiKey)}`;
}

/** Whether a place has at least one photograph that can actually be displayed. */
export function hasFetchablePhoto(place) {
  return (place?.photoReferences || []).some(
    (entry) => buildPlacePhotoUrl(entry?.reference) !== null
  );
}
