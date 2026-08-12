// ===== BUSINESS LOGIC LAYER (GoogleMapsEmbedService) =====
// Zero-charge mapping boundary: this service only builds Maps Embed API URLs.
// Do not add Places, Routes, Geocoding, Dynamic Maps, or other billable SKUs here
// without an explicit project decision and cost-control plan.

const EMBED_BASE_URL = 'https://www.google.com/maps/embed/v1/directions';
const DIRECTIONS_BASE_URL = 'https://www.google.com/maps/dir/';
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

export const GoogleMapsEmbedService = {
  backend: 'maps-embed',
  isConfigured: Boolean(configuredApiKey),
  buildDirectionsEmbedUrl,
  buildGoogleMapsDirectionsUrl
};
