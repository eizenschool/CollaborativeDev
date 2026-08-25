// UC6.14 - the interface Modules 2 and 4 consume.
//
// These are contract tests as much as unit tests: another module codes against
// this shape, so the assertions cover the fields returned and the ordering
// promised, not only whether the geometry is right.

import { beforeEach, describe, expect, it } from 'vitest';
import { PlaceQueryService } from '../PlaceQueryService.js';
import { discoveryDb } from '../../../data-access/discoveryStore.js';
import { CATEGORY } from '../constants.js';

const KL = { lat: 3.1390, lng: 101.6869 };
const PENANG = { lat: 5.4141, lng: 100.3288 };

describe('getPlaceBySourcePlaceId - Module 4 public hint resolution', () => {
  beforeEach(() => discoveryDb.__reset());

  it('resolves a recommendable public source ID through the narrow place contract', async () => {
    const place = await PlaceQueryService.getPlaceBySourcePlaceId(' fixture_jonker ');
    expect(place).toMatchObject({ sourcePlaceId: 'fixture_jonker', name: 'Jonker Street' });
    expect(place.lifecycleState).toBeUndefined();
    expect(place.reviews).toBeUndefined();
  });

  it('does not resolve empty, unknown, or retired source IDs', async () => {
    expect(await PlaceQueryService.getPlaceBySourcePlaceId('')).toBeNull();
    expect(await PlaceQueryService.getPlaceBySourcePlaceId('missing')).toBeNull();
    expect(await PlaceQueryService.getPlaceBySourcePlaceId('fixture_retired')).toBeNull();
  });
});

describe('queryPlacesNearPoint - FR-6.36', () => {
  beforeEach(() => discoveryDb.__reset());

  it('returns places inside the radius and excludes those outside', async () => {
    const near = await PlaceQueryService.queryPlacesNearPoint({ ...KL, radiusKm: 60 });
    const far = await PlaceQueryService.queryPlacesNearPoint({ ...KL, radiusKm: 1000 });

    expect(near.length).toBeGreaterThan(0);
    expect(far.length).toBeGreaterThan(near.length);
    expect(near.every((p) => p.distanceKm <= 60)).toBe(true);
  });

  it('orders by distance, nearest first', async () => {
    const results = await PlaceQueryService.queryPlacesNearPoint({ ...KL, radiusKm: 400 });
    const distances = results.map((p) => p.distanceKm);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
  });

  it('filters by category when one is given', async () => {
    const results = await PlaceQueryService.queryPlacesNearPoint({
      ...KL, radiusKm: 400, category: CATEGORY.HERITAGE
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((p) => p.category === CATEGORY.HERITAGE)).toBe(true);
  });

  // The withholding rule is enforced here rather than by each caller, so that a
  // consuming module cannot surface a retired place by forgetting to filter.
  it('never returns a Retired place', async () => {
    const results = await PlaceQueryService.queryPlacesNearPoint({ ...KL, radiusKm: 5000 });
    expect(results.some((p) => p.placeId === 'p_retired_museum')).toBe(false);
  });

  it('returns the agreed contract shape and nothing internal', async () => {
    const [first] = await PlaceQueryService.queryPlacesNearPoint({ ...KL, radiusKm: 400 });

    expect(Object.keys(first).sort()).toEqual([
      'category', 'distanceKm', 'lat', 'lng', 'name', 'photoAttribution',
      'photoReference', 'placeId', 'rating', 'reviewCount', 'sourcePlaceId', 'state'
    ]);
    expect(first.lifecycleState).toBeUndefined();
    expect(first.reviews).toBeUndefined();
  });

  it('returns an empty list for unusable input rather than throwing', async () => {
    expect(await PlaceQueryService.queryPlacesNearPoint({})).toEqual([]);
    expect(await PlaceQueryService.queryPlacesNearPoint({ lat: 999, lng: 0, radiusKm: 10 })).toEqual([]);
    expect(await PlaceQueryService.queryPlacesNearPoint({ ...KL, radiusKm: 0 })).toEqual([]);
    expect(await PlaceQueryService.queryPlacesNearPoint({ ...KL, radiusKm: -5 })).toEqual([]);
  });
});

describe('queryPlacesAlongRoute - FR-6.37', () => {
  beforeEach(() => discoveryDb.__reset());

  it('finds places in the corridor between Kuala Lumpur and Penang', async () => {
    const results = await PlaceQueryService.queryPlacesAlongRoute({
      origin: KL, destination: PENANG, corridorWidthKm: 60
    });
    expect(results.length).toBeGreaterThan(0);
  });

  // A Host wants stops in the order they will pass them, not nearest first.
  it('orders by progress along the route, not by proximity', async () => {
    const results = await PlaceQueryService.queryPlacesAlongRoute({
      origin: KL, destination: PENANG, corridorWidthKm: 80
    });
    const progress = results.map((p) => p.routeProgress);
    expect([...progress].sort((a, b) => a - b)).toEqual(progress);
  });

  it('widening the corridor can only add places, never remove them', async () => {
    const narrow = await PlaceQueryService.queryPlacesAlongRoute({
      origin: KL, destination: PENANG, corridorWidthKm: 20
    });
    const wide = await PlaceQueryService.queryPlacesAlongRoute({
      origin: KL, destination: PENANG, corridorWidthKm: 120
    });

    expect(wide.length).toBeGreaterThanOrEqual(narrow.length);
    for (const place of narrow) {
      expect(wide.some((p) => p.placeId === place.placeId)).toBe(true);
    }
  });

  // Sarawak is across the South China Sea from a peninsular route, so it must
  // never appear however generous the corridor is.
  it('excludes places nowhere near the route', async () => {
    const results = await PlaceQueryService.queryPlacesAlongRoute({
      origin: KL, destination: PENANG, corridorWidthKm: 100
    });
    expect(results.some((p) => p.state === 'Sarawak')).toBe(false);
  });

  it('measures from the endpoint for a place beyond the end of the route', async () => {
    // A very short route: everything is "past the end", and offsets must still be
    // real distances rather than measured against an imaginary extension.
    const results = await PlaceQueryService.queryPlacesAlongRoute({
      origin: KL,
      destination: { lat: 3.14, lng: 101.69 },
      corridorWidthKm: 30
    });
    expect(results.every((p) => p.offsetKm >= 0 && p.offsetKm <= 30)).toBe(true);
  });

  it('filters by category', async () => {
    const results = await PlaceQueryService.queryPlacesAlongRoute({
      origin: KL, destination: PENANG, corridorWidthKm: 100, category: CATEGORY.CULINARY
    });
    expect(results.every((p) => p.category === CATEGORY.CULINARY)).toBe(true);
  });

  it('never returns a Retired place', async () => {
    const results = await PlaceQueryService.queryPlacesAlongRoute({
      origin: KL, destination: PENANG, corridorWidthKm: 500
    });
    expect(results.some((p) => p.placeId === 'p_retired_museum')).toBe(false);
  });

  it('returns an empty list for unusable input rather than throwing', async () => {
    expect(await PlaceQueryService.queryPlacesAlongRoute({})).toEqual([]);
    expect(await PlaceQueryService.queryPlacesAlongRoute({ origin: KL })).toEqual([]);
    expect(await PlaceQueryService.queryPlacesAlongRoute({
      origin: KL, destination: PENANG, corridorWidthKm: 0
    })).toEqual([]);
  });

  it('reports each place once with a bounded progress value', async () => {
    const results = await PlaceQueryService.queryPlacesAlongRoute({
      origin: KL, destination: PENANG, corridorWidthKm: 100
    });
    const ids = results.map((p) => p.placeId);

    expect(new Set(ids).size).toBe(ids.length);
    expect(results.every((p) => p.routeProgress >= 0 && p.routeProgress <= 1)).toBe(true);
  });
});
