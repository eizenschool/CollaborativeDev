import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateCompositeHostImpact } from '../HostImpactEngine.js';
import { RideService } from '../RideService.js';
import {
  SEARCH_PROXIMITY_RADII,
  SMART_SEARCH_SORTS,
  SmartSearchService,
  applyManualDestinationText,
  buildSimilarSearchCriteria,
  expandProximityCriteria,
  filterAndSortRides,
  legacyRideSearchUrlFromParams,
  normalizeSmartSearchCriteria,
  smartSearchCriteriaFromParams,
  smartSearchCriteriaToParams,
  validateSmartSearchCriteria
} from '../SmartSearchService.js';

vi.mock('../RideService.js', () => ({
  RideService: {
    backend: 'mock',
    searchRides: vi.fn()
  }
}));

const ride = (overrides = {}) => ({
  id: overrides.id || 'ride',
  pickup: 'KL Sentral',
  destination: 'Ipoh',
  date: '2026-08-20',
  time: '09:00',
  departureAt: '2026-08-20T01:00:00.000Z',
  journeyScale: 'Intercity',
  vehicleType: 'suv',
  seatsAvailable: 3,
  contribution: 'Share snacks',
  restrictionTags: ['No smoking', 'Pet-friendly'],
  status: 'Published',
  host: { completedTrips: 10, co2SavedKg: 20, reputationScore: 70, rating: 4.7, spokenLanguages: ['english', 'malay'] },
  ...overrides
});

describe('Module 4 smart search contracts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('normalizes criteria and preserves each repeated restriction tag in URLs', () => {
    const normalized = normalizeSmartSearchCriteria({
      pickup: ' KL Sentral ', minSeats: '2', tags: ['No smoking', 'No smoking', 'Pet-friendly']
    });
    const params = smartSearchCriteriaToParams(normalized);
    const restored = smartSearchCriteriaFromParams(params);

    expect(restored.pickup).toBe('KL Sentral');
    expect(restored.minSeats).toBe(2);
    expect(restored.tags).toEqual(['No smoking', 'Pet-friendly']);
    expect(params.getAll('tag')).toEqual(['No smoking', 'Pet-friendly']);
  });

  it('translates legacy Ride search parameters to the canonical public Search URL', () => {
    const url = legacyRideSearchUrlFromParams('?from=KL+Sentral&to=Kellie%27s+Castle+%26+Gardens&date=2026-08-20');
    const [path, query] = url.split('?');
    const params = new URLSearchParams(query);

    expect(path).toBe('/search');
    expect(params.get('pickup')).toBe('KL Sentral');
    expect(params.get('destination')).toBe("Kellie's Castle & Gardens");
    expect(params.get('date')).toBe('2026-08-20');
  });

  it('normalizes and round-trips one vehicle category and preferred language', () => {
    const params = smartSearchCriteriaToParams({ vehicleType: ' SUV ', language: 'English' });
    expect(params.get('vehicleType')).toBe('suv');
    expect(params.get('language')).toBe('english');
    expect(smartSearchCriteriaFromParams(params)).toMatchObject({ vehicleType: 'suv', language: 'english' });
    expect(normalizeSmartSearchCriteria({ vehicleType: 'spaceship', language: 'klingon' }))
      .toMatchObject({ vehicleType: '', language: '' });
  });

  it('defaults recommendation links to 10 km and round-trips supported radii', () => {
    const legacyPlaceHint = smartSearchCriteriaFromParams('destination=Jonker+Street&destinationPlaceId=fixture_jonker');
    expect(legacyPlaceHint.proximityKm).toBe(10);

    for (const radius of SEARCH_PROXIMITY_RADII) {
      const criteria = normalizeSmartSearchCriteria({
        destination: 'Jonker Street', destinationPlaceId: 'fixture_jonker', proximityKm: radius
      });
      expect(smartSearchCriteriaFromParams(smartSearchCriteriaToParams(criteria)).proximityKm).toBe(radius);
    }
  });

  it('normalizes invalid radii and removes proximity when the place hint is missing', () => {
    expect(normalizeSmartSearchCriteria({ destinationPlaceId: 'fixture_jonker', proximityKm: 9 }).proximityKm).toBe(10);
    expect(normalizeSmartSearchCriteria({ proximityKm: 25 })).toMatchObject({ destinationPlaceId: '', proximityKm: 0 });
  });

  it('clears the place hint after a manual edit and expands empty proximity searches predictably', () => {
    const selected = normalizeSmartSearchCriteria({
      pickup: 'KL Sentral',
      destination: 'Jonker Street',
      destinationPlaceId: 'fixture_jonker',
      proximityKm: 5,
      tags: ['No smoking']
    });
    expect(applyManualDestinationText(selected, 'Melaka')).toMatchObject({
      pickup: 'KL Sentral', destination: 'Melaka', destinationPlaceId: '', proximityKm: 0,
      tags: ['No smoking']
    });
    expect(expandProximityCriteria(selected).proximityKm).toBe(10);
    expect(expandProximityCriteria({ ...selected, proximityKm: 10 }).proximityKm).toBe(25);
    expect(expandProximityCriteria({ ...selected, proximityKm: 25 })).toMatchObject({
      destination: 'Jonker Street', destinationPlaceId: '', proximityKm: 0
    });
  });

  it('redirects empty legacy criteria to bare Search and ignores ordinary Ride URLs', () => {
    expect(legacyRideSearchUrlFromParams('?from=&to=&date=')).toBe('/search');
    expect(legacyRideSearchUrlFromParams('?panel=hosting')).toBeNull();
    expect(legacyRideSearchUrlFromParams('')).toBeNull();
  });

  it('rejects past dates and invalid Kuala Lumpur departure times', () => {
    const now = new Date('2026-08-13T12:00:00.000Z');
    expect(() => validateSmartSearchCriteria({ date: '2026-08-12' }, { now })).toThrow('past');
    expect(() => validateSmartSearchCriteria({ date: '2026-08-13', departAfter: '25:00' }, { now })).toThrow('departure time');
    expect(validateSmartSearchCriteria({ date: '2026-08-14', departAfter: '07:30' }, { now }).departAfter).toBe('07:30');
  });

  it('applies current-data filters with AND semantics for restriction tags', () => {
    const candidates = [
      ride({ id: 'match' }),
      ride({ id: 'one-tag', restrictionTags: ['No smoking'] }),
      ride({ id: 'few-seats', seatsAvailable: 1 }),
      ride({ id: 'low-rating', host: { completedTrips: 10, co2SavedKg: 20, reputationScore: 70, rating: 4.1 } }),
      ride({ id: 'unavailable', status: 'Matched' })
    ];
    const result = filterAndSortRides(candidates, {
      minSeats: 2,
      minRating: 4.5,
      journeyScale: 'Intercity',
      contribution: 'snacks',
      tags: ['No smoking', 'Pet-friendly']
    });
    expect(result.map((item) => item.id)).toEqual(['match']);
  });

  it('matches exact vehicle and Host-language compatibility while excluding unknown legacy values', () => {
    const result = filterAndSortRides([
      ride({ id: 'compatible', vehicleType: 'suv' }),
      ride({ id: 'wrong-vehicle', vehicleType: 'sedan' }),
      ride({ id: 'wrong-language', host: { completedTrips: 10, rating: 4.7, spokenLanguages: ['tamil'] } }),
      ride({ id: 'legacy', vehicleType: '', host: { completedTrips: 10, rating: 4.7, spokenLanguages: [] } })
    ], { vehicleType: 'suv', language: 'english' });

    expect(result.map((item) => item.id)).toEqual(['compatible']);
    expect(filterAndSortRides([ride({ id: 'legacy-any', vehicleType: '', host: { spokenLanguages: [] } })], {}))
      .toHaveLength(1);
  });

  it('skips destination substring matching only while proximity mode is active', () => {
    expect(filterAndSortRides([
      ride({ id: 'nearby', destination: 'Melaka Sentral', proximityDistanceKm: 3.2 })
    ], {
      destination: 'Jonker Street', destinationPlaceId: 'fixture_jonker', proximityKm: 5
    }).map((item) => item.id)).toEqual(['nearby']);

    expect(filterAndSortRides([
      ride({ id: 'exact-mode', destination: 'Melaka Sentral' })
    ], { destination: 'Jonker Street' })).toEqual([]);
  });

  it('matches mock rides by confirmed catalogue destination and strips private locations', async () => {
    RideService.searchRides.mockResolvedValue([
      ride({
        id: 'near-jonker',
        destination: 'Melaka Sentral',
        destinationLocation: { placeId: 'fixture_jonker' },
        pickupLocation: { latitude: 3.13, longitude: 101.68 },
        pickupInstructions: 'Private meeting point',
        waypoints: [{ placeId: 'private_stop' }]
      }),
      ride({
        id: 'far-away',
        destinationLocation: { placeId: 'fixture_georgetown' }
      })
    ]);

    const result = await SmartSearchService.search({
      pickup: 'KL',
      destination: 'Jonker Street',
      destinationPlaceId: 'fixture_jonker',
      proximityKm: 5,
      minSeats: 2,
      tags: ['No smoking']
    });

    expect(RideService.searchRides).toHaveBeenCalledWith({
      from: 'KL',
      to: '',
      date: '',
      proximity: { destinationPlaceId: 'fixture_jonker', radiusKm: 5 },
      compatibility: null
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'near-jonker', proximityDistanceKm: 0 });
    expect(result[0]).not.toHaveProperty('destinationLocation');
    expect(result[0]).not.toHaveProperty('pickupLocation');
    expect(result[0]).not.toHaveProperty('pickupInstructions');
    expect(result[0]).not.toHaveProperty('waypoints');
  });

  it('passes selected compatibility filters through the shared Ride service contract', async () => {
    RideService.searchRides.mockResolvedValue([ride({ id: 'compatible' })]);

    await SmartSearchService.search({ vehicleType: 'suv', language: 'english' });

    expect(RideService.searchRides).toHaveBeenCalledWith({
      from: '',
      to: '',
      date: '',
      proximity: null,
      compatibility: { vehicleType: 'suv', language: 'english' }
    });
  });

  it('rejects stale or unknown recommendation place hints', async () => {
    await expect(SmartSearchService.search({
      destination: 'Missing place', destinationPlaceId: 'not_in_catalogue'
    })).rejects.toThrow('no longer available');
    expect(RideService.searchRides).not.toHaveBeenCalled();
  });

  it('filters after a local departure time and sorts deterministically by departure', () => {
    const result = filterAndSortRides([
      ride({ id: 'late', time: '11:00', departureAt: '2026-08-20T03:00:00.000Z' }),
      ride({ id: 'early', time: '08:00', departureAt: '2026-08-20T00:00:00.000Z' }),
      ride({ id: 'middle', time: '10:00', departureAt: '2026-08-20T02:00:00.000Z' })
    ], { departAfter: '09:00' });
    expect(result.map((item) => item.id)).toEqual(['middle', 'late']);
  });

  it('sorts by the shared Composite Host Impact formula with departure as tie-breaker', () => {
    const highStats = { completedTrips: 50, co2SavedKg: 100, reputationScore: 90, rating: 4.8 };
    const lowStats = { completedTrips: 1, co2SavedKg: 1, reputationScore: 50, rating: 5 };
    const result = filterAndSortRides([
      ride({ id: 'tie-late', departureAt: '2026-08-20T03:00:00.000Z', host: highStats }),
      ride({ id: 'low', departureAt: '2026-08-20T00:00:00.000Z', host: lowStats }),
      ride({ id: 'tie-early', departureAt: '2026-08-20T02:00:00.000Z', host: highStats })
    ], { sort: SMART_SEARCH_SORTS.HOST_IMPACT });
    expect(calculateCompositeHostImpact(highStats)).toBeGreaterThan(calculateCompositeHostImpact(lowStats));
    expect(result.map((item) => item.id)).toEqual(['tie-early', 'tie-late', 'low']);
  });

  it('drops expired date and time when building an alternative search', () => {
    const criteria = buildSimilarSearchCriteria(ride({ date: '2026-08-10', time: '09:00' }), {
      now: new Date('2026-08-13T00:00:00.000Z')
    });
    expect(criteria).toMatchObject({ pickup: 'KL Sentral', destination: 'Ipoh', journeyScale: 'Intercity', date: '', departAfter: '' });
  });
});
