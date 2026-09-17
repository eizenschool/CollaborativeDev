import { describe, expect, it } from 'vitest';
import {
  SEARCH_NEARBY_RADIUS_KM,
  buildSearchRecommendationRequest,
  collectSearchRecommendations,
  filterSearchRecommendations,
  isWithinSearchNearbyRadius,
  loadNearbySearchRecommendations,
  nearbyLocationErrorText,
  recommendationDistanceText
} from '../SearchRecommendationPicker.js';

const candidate = (sourcePlaceId, name, category, state = 'Melaka') => ({
  place: { sourcePlaceId, name, category, state },
  reasons: [{ key: 'quality', text: `Popular ${category} choice`, contribution: 0.4 }]
});

describe('Search destination recommendation picker helpers', () => {
  it('preserves ranked sections and removes duplicate or unusable place hints', () => {
    const results = collectSearchRecommendations({
      primary: [candidate('jonker', 'Jonker Street', 'culinary')],
      unserved: [candidate('jonker', 'Duplicate Jonker', 'culinary')],
      withheld: [candidate('fort', 'A Famosa', 'heritage'), candidate('', 'Missing ID', 'heritage')]
    });

    expect(results.map((item) => [item.place.sourcePlaceId, item.sectionKey])).toEqual([
      ['jonker', 'recommended'],
      ['fort', 'more']
    ]);
  });

  it('filters by category and by name, state, or recommendation reason', () => {
    const candidates = collectSearchRecommendations({
      primary: [
        candidate('jonker', 'Jonker Street', 'culinary'),
        candidate('taman', 'Taman Negara', 'nature', 'Pahang')
      ],
      unserved: [candidate('festival', 'Rainforest Festival', 'event', 'Sarawak')]
    });

    expect(filterSearchRecommendations(candidates, { category: 'nature' })
      .map((item) => item.place.sourcePlaceId)).toEqual(['taman']);
    expect(filterSearchRecommendations(candidates, { query: 'sarawak' })
      .map((item) => item.place.sourcePlaceId)).toEqual(['festival']);
    expect(filterSearchRecommendations(candidates, { query: 'popular culinary' })
      .map((item) => item.place.sourcePlaceId)).toEqual(['jonker']);
  });

  it('adds the private 25 km origin boundary only when a usable location is supplied', () => {
    expect(SEARCH_NEARBY_RADIUS_KM).toBe(25);
    expect(buildSearchRecommendationRequest({
      userId: 'user-1', travelDate: '2026-09-20', origin: { lat: '3.139', lng: 101.6869 }
    })).toEqual({
      userId: 'user-1',
      travelDate: '2026-09-20',
      origin: { lat: 3.139, lng: 101.6869 },
      maxDistanceKm: 25
    });
    expect(buildSearchRecommendationRequest({
      userId: 'user-1', travelDate: '2026-09-20', origin: { lat: 200, lng: 101.6869 }
    })).toEqual({ userId: 'user-1', travelDate: '2026-09-20' });
  });

  it('keeps the discovery service order instead of replacing smart ranking with nearest-first', () => {
    const results = collectSearchRecommendations({
      primary: [
        { ...candidate('best-fit', 'Best fit', 'nature'), distanceKm: 18.4 },
        { ...candidate('nearest', 'Nearest', 'nature'), distanceKm: 1.2 }
      ]
    });

    expect(results.map((item) => item.place.sourcePlaceId)).toEqual(['best-fit', 'nearest']);
  });

  it('includes the exact 25 km boundary and rejects destinations beyond it', () => {
    expect(isWithinSearchNearbyRadius(24.999)).toBe(true);
    expect(isWithinSearchNearbyRadius(25)).toBe(true);
    expect(isWithinSearchNearbyRadius(25.001)).toBe(false);
    expect(isWithinSearchNearbyRadius(null)).toBe(false);
  });

  it('loads nearby recommendations with an in-memory browser position and the 25 km request', async () => {
    const locate = async () => ({ latitude: 3.139, longitude: 101.6869, accuracy: 12 });
    const requests = [];
    const search = async (request) => {
      requests.push(request);
      return {
        primary: [
          { ...candidate('boundary', 'Boundary place', 'nature'), distanceKm: 25 },
          { ...candidate('outside', 'Outside place', 'nature'), distanceKm: 25.01 }
        ]
      };
    };

    await expect(loadNearbySearchRecommendations({
      userId: 'user-1', travelDate: '2026-09-20', locate, search
    })).resolves.toMatchObject({
      origin: { lat: 3.139, lng: 101.6869 },
      candidates: [{ sectionKey: 'recommended', distanceKm: 25 }]
    });
    expect(requests).toEqual([{
      userId: 'user-1',
      travelDate: '2026-09-20',
      origin: { lat: 3.139, lng: 101.6869 },
      maxDistanceKm: 25
    }]);
  });

  it('does not search when browser location fails', async () => {
    const error = Object.assign(new Error('denied'), { code: 'PERMISSION_DENIED' });
    let searched = false;

    await expect(loadNearbySearchRecommendations({
      locate: async () => { throw error; },
      search: async () => { searched = true; }
    })).rejects.toBe(error);
    expect(searched).toBe(false);
  });

  it('formats safe distance labels without inventing missing distances', () => {
    expect(recommendationDistanceText(3.24)).toBe('3.2 km away');
    expect(recommendationDistanceText(0.04)).toBe('< 0.1 km away');
    expect(recommendationDistanceText(null)).toBe('');
    expect(recommendationDistanceText(-1)).toBe('');
  });

  it('turns browser location failures into non-blocking recommendation messages', () => {
    expect(nearbyLocationErrorText({ code: 'PERMISSION_DENIED' })).toContain('permission');
    expect(nearbyLocationErrorText({ code: 'TIMEOUT' })).toContain('too long');
    expect(nearbyLocationErrorText({ code: 'UNSUPPORTED' })).toContain('cannot provide');
    expect(nearbyLocationErrorText({ code: 'POSITION_UNAVAILABLE' })).toContain('unavailable');
    expect(nearbyLocationErrorText(new Error('network'))).toContain('still available');
  });
});
