import { describe, expect, it, vi } from 'vitest';
import {
  buildAutocompleteRequest,
  getCurrentLocationPreview,
  getCurrentPosition,
  isConfirmedLocation,
  resolveCurrentLocation,
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

  it('does not call Google before four characters and restricts searches to Malaysia', async () => {
    const importLibrary = vi.fn();
    expect(await searchLocations('KUL', { maps: { importLibrary } })).toEqual([]);
    expect(importLibrary).not.toHaveBeenCalled();
    expect(buildAutocompleteRequest(' KL Sentral ')).toMatchObject({
      input: 'KL Sentral',
      includedRegionCodes: ['my'],
      region: 'my'
    });
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
