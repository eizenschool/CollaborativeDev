// ===== BUSINESS LOGIC LAYER (GooglePlacesService) =====
// Cost-controlled browser boundary for confirmed Google place predictions and
// one-shot current-location reverse geocoding. This service never creates a
// Dynamic Maps instance and never calls Place Details or Routes.

const GOOGLE_MAPS_SCRIPT_ID = 'lets-tumpang-google-maps-script';
const GOOGLE_MAPS_SCRIPT_URL = 'https://maps.googleapis.com/maps/api/js';
const configuredApiKey = import.meta.env.VITE_GOOGLE_MAPS_PLACES_API_KEY?.trim() || '';

export const MIN_LOCATION_QUERY_LENGTH = 4;
export const MAX_GPS_ACCURACY_METRES = 100;

let googleMapsPromise = null;

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
    const onLoad = () => {
      if (window.google?.maps?.importLibrary) resolve(window.google.maps);
      else reject(new LocationServiceError('SERVICE_UNAVAILABLE', 'Google location services did not load correctly.'));
    };
    const onError = () => reject(new LocationServiceError('SERVICE_UNAVAILABLE', 'Google location services could not be loaded.'));

    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });
    if (!existing) {
      const params = new URLSearchParams({
        key: configuredApiKey,
        v: 'weekly',
        loading: 'async',
        language: 'en',
        region: 'MY'
      });
      script.id = GOOGLE_MAPS_SCRIPT_ID;
      script.async = true;
      script.src = `${GOOGLE_MAPS_SCRIPT_URL}?${params.toString()}`;
      script.referrerPolicy = 'strict-origin-when-cross-origin';
      document.head.appendChild(script);
    }
  }).catch((error) => {
    googleMapsPromise = null;
    throw error;
  });

  return googleMapsPromise;
}

async function resolveMaps(maps) {
  return maps || loadGoogleMaps();
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

export function buildAutocompleteRequest(input) {
  return {
    input: input.trim(),
    includedRegionCodes: ['my'],
    language: 'en',
    region: 'my'
  };
}

export async function searchLocations(input, { maps, navigatorObject = globalThis.navigator } = {}) {
  const query = typeof input === 'string' ? input.trim() : '';
  if (query.length < MIN_LOCATION_QUERY_LENGTH) return [];
  if (navigatorObject?.onLine === false) {
    throw new LocationServiceError('OFFLINE', 'You are offline. Reconnect to search for a location.');
  }

  try {
    const mapsApi = await resolveMaps(maps);
    const { AutocompleteSuggestion } = await mapsApi.importLibrary('places');
    const { suggestions = [] } = await AutocompleteSuggestion.fetchAutocompleteSuggestions(buildAutocompleteRequest(query));
    return suggestions
      .map(({ placePrediction }) => ({
        placeId: placePrediction?.placeId?.trim() || '',
        label: placePrediction?.text?.toString().trim() || ''
      }))
      .filter((suggestion) => suggestion.placeId && suggestion.label)
      .slice(0, 5);
  } catch (error) {
    throw serviceError(error, 'Location suggestions are unavailable. Please try again later.');
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
  getCurrentLocationPreview,
  resolveCurrentLocation,
  isConfirmedLocation
};
