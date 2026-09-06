import { describe, expect, it, vi } from 'vitest';
import {
  LOCATION_SEARCH_DEBOUNCE_MS,
  NEARBY_PICKUP_RADIUS_METRES,
  NEARBY_PICKUP_RESULT_LIMIT,
  NEARBY_PICKUP_TYPES,
  MIN_LOCATION_QUERY_LENGTH,
  buildAutocompleteRequest,
  getCurrentLocationPreview,
  getCurrentPosition,
  isConfirmedLocation,
  resolveCurrentLocation,
  searchNearbyPickupLocations,
  searchLocations
} from '../GooglePlacesService.js';

function geolocationResult({ latitude = 3.139, longitude = 101.6869, accuracy = 20 } = {}) {
  return { coords: { latitude, longitude, accuracy } };
}

describe('Google Places location boundary', () => {
  it('requires a confirmed Place ID or a complete coordinate pair', () => {
    expect(isConfirmedLocation({ placeId: 'place-kl' })).toBe(true);
    expect(isConfirmedLocation({ latitude: 3.139, longitude: 101.6869 })).toBe(true);
    expect(isConfirmedLocation({ latitude: 3.139 })).toBe(false);
    expect(isConfirmedLocation({ latitude: 91, longitude: 101.6869 })).toBe(false);
    expect(isConfirmedLocation(null)).toBe(false);
  });

  it('starts at one character and restricts searches to Malaysia', async () => {
    const importLibrary = vi.fn();
    expect(MIN_LOCATION_QUERY_LENGTH).toBe(1);
    expect(LOCATION_SEARCH_DEBOUNCE_MS).toBe(1000);
    expect(await searchLocations('', { maps: { importLibrary } })).toEqual([]);
    expect(importLibrary).not.toHaveBeenCalled();
    expect(buildAutocompleteRequest(' KL Sentral ')).toMatchObject({
      input: 'KL Sentral',
      includedRegionCodes: ['my'],
      region: 'my'
    });
  });

  it('requests suggestions for a single character', async () => {
    const fetchAutocompleteSuggestions = vi.fn(async () => ({
      suggestions: [{ placePrediction: { placeId: 'place-k', text: { toString: () => 'Kuala Lumpur, Malaysia' } } }]
    }));
    const maps = { importLibrary: vi.fn(async () => ({ AutocompleteSuggestion: { fetchAutocompleteSuggestions } })) };

    await expect(searchLocations('K', { maps })).resolves.toEqual([
      { placeId: 'place-k', label: 'Kuala Lumpur, Malaysia' }
    ]);
    expect(fetchAutocompleteSuggestions).toHaveBeenCalledWith(expect.objectContaining({ input: 'K' }));
  });

  it('waits for the Google ready callback and shares the first script load', async () => {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    vi.stubEnv('VITE_GOOGLE_MAPS_PLACES_API_KEY', 'test-browser-key');
    vi.resetModules();
    const listeners = new Map();
    let appendedScript = null;
    const script = {
      addEventListener: (type, listener) => listeners.set(type, listener),
      removeEventListener: (type) => listeners.delete(type),
      remove: vi.fn()
    };
    const fetchAutocompleteSuggestions = vi.fn(async ({ input }) => ({
      suggestions: [{ placePrediction: { placeId: `place-${input}`, text: { toString: () => `${input}, Malaysia` } } }]
    }));

    try {
      globalThis.window = { setTimeout, clearTimeout };
      globalThis.document = {
        getElementById: () => appendedScript,
        createElement: () => script,
        head: {
          appendChild: (item) => {
            appendedScript = item;
            setTimeout(() => {
              globalThis.window.google = {
                maps: {
                  importLibrary: vi.fn(async () => ({ AutocompleteSuggestion: { fetchAutocompleteSuggestions } }))
                }
              };
              const callback = new URL(item.src).searchParams.get('callback');
              globalThis.window[callback]();
            }, 0);
          }
        }
      };
      const { searchLocations: searchWithFreshLoader } = await import('../GooglePlacesService.js');
      const [first, second] = await Promise.all([
        searchWithFreshLoader('K', { navigatorObject: { onLine: true } }),
        searchWithFreshLoader('L', { navigatorObject: { onLine: true } })
      ]);

      expect(first[0].placeId).toBe('place-K');
      expect(second[0].placeId).toBe('place-L');
      expect(appendedScript.src).toContain('callback=__letsTumpangGoogleMapsReady');
      expect(fetchAutocompleteSuggestions).toHaveBeenCalledTimes(2);
    } finally {
      globalThis.window = originalWindow;
      globalThis.document = originalDocument;
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it('returns at most five confirmed predictions without requesting Place Details', async () => {
    const fetchAutocompleteSuggestions = vi.fn(async (request) => ({
      suggestions: Array.from({ length: 7 }, (_, index) => ({
        placePrediction: {
          placeId: `place-${index}`,
          text: { toString: () => `Malaysia place ${index}` }
        }
      }))
    }));
    const importLibrary = vi.fn(async (library) => {
      expect(library).toBe('places');
      return { AutocompleteSuggestion: { fetchAutocompleteSuggestions } };
    });

    const results = await searchLocations('Sentral', {
      maps: { importLibrary },
      navigatorObject: { onLine: true }
    });

    expect(results).toHaveLength(5);
    expect(results[0]).toEqual({ placeId: 'place-0', label: 'Malaysia place 0' });
    expect(fetchAutocompleteSuggestions).toHaveBeenCalledWith(expect.objectContaining({ includedRegionCodes: ['my'] }));
    expect(importLibrary).toHaveBeenCalledTimes(1);
  });

  it('surfaces offline and quota exhaustion without retrying', async () => {
    await expect(searchLocations('Sentral', {
      maps: { importLibrary: vi.fn() },
      navigatorObject: { onLine: false }
    })).rejects.toMatchObject({ code: 'OFFLINE' });

    const maps = {
      importLibrary: vi.fn(async () => ({
        AutocompleteSuggestion: {
          fetchAutocompleteSuggestions: vi.fn(async () => {
            throw Object.assign(new Error('Resource exhausted'), { code: 'OVER_QUERY_LIMIT' });
          })
        }
      }))
    };
    await expect(searchLocations('Sentral', { maps })).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
  });

  it('requests five pickup-friendly places within 5 km ordered by distance', async () => {
    const searchNearby = vi.fn(async () => ({ places: [] }));
    const maps = {
      importLibrary: vi.fn(async (library) => {
        expect(library).toBe('places');
        return {
          Place: { searchNearby },
          SearchNearbyRankPreference: { DISTANCE: 'DISTANCE' }
        };
      })
    };

    await expect(searchNearbyPickupLocations({
      latitude: 3.139,
      longitude: 101.6869,
      accuracy: 35
    }, { maps })).resolves.toEqual([]);

    expect(searchNearby).toHaveBeenCalledWith({
      fields: ['id', 'displayName', 'formattedAddress', 'location'],
      locationRestriction: {
        center: { lat: 3.139, lng: 101.6869 },
        radius: NEARBY_PICKUP_RADIUS_METRES
      },
      includedTypes: [...NEARBY_PICKUP_TYPES],
      maxResultCount: NEARBY_PICKUP_RESULT_LIMIT,
      rankPreference: 'DISTANCE',
      language: 'en',
      region: 'MY'
    });
    expect(NEARBY_PICKUP_TYPES).toEqual(expect.arrayContaining([
      'transit_station', 'parking', 'shopping_mall', 'restaurant', 'university', 'park', 'cultural_landmark'
    ]));
  });

  it('maps nearby places in Google distance order and filters incomplete or duplicate rows', async () => {
    const searchNearby = vi.fn(async () => ({
      places: [
        { id: 'near-1', displayName: 'KL Sentral', formattedAddress: 'Brickfields, Kuala Lumpur', location: { lat: () => 3.1391, lng: () => 101.6869 } },
        { id: 'near-1', displayName: 'Duplicate', formattedAddress: 'Duplicate address', location: { lat: 3.1392, lng: 101.6869 } },
        { id: '', displayName: 'Missing ID', formattedAddress: 'Somewhere', location: { lat: 3.1393, lng: 101.6869 } },
        { id: 'near-2', displayName: { text: 'Central Market' }, formattedAddress: '', location: { lat: 3.140, lng: 101.6869 } },
        { id: 'no-location', displayName: 'No coordinates', formattedAddress: 'Kuala Lumpur' }
      ]
    }));
    const maps = { importLibrary: vi.fn(async () => ({
      Place: { searchNearby },
      SearchNearbyRankPreference: { DISTANCE: 'DISTANCE' }
    })) };

    const results = await searchNearbyPickupLocations({ latitude: 3.139, longitude: 101.6869, accuracy: 40 }, { maps });

    expect(results).toHaveLength(2);
    expect(results.map((result) => result.placeId)).toEqual(['near-1', 'near-2']);
    expect(results[0]).toMatchObject({ label: 'KL Sentral, Brickfields, Kuala Lumpur' });
    expect(results[0].distanceMeters).toBeLessThan(results[1].distanceMeters);
  });

  it('rejects inaccurate nearby origins and maps Google quota failures', async () => {
    const importLibrary = vi.fn();
    await expect(searchNearbyPickupLocations({
      latitude: 3.139,
      longitude: 101.6869,
      accuracy: 500.1
    }, { maps: { importLibrary } })).rejects.toMatchObject({ code: 'INACCURATE' });
    expect(importLibrary).not.toHaveBeenCalled();

    const maps = { importLibrary: vi.fn(async () => ({
      Place: { searchNearby: vi.fn(async () => { throw Object.assign(new Error('Resource exhausted'), { code: 'OVER_QUERY_LIMIT' }); }) },
      SearchNearbyRankPreference: { DISTANCE: 'DISTANCE' }
    })) };
    await expect(searchNearbyPickupLocations({
      latitude: 3.139,
      longitude: 101.6869,
      accuracy: 20
    }, { maps })).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
  });

  it('requests one high-accuracy position and maps permission and timeout failures', async () => {
    const getCurrentPositionMock = vi.fn((success) => success(geolocationResult()));
    await expect(getCurrentPosition({ geolocation: { getCurrentPosition: getCurrentPositionMock } })).resolves.toEqual(geolocationResult());
    expect(getCurrentPositionMock).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    });

    const denied = { getCurrentPosition: (_success, failure) => failure({ code: 1 }) };
    const timedOut = { getCurrentPosition: (_success, failure) => failure({ code: 3 }) };
    await expect(getCurrentPosition({ geolocation: denied })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(getCurrentPosition({ geolocation: timedOut })).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('uses one GPS reading for map centring without calling Google or rejecting approximate accuracy', async () => {
    const getCurrentPositionMock = vi.fn((success) => success(geolocationResult({ accuracy: 180.4 })));

    await expect(getCurrentLocationPreview({
      geolocation: { getCurrentPosition: getCurrentPositionMock }
    })).resolves.toEqual({ latitude: 3.139, longitude: 101.6869, accuracy: 180.4 });
    expect(getCurrentPositionMock).toHaveBeenCalledTimes(1);
  });

  it('rejects GPS accuracy above 100 metres before calling Google', async () => {
    const maps = { importLibrary: vi.fn() };
    const geolocation = {
      getCurrentPosition: (success) => success(geolocationResult({ accuracy: 100.1 }))
    };
    await expect(resolveCurrentLocation({ maps, geolocation })).rejects.toMatchObject({ code: 'INACCURATE' });
    expect(maps.importLibrary).not.toHaveBeenCalled();
  });

  it('accepts the 100 metre boundary and reverse geocodes exactly once', async () => {
    const geocode = vi.fn(async () => ({
      results: [{ place_id: 'current-place', formatted_address: 'KL Sentral, Kuala Lumpur, Malaysia' }]
    }));
    const maps = {
      importLibrary: vi.fn(async (library) => {
        expect(library).toBe('geocoding');
        return { Geocoder: class { geocode = geocode; } };
      })
    };
    const geolocation = {
      getCurrentPosition: (success) => success(geolocationResult({ accuracy: 100 }))
    };

    await expect(resolveCurrentLocation({ maps, geolocation })).resolves.toEqual({
      label: 'KL Sentral, Kuala Lumpur, Malaysia',
      accuracy: 100,
      location: {
        source: 'device',
        placeId: 'current-place',
        latitude: 3.139,
        longitude: 101.6869
      }
    });
    expect(geocode).toHaveBeenCalledTimes(1);
  });

  it('reuses an accurate map preview when confirming current pickup', async () => {
    const geocode = vi.fn(async () => ({
      results: [{ place_id: 'current-place', formatted_address: 'KL Sentral, Kuala Lumpur, Malaysia' }]
    }));
    const maps = {
      importLibrary: vi.fn(async () => ({
        Geocoder: class { geocode = geocode; }
      }))
    };
    const geolocation = { getCurrentPosition: vi.fn() };

    await expect(resolveCurrentLocation({
      maps,
      geolocation,
      position: { latitude: 3.139, longitude: 101.6869, accuracy: 35 }
    })).resolves.toMatchObject({
      label: 'KL Sentral, Kuala Lumpur, Malaysia',
      accuracy: 35
    });
    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
    expect(geocode).toHaveBeenCalledTimes(1);
  });
});
