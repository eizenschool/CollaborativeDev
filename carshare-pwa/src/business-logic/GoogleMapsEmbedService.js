// ===== BUSINESS LOGIC LAYER (GoogleMapsEmbedService) =====
// Zero-charge mapping boundary: this service only builds Maps Embed API URLs.
// Do not add Places, Routes, Geocoding, Dynamic Maps, or other billable SKUs here
// without an explicit project decision and cost-control plan.

const EMBED_BASE_URL = 'https://www.google.com/maps/embed/v1/directions';
const PLACE_EMBED_BASE_URL = 'https://www.google.com/maps/embed/v1/place';
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

export function buildDirectionsEmbedUrl({
  pickup,
  destination,
  waypoints = [],
  apiKey = configuredApiKey
} = {}) {
  const origin = cleanLocation(pickup);
  const end = cleanLocation(destination);
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

export function buildGoogleMapsDirectionsUrl({ pickup, destination, waypoints = [] } = {}) {
  const origin = cleanLocation(pickup);
  const end = cleanLocation(destination);
  if (!origin || !end) return null;

  const params = new URLSearchParams({ api: '1', origin, destination: end, travelmode: 'driving' });
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
  buildGoogleMapsDirectionsUrl,
  buildPlaceEmbedUrl,
  buildGoogleMapsLocationUrl
};
