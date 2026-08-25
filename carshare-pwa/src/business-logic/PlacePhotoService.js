import { loadGoogleMapsLibraries } from './GooglePlacesService.js';
import { PlaceQueryService } from './discovery/PlaceQueryService.js';
import { buildPlacePhotoUrl } from './discovery/placePhotos.js';

const fixturePhotoMode = import.meta.env.VITE_DISCOVERY_DATA_SOURCE === 'fixture';

function fixturePhoto(label) {
  const safeLabel = String(label || 'Destination').replace(/[<>&"']/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 520"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#0f766e"/><stop offset="1" stop-color="#86efac"/></linearGradient></defs><rect width="900" height="520" fill="url(#g)"/><circle cx="720" cy="115" r="70" fill="#fef08a" opacity=".8"/><path d="M0 395 210 210l150 130 125-110 205 165Z" fill="#064e3b" opacity=".72"/><text x="42" y="470" fill="white" font-family="sans-serif" font-size="34" font-weight="700">${safeLabel}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function mapsUrl(placeId, label) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(label || 'Destination')}&query_place_id=${encodeURIComponent(placeId)}`;
}

export async function resolveFreshPlacePhoto(placeId, { label = '', maxWidth = 800 } = {}) {
  if (!placeId) return null;
  if (fixturePhotoMode && String(placeId).startsWith('fixture_')) {
    return {
      url: fixturePhoto(label),
      attribution: 'Fixture photo',
      sourceUrl: mapsUrl(placeId, label),
      cached: false,
    };
  }
  const { places } = await loadGoogleMapsLibraries(['places']);
  const place = new places.Place({ id: placeId });
  await place.fetchFields({ fields: ['photos'] });
  const photo = place.photos?.[0];
  const url = photo?.getURI?.({ maxWidth });
  if (!url) return null;
  return {
    url,
    attribution: photo.authorAttributions?.[0] || null,
    sourceUrl: place.googleMapsURI || mapsUrl(placeId, label),
    cached: false,
  };
}

export async function resolvePlacePhoto(placeId, { label = '', maxWidth = 800 } = {}) {
  if (!placeId) return null;
  let cataloguePlace = null;
  try {
    cataloguePlace = await PlaceQueryService.getPlaceBySourcePlaceId(placeId);
  } catch {
    // The destination card can still ask Google for the current photo when the
    // local Module 6 catalogue is unavailable.
  }
  const cachedUrl = buildPlacePhotoUrl(cataloguePlace?.photoReference, { maxWidthPx: maxWidth });
  if (cachedUrl) {
    return {
      url: cachedUrl,
      attribution: cataloguePlace?.photoAttribution || 'Google Maps',
      sourceUrl: mapsUrl(placeId, label),
      cached: true,
    };
  }
  return resolveFreshPlacePhoto(placeId, { label, maxWidth });
}

export const PlacePhotoService = { resolve: resolvePlacePhoto, resolveFresh: resolveFreshPlacePhoto };
