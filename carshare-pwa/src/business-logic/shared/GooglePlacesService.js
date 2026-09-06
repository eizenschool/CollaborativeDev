// ===== BUSINESS LOGIC LAYER (GooglePlacesService) =====
// Cost-controlled browser boundary for confirmed Google place predictions and
// one-shot current-location reverse geocoding. This service never creates a
// Dynamic Maps instance or calls Routes. It fetches only the minimal Place
// Details fields needed to attach coordinates to a selected autocomplete row.

const GOOGLE_MAPS_SCRIPT_ID = 'lets-tumpang-google-maps-script';
const GOOGLE_MAPS_SCRIPT_URL = 'https://maps.googleapis.com/maps/api/js';
const GOOGLE_MAPS_READY_CALLBACK = '__letsTumpangGoogleMapsReady';
const configuredApiKey = import.meta.env.VITE_GOOGLE_MAPS_PLACES_API_KEY?.trim() || '';

export const MIN_LOCATION_QUERY_LENGTH = 1;
export const LOCATION_SEARCH_DEBOUNCE_MS = 1000;
export const MAX_GPS_ACCURACY_METRES = 100;
export const MAX_CHECK_IN_ACCURACY_METRES = 150;
export const MAX_AUTOCOMPLETE_BIAS_ACCURACY_METRES = 500;
export const NEARBY_PICKUP_RADIUS_METRES = 5000;
export const NEARBY_PICKUP_RESULT_LIMIT = 5;
export const NEARBY_PICKUP_TYPES = Object.freeze([
  'transit_station', 'bus_station', 'train_station', 'subway_station', 'light_rail_station',
  'parking', 'gas_station', 'shopping_mall', 'market', 'supermarket',
  'restaurant', 'cafe', 'university', 'park', 'plaza',
  'tourist_attraction', 'cultural_landmark', 'historical_landmark'
]);
const MAP_DIAGNOSTIC_TEXT_LIMIT = 160;

let googleMapsPromise = null;
// Autocomplete predictions are intentionally kept outside the returned rows.
// The prediction object is not serialisable UI state and Place Details should
// only be requested after the user selects a row, not on every keystroke.
const locationPredictionCache = new Map();

export class LocationServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LocationServiceError';
    this.code = code;
  }
}

function serviceError(error, fallbackMessage) {
  if (error instanceof LocationServiceError) return error;
  const detail = `${error?.code || ''} ${error?.message || ''}`;
  if (/quota|over_query_limit|resource_exhausted/i.test(detail)) {
    return new LocationServiceError('QUOTA_EXCEEDED', 'Location search has reached its usage limit. Please try again later.');
  }
  return new LocationServiceError('SERVICE_UNAVAILABLE', fallbackMessage);
}

function loadGoogleMaps() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new LocationServiceError('UNSUPPORTED', 'Location search is only available in a browser.'));
  }
  if (window.google?.maps?.importLibrary) return Promise.resolve(window.google.maps);
  if (!configuredApiKey) {
    return Promise.reject(new LocationServiceError('NOT_CONFIGURED', 'Location search is not configured for this environment.'));
  }
  if (googleMapsPromise) return googleMapsPromise;

  googleMapsPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById(GOOGLE_MAPS_SCRIPT_ID);
    const script = existing || document.createElement('script');
    let readinessTimer = null;
    let readinessAttempts = 0;
    const cleanup = () => {
      if (readinessTimer) window.clearTimeout(readinessTimer);
      script.removeEventListener('error', onError);
      if (window[GOOGLE_MAPS_READY_CALLBACK] === onReady) delete window[GOOGLE_MAPS_READY_CALLBACK];
    };
    const onReady = () => {
      if (window.google?.maps?.importLibrary) {
        cleanup();
        resolve(window.google.maps);
        return;
      }
      readinessAttempts += 1;
      if (readinessAttempts >= 40) {
        cleanup();
        reject(new LocationServiceError('SERVICE_UNAVAILABLE', 'Google location services did not load correctly.'));
        return;
      }
      readinessTimer = window.setTimeout(onReady, 50);
    };
    const onError = () => {
      cleanup();
      reject(new LocationServiceError('SERVICE_UNAVAILABLE', 'Google location services could not be loaded.'));
    };

    script.addEventListener('error', onError, { once: true });
    window[GOOGLE_MAPS_READY_CALLBACK] = onReady;
    if (!existing) {
      const params = new URLSearchParams({
        key: configuredApiKey,
        v: 'weekly',
        loading: 'async',
        callback: GOOGLE_MAPS_READY_CALLBACK,
        language: 'en',
        region: 'MY'
      });
      script.id = GOOGLE_MAPS_SCRIPT_ID;
      script.async = true;
      script.src = `${GOOGLE_MAPS_SCRIPT_URL}?${params.toString()}`;
      script.referrerPolicy = 'strict-origin-when-cross-origin';
      document.head.appendChild(script);
    } else {
      onReady();
    }
  }).catch((error) => {
    googleMapsPromise = null;
    document.getElementById(GOOGLE_MAPS_SCRIPT_ID)?.remove();
    throw error;
  });

  return googleMapsPromise;
}

async function resolveMaps(maps) {
  return maps || loadGoogleMaps();
}

function safeDiagnosticText(value, fallback) {
  const text = String(value || fallback)
    .replace(/AIza[0-9A-Za-z_-]+/g, '[redacted-key]')
    .replace(/https?:\/\/\S+/g, '[redacted-url]')
    .replace(/-?\d{1,3}\.\d{4,}/g, '[redacted-number]')
    .slice(0, MAP_DIAGNOSTIC_TEXT_LIMIT);
  return text || fallback;
}

export function createMapDiagnostic(stage, error = null, fallbackCode = 'MAP_UNAVAILABLE') {
  return {
    stage: safeDiagnosticText(stage, 'unknown'),
    code: safeDiagnosticText(error?.code, fallbackCode),
    name: safeDiagnosticText(error?.name, 'Error'),
    message: safeDiagnosticText(error?.message, 'Interactive map is temporarily unavailable.')
  };
}

export async function loadGoogleMapsLibraries(libraries = []) {
  const maps = await loadGoogleMaps();
  const loaded = {};
  for (const library of libraries) loaded[library] = await maps.importLibrary(library);
  return { maps, ...loaded };
}

export function isConfirmedLocation(location) {
  if (!location || typeof location !== 'object') return false;
  if (typeof location.placeId === 'string' && location.placeId.trim()) return true;
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  return location.latitude !== null && location.latitude !== undefined && location.latitude !== ''
    && location.longitude !== null && location.longitude !== undefined && location.longitude !== ''
    && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}

export function buildAutocompleteRequest(input, { origin = null } = {}) {
  const latitude = Number(origin?.latitude ?? origin?.lat);
  const longitude = Number(origin?.longitude ?? origin?.lng);
  const accuracy = Number(origin?.accuracy);
  const canBias = Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
    && Number.isFinite(accuracy) && accuracy <= MAX_AUTOCOMPLETE_BIAS_ACCURACY_METRES;
  return {
    input: input.trim(),
    includedRegionCodes: ['my'],
    language: 'en',
    region: 'my',
    ...(canBias ? {
      locationBias: {
        center: { lat: latitude, lng: longitude },
        radius: 5000
      },
      origin: { lat: latitude, lng: longitude }
    } : {})
  };
}

export async function searchLocations(input, { maps, navigatorObject = globalThis.navigator, origin = null } = {}) {
  const query = typeof input === 'string' ? input.trim() : '';
  if (query.length < MIN_LOCATION_QUERY_LENGTH) return [];
  if (navigatorObject?.onLine === false) {
    throw new LocationServiceError('OFFLINE', 'You are offline. Reconnect to search for a location.');
  }

  try {
    const mapsApi = await resolveMaps(maps);
    const { AutocompleteSuggestion } = await mapsApi.importLibrary('places');
    const { suggestions = [] } = await AutocompleteSuggestion.fetchAutocompleteSuggestions(buildAutocompleteRequest(query, { origin }));
    const candidates = suggestions
      .map(({ placePrediction }) => {
        const distanceMeters = Number(placePrediction?.distanceMeters);
        const candidate = {
          placeId: placePrediction?.placeId?.trim() || '',
          label: placePrediction?.text?.toString().trim() || '',
          ...(Number.isFinite(distanceMeters) ? { distanceMeters } : {})
        };
        if (candidate.placeId && candidate.label && placePrediction) {
          locationPredictionCache.set(candidate.placeId, placePrediction);
        }
        return candidate;
      })
      .filter((suggestion) => suggestion.placeId && suggestion.label)
      .slice(0, 5);
    // Keep the cache bounded because this module can live for the whole PWA
    // session. Prediction data is only used to resolve a selected row.
    while (locationPredictionCache.size > 100) {
      const oldest = locationPredictionCache.keys().next().value;
      if (!oldest) break;
      locationPredictionCache.delete(oldest);
    }
    return candidates;
  } catch (error) {
    throw serviceError(error, 'Location suggestions are unavailable. Please try again later.');
  }
}

export async function resolveLocationSuggestion(suggestion) {
  const candidate = {
    placeId: String(suggestion?.placeId || '').trim(),
    label: String(suggestion?.label || '').trim(),
    ...(Number.isFinite(Number(suggestion?.distanceMeters))
      ? { distanceMeters: Number(suggestion.distanceMeters) } : {}),
    ...(Number.isFinite(Number(suggestion?.latitude))
      ? { latitude: Number(suggestion.latitude) } : {}),
    ...(Number.isFinite(Number(suggestion?.longitude))
      ? { longitude: Number(suggestion.longitude) } : {}),
    ...(suggestion?.formattedAddress ? { formattedAddress: String(suggestion.formattedAddress).trim() } : {})
  };
  if (!candidate.placeId || (Number.isFinite(candidate.latitude) && Number.isFinite(candidate.longitude))) {
    return candidate;
  }

  const prediction = locationPredictionCache.get(candidate.placeId);
  if (typeof prediction?.toPlace !== 'function') return candidate;
  try {
    const place = prediction.toPlace();
    if (typeof place?.fetchFields !== 'function') return candidate;
    await place.fetchFields({ fields: ['location', 'formattedAddress'] });
    const latitude = placeCoordinate(place.location, 'lat');
    const longitude = placeCoordinate(place.location, 'lng');
    return {
      ...candidate,
      ...(Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : {}),
      ...(place.formattedAddress ? { formattedAddress: String(place.formattedAddress).trim() } : {})
    };
  } catch {
    // A confirmed Place ID is still useful when the optional coordinate fetch
    // is unavailable. The server can apply its normal state-level safeguards.
    return candidate;
  }
}

function placeCoordinate(location, key) {
  const value = typeof location?.[key] === 'function' ? location[key]() : location?.[key];
  return Number(value);
}

function straightLineDistanceMetres(origin, location) {
  const latitude = placeCoordinate(location, 'lat');
  const longitude = placeCoordinate(location, 'lng');
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const radians = (degrees) => degrees * Math.PI / 180;
  const latitudeDelta = radians(latitude - origin.latitude);
  const longitudeDelta = radians(longitude - origin.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(origin.latitude)) * Math.cos(radians(latitude))
    * Math.sin(longitudeDelta / 2) ** 2;
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function nearbyPlaceLabel(place) {
  const name = typeof place?.displayName === 'string'
    ? place.displayName.trim()
    : String(place?.displayName?.text || '').trim();
  const address = String(place?.formattedAddress || '').trim();
  if (name && address && !address.toLocaleLowerCase('en').includes(name.toLocaleLowerCase('en'))) {
    return `${name}, ${address}`;
  }
  return address || name;
}

export async function searchNearbyPickupLocations(origin, { maps } = {}) {
  const normalisedOrigin = normaliseCurrentPosition(origin);
  if (normalisedOrigin.accuracy > MAX_AUTOCOMPLETE_BIAS_ACCURACY_METRES) {
    throw new LocationServiceError(
      'INACCURATE',
      `Your location is only accurate to about ${Math.round(normalisedOrigin.accuracy)} m. Move to an open area and retry, or search for a pickup point.`
    );
  }

  try {
    const mapsApi = await resolveMaps(maps);
    const { Place, SearchNearbyRankPreference } = await mapsApi.importLibrary('places');
    const { places = [] } = await Place.searchNearby({
      fields: ['id', 'displayName', 'formattedAddress', 'location'],
      locationRestriction: {
        center: { lat: normalisedOrigin.latitude, lng: normalisedOrigin.longitude },
        radius: NEARBY_PICKUP_RADIUS_METRES
      },
      includedTypes: [...NEARBY_PICKUP_TYPES],
      maxResultCount: NEARBY_PICKUP_RESULT_LIMIT,
      rankPreference: SearchNearbyRankPreference.DISTANCE,
      language: 'en',
      region: 'MY'
    });
    const seenPlaceIds = new Set();
    return places
      .map((place) => ({
        placeId: String(place?.id || '').trim(),
        label: nearbyPlaceLabel(place),
        distanceMeters: straightLineDistanceMetres(normalisedOrigin, place?.location)
      }))
      .filter((place) => {
        if (!place.placeId || !place.label || place.distanceMeters === null || seenPlaceIds.has(place.placeId)) return false;
        seenPlaceIds.add(place.placeId);
        return true;
      })
      .slice(0, NEARBY_PICKUP_RESULT_LIMIT);
  } catch (error) {
    throw serviceError(error, 'Nearby pickup alternatives are unavailable. Your selected pickup has not been changed.');
  }
}

export function getCurrentPosition({ geolocation = globalThis.navigator?.geolocation } = {}) {
  if (!geolocation?.getCurrentPosition) {
    return Promise.reject(new LocationServiceError('UNSUPPORTED', 'This browser cannot provide your current location.'));
  }

  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(resolve, (error) => {
      if (error?.code === 1) {
        reject(new LocationServiceError('PERMISSION_DENIED', 'Location permission was denied. Search for a pickup point instead.'));
      } else if (error?.code === 3) {
        reject(new LocationServiceError('TIMEOUT', 'Getting your location took too long. Try again or search for a pickup point.'));
      } else {
        reject(new LocationServiceError('POSITION_UNAVAILABLE', 'Your current location is unavailable. Search for a pickup point instead.'));
      }
    }, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    });
  });
}

export function normaliseCurrentPosition(position) {
  const source = position?.coords || position;
  const latitude = Number(source?.latitude);
  const longitude = Number(source?.longitude);
  const accuracy = Number(source?.accuracy);

  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
    || !Number.isFinite(accuracy) || accuracy < 0) {
    throw new LocationServiceError('POSITION_UNAVAILABLE', 'Your browser returned an invalid location. Search for a pickup point instead.');
  }

  return { latitude, longitude, accuracy };
}

export async function getCurrentLocationPreview({ geolocation } = {}) {
  return normaliseCurrentPosition(await getCurrentPosition({ geolocation }));
}

export async function resolveCurrentLocation({ maps, geolocation, position } = {}) {
  const { latitude, longitude, accuracy } = normaliseCurrentPosition(
    position || await getCurrentPosition({ geolocation })
  );

  if (accuracy > MAX_GPS_ACCURACY_METRES) {
    throw new LocationServiceError('INACCURATE', `Your location is only accurate to about ${Math.round(accuracy)} m. Move to an open area and retry, or search for a pickup point.`);
  }

  try {
    const mapsApi = await resolveMaps(maps);
    const { Geocoder } = await mapsApi.importLibrary('geocoding');
    const { results = [] } = await new Geocoder().geocode({
      location: { lat: latitude, lng: longitude },
      region: 'my'
    });
    const match = results.find((result) => result.place_id && result.formatted_address);
    if (!match) {
      throw new LocationServiceError('NO_RESULTS', 'No address could be found for your current location. Search for a pickup point instead.');
    }
    return {
      label: match.formatted_address,
      accuracy: Math.round(accuracy),
      location: {
        source: 'device',
        placeId: match.place_id,
        latitude,
        longitude
      }
    };
  } catch (error) {
    throw serviceError(error, 'Your location could not be converted into a pickup address. Search for a pickup point instead.');
  }
}

export const GooglePlacesService = {
  backend: 'google-places',
  isConfigured: Boolean(configuredApiKey),
  searchLocations,
  resolveLocationSuggestion,
  buildAutocompleteRequest,
  createMapDiagnostic,
  loadGoogleMapsLibraries,
  getCurrentLocationPreview,
  resolveCurrentLocation,
  searchNearbyPickupLocations,
  isConfirmedLocation
};
