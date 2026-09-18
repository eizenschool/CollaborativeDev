import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadGoogleMapsLibraries } from '../GooglePlacesService.js';
import { resolveFreshPlacePhoto, resolvePlacePhoto } from '../PlacePhotoService.js';

vi.mock('../GooglePlacesService.js', () => ({ loadGoogleMapsLibraries: vi.fn() }));

describe('PlacePhotoService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches current photo metadata and builds the image from the fresh photo URI', async () => {
    const getURI = vi.fn(({ maxWidth }) => `https://maps.example/current?width=${maxWidth}`);
    const fetchFields = vi.fn().mockResolvedValue(undefined);
    const photo = { getURI, authorAttributions: [{ displayName: 'A. Photographer' }] };
    const Place = vi.fn().mockImplementation(() => ({ fetchFields, photos: [photo] }));
    loadGoogleMapsLibraries.mockResolvedValue({ places: { Place } });

    const result = await resolvePlacePhoto('ChIJfresh', { label: 'Taman Negara', maxWidth: 600 });

    expect(Place).toHaveBeenCalledWith({ id: 'ChIJfresh' });
    expect(fetchFields).toHaveBeenCalledWith({ fields: ['photos'] });
    expect(getURI).toHaveBeenCalledWith({ maxWidth: 600 });
    expect(result).toMatchObject({
      url: 'https://maps.example/current?width=600',
      attribution: { displayName: 'A. Photographer' },
      photoCount: 1,
      cached: false,
    });
  });

  it('does not use caller-provided stale photo metadata', async () => {
    const photo = { getURI: vi.fn(() => 'https://maps.example/refreshed') };
    const Place = vi.fn().mockImplementation(() => ({
      fetchFields: vi.fn().mockResolvedValue(undefined),
      photos: [photo],
    }));
    loadGoogleMapsLibraries.mockResolvedValue({ places: { Place } });

    const result = await resolveFreshPlacePhoto('ChIJfresh', {
      photoReference: 'places/ChIJold/photos/expired',
    });

    expect(result.url).toBe('https://maps.example/refreshed');
    expect(photo.getURI).toHaveBeenCalledOnce();
  });

  it('returns null when the current Place has no usable photo', async () => {
    const Place = vi.fn().mockImplementation(() => ({
      fetchFields: vi.fn().mockResolvedValue(undefined),
      photos: [],
    }));
    loadGoogleMapsLibraries.mockResolvedValue({ places: { Place } });

    await expect(resolveFreshPlacePhoto('ChIJno-photo')).resolves.toBeNull();
  });

  it('uses a local fixture image without loading Google Maps', async () => {
    const result = await resolveFreshPlacePhoto('fixture_gua_tempurung', {
      label: 'Gua Tempurung',
    });

    expect(result.url).toMatch(/^data:image\/svg\+xml/);
    expect(result.attribution).toBe('Fixture photo');
    expect(loadGoogleMapsLibraries).not.toHaveBeenCalled();
  });
});
