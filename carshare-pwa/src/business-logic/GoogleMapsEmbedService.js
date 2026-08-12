// ===== BUSINESS LOGIC LAYER (GoogleMapsEmbedService) =====
// Zero-charge mapping boundary: this service only builds Maps Embed API URLs.
// Do not add Places, Routes, Geocoding, Dynamic Maps, or other billable SKUs here
// without an explicit project decision and cost-control plan.

const EMBED_BASE_URL = 'https://www.google.com/maps/embed/v1/directions';
const PLACE_EMBED_BASE_URL = 'https://www.google.com/maps/embed/v1/place';
const EMBED_VIEW_BASE_URL = 'https://www.google.com/maps/embed/v1/view';
const DIRECTIONS_BASE_URL = 'https://www.google.com/maps/dir/';
const MAPS_SEARCH_BASE_URL = 'https://www.google.com/maps/search/';
const configuredApiKey = import.meta.env.VITE_GOOGLE_MAPS_EMBED_API_KEY?.trim() || '';

function cleanLocation(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanWaypoints(waypoints = []) {
  return waypoints
    .map((item) => cleanLocation(typeof item === 'string' ? item : item?.name))
    .filter(Boolean)
    .slice(0, 20);
}

export function formatRouteLocation(label, location) {
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  const hasCoordinates = location?.latitude !== null && location?.latitude !== undefined && location?.latitude !== ''
    && location?.longitude !== null && location?.longitude !== undefined && location?.longitude !== ''
    && Number.isFinite(latitude) && Number.isFinite(longitude);
  if (hasCoordinates) return `${latitude},${longitude}`;
  const placeId = cleanLocation(location?.placeId);
  if (placeId) return `place_id:${placeId}`;
  return cleanLocation(label);
}

export function buildDirectionsEmbedUrl({
  pickup,
  pickupLocation,
  destination,
  destinationLocation,
  waypoints = [],
  apiKey = configuredApiKey
} = {}) {
  const origin = formatRouteLocation(pickup, pickupLocation);
  const end = formatRouteLocation(destination, destinationLocation);
  const key = cleanLocation(apiKey);
  if (!key || !origin || !end) return null;

  const params = new URLSearchParams({
    key,
    origin,
    destination: end,
    mode: 'driving',
    units: 'metric',
    region: 'my',
    language: 'en'
  });
  const stops = cleanWaypoints(waypoints);
  if (stops.length) params.set('waypoints', stops.join('|'));
  return `${EMBED_BASE_URL}?${params.toString()}`;
}

export function buildViewEmbedUrl({ location, zoom = 15, apiKey = configuredApiKey } = {}) {
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  const key = cleanLocation(apiKey);
  const hasCoordinates = location?.latitude !== null && location?.latitude !== undefined && location?.latitude !== ''
    && location?.longitude !== null && location?.longitude !== undefined && location?.longitude !== '';
  if (!key || !hasCoordinates
    || !Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return null;
  }

  const safeZoom = Math.min(21, Math.max(0, Math.round(Number(zoom) || 15)));
  const params = new URLSearchParams({
    key,
    center: `${latitude},${longitude}`,
    zoom: String(safeZoom),
    maptype: 'roadmap',
    region: 'my',
    language: 'en'
  });
  return `${EMBED_VIEW_BASE_URL}?${params.toString()}`;
}

export function buildGoogleMapsDirectionsUrl({ pickup, pickupLocation, destination, destinationLocation, waypoints = [] } = {}) {
  const pickupHasCoordinates = pickupLocation?.latitude !== null && pickupLocation?.latitude !== undefined
    && pickupLocation?.longitude !== null && pickupLocation?.longitude !== undefined
    && Number.isFinite(Number(pickupLocation.latitude)) && Number.isFinite(Number(pickupLocation.longitude));
  const origin = pickupHasCoordinates ? `${Number(pickupLocation.latitude)},${Number(pickupLocation.longitude)}` : cleanLocation(pickup);
  const end = cleanLocation(destination);
  if (!origin || !end) return null;

  const params = new URLSearchParams({ api: '1', origin, destination: end, travelmode: 'driving' });
  if (pickupLocation?.placeId && !pickupHasCoordinates) params.set('origin_place_id', pickupLocation.placeId);
  if (destinationLocation?.placeId) params.set('destination_place_id', destinationLocation.placeId);
  const stops = cleanWaypoints(waypoints);
  if (stops.length) params.set('waypoints', stops.join('|'));
  return `${DIRECTIONS_BASE_URL}?${params.toString()}`;
}

export function buildPlaceEmbedUrl({ latitude, longitude, apiKey = configuredApiKey } = {}) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  const key = cleanLocation(apiKey);
  if (!key || !Number.isFinite(lat) || lat < -90 || lat > 90
      || !Number.isFinite(lng) || lng < -180 || lng > 180) return null;
  const params = new URLSearchParams({
    key,
    q: `${lat},${lng}`,
    zoom: '16',
    region: 'my',
    language: 'en'
  });
  return `${PLACE_EMBED_BASE_URL}?${params.toString()}`;
}

export function buildGoogleMapsLocationUrl({ latitude, longitude } = {}) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90
      || !Number.isFinite(lng) || lng < -180 || lng > 180) return null;
  const params = new URLSearchParams({ api: '1', query: `${lat},${lng}` });
  return `${MAPS_SEARCH_BASE_URL}?${params.toString()}`;
}

export const GoogleMapsEmbedService = {
  backend: 'maps-embed',
  isConfigured: Boolean(configuredApiKey),
  buildDirectionsEmbedUrl,
  buildViewEmbedUrl,
  buildGoogleMapsDirectionsUrl,
  buildPlaceEmbedUrl,
  buildGoogleMapsLocationUrl,
  formatRouteLocation
};
