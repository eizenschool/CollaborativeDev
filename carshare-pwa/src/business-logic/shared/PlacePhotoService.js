import { loadGoogleMapsLibraries } from './GooglePlacesService.js';

const fixturePhotoMode = import.meta.env.VITE_DISCOVERY_DATA_SOURCE === 'fixture';

function fixturePhoto(label, variant) {
  const safeLabel = String(label || 'Destination').replace(/[<>&"']/g, '');
  const hue = (variant * 37) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 520"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="hsl(${hue} 56% 30%)"/><stop offset="1" stop-color="#86efac"/></linearGradient></defs><rect width="900" height="520" fill="url(#g)"/><circle cx="720" cy="115" r="70" fill="#fef08a" opacity=".8"/><path d="M0 395 210 210l150 130 125-110 205 165Z" fill="#064e3b" opacity=".72"/><text x="42" y="470" fill="white" font-family="sans-serif" font-size="34" font-weight="700">${safeLabel}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function mapsUrl(placeId, label) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(label || 'Destination')}&query_place_id=${encodeURIComponent(placeId)}`;
}

/**
 * Fetch the current Places photo metadata at the moment a viewer asks to see
 * it. Google photo resource names stored by older ingests can expire, so none
 * of those persisted names are used to build image URLs here.
 */
export async function resolveFreshPlacePhoto(placeId, {
  label = '', maxWidth = 800, photoIndex = 0
} = {}) {
  if (!placeId) return null;
  if (fixturePhotoMode && String(placeId).startsWith('fixture_')) {
    return {
      url: fixturePhoto(label, photoIndex),
      attribution: 'Fixture photo',
      sourceUrl: mapsUrl(placeId, label),
      photoCount: 1,
      cached: false,
    };
  }

  const { places } = await loadGoogleMapsLibraries(['places']);
  const place = new places.Place({ id: placeId });
  await place.fetchFields({ fields: ['photos'] });
  const photos = Array.isArray(place.photos) ? place.photos : [];
  const photo = photos[photoIndex];
  const url = photo?.getURI?.({ maxWidth });
  if (!url) return null;
  return {
    url,
    attribution: photo.authorAttributions?.[0] || null,
    sourceUrl: place.googleMapsURI || mapsUrl(placeId, label),
    photoCount: photos.length,
    cached: false,
  };
}

// Keep the existing call shape for ride-photo consumers while ensuring both
// paths resolve a current photo rather than reusing a persisted photo name.
export const resolvePlacePhoto = resolveFreshPlacePhoto;

export function photoAttributionName(attribution) {
  if (typeof attribution === 'string') return attribution;
  return attribution?.displayName || attribution?.name || '';
}

export const PlacePhotoService = {
  resolve: resolveFreshPlacePhoto,
  resolveFresh: resolveFreshPlacePhoto,
};
