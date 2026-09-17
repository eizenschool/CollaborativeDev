import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateCompositeHostImpact } from '../../m1-profile/HostImpactEngine.js';
import { RideService } from '../../m2-rides/RideService.js';
import { resolveLocationPlaceId } from '../../shared/GooglePlacesService.js';
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

vi.mock('../../m2-rides/RideService.js', () => ({
  RideService: {
    backend: 'mock',
    searchRides: vi.fn(),
    searchMultiLegRides: vi.fn()
  }
}));

vi.mock('../../shared/GooglePlacesService.js', () => ({
  resolveLocationPlaceId: vi.fn()
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
  beforeEach(() => {
    vi.clearAllMocks();
    resolveLocationPlaceId.mockResolvedValue({
      placeId: 'google-destination', latitude: 3.139, longitude: 101.6869
    });
  });

  it('normalizes criteria and preserves each repeated restriction tag in URLs', () => {
    const normalized = normalizeSmartSearchCriteria({
      pickup: ' KL Sentral ', pickupPlaceId: ' google-kl-sentral ',
      minSeats: '2', tags: ['No smoking', 'No smoking', 'Pet-friendly']
    });
    const params = smartSearchCriteriaToParams(normalized);
    const restored = smartSearchCriteriaFromParams(params);

    expect(restored.pickup).toBe('KL Sentral');
    expect(restored.pickupPlaceId).toBe('google-kl-sentral');
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

  it('keeps confirmed recommendations exact by default and round-trips supported radii', () => {
    const legacyPlaceHint = smartSearchCriteriaFromParams('destination=Jonker+Street&destinationPlaceId=fixture_jonker');
    expect(legacyPlaceHint.proximityKm).toBe(0);

    for (const radius of SEARCH_PROXIMITY_RADII) {
      const criteria = normalizeSmartSearchCriteria({
        destination: 'Jonker Street', destinationPlaceId: 'fixture_jonker', proximityKm: radius
      });
      expect(smartSearchCriteriaFromParams(smartSearchCriteriaToParams(criteria)).proximityKm).toBe(radius);
    }
  });

  it('normalizes invalid radii and removes proximity when the place hint is missing', () => {
    expect(normalizeSmartSearchCriteria({ destination: 'Jonker Street', destinationPlaceId: 'fixture_jonker', proximityKm: 9 }).proximityKm).toBe(0);
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
      pickup: 'KL Sentral', destination: 'Melaka', destinationSearchPlaceId: '', destinationPlaceId: '', proximityKm: 0,
      tags: ['No smoking']
    });
    expect(applyManualDestinationText(selected, 'Melaka Sentral', 'google-melaka-sentral')).toMatchObject({
      destination: 'Melaka Sentral', destinationSearchPlaceId: 'google-melaka-sentral',
      destinationPlaceId: '', proximityKm: 0
    });
    expect(expandProximityCriteria(selected).proximityKm).toBe(10);
    expect(expandProximityCriteria({ ...selected, proximityKm: 10 }).proximityKm).toBe(25);
    expect(expandProximityCriteria({ ...selected, proximityKm: 25 })).toMatchObject({
      destination: 'Jonker Street', destinationSearchPlaceId: '', destinationPlaceId: 'fixture_jonker', proximityKm: 0
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

  it('requires a Google suggestion for each non-empty ordinary route field', () => {
    expect(() => validateSmartSearchCriteria({ pickup: 'KL Sentral' }))
      .toThrow('Choose a pickup');
    expect(() => validateSmartSearchCriteria({ destination: 'Ipoh' }))
      .toThrow('Choose a destination');
    expect(validateSmartSearchCriteria({
      pickup: 'KL Sentral', pickupPlaceId: 'google-kl',
      destination: 'Ipoh', destinationSearchPlaceId: 'google-ipoh'
    })).toMatchObject({ pickupPlaceId: 'google-kl', destinationSearchPlaceId: 'google-ipoh' });
    expect(validateSmartSearchCriteria({
      destination: 'Jonker Street', destinationPlaceId: 'fixture_jonker', proximityKm: 10
    }).destinationPlaceId).toBe('fixture_jonker');
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
        destinationAnchor: { latitude: 2.1958, longitude: 102.2486 },
        pickupLocation: { latitude: 3.13, longitude: 101.68 },
        pickupInstructions: 'Private meeting point',
        waypoints: [{ placeId: 'private_stop' }]
      }),
      ride({
        id: 'far-away',
        destinationLocation: { placeId: 'fixture_georgetown' },
        destinationAnchor: { latitude: 5.4141, longitude: 100.3288 }
      })
    ]);

    const result = await SmartSearchService.search({
      pickup: 'KL',
      pickupPlaceId: 'google-kl',
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
      proximity: {
        destinationPlaceId: 'fixture_jonker',
        center: { lat: 2.1958, lng: 102.2486 },
        radiusKm: 5
      },
      confirmedLocations: { pickupPlaceId: 'google-kl', destinationPlaceId: '' },
      compatibility: null
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'near-jonker', proximityDistanceKm: 0 });
    expect(result[0]).not.toHaveProperty('destinationLocation');
    expect(result[0]).not.toHaveProperty('pickupLocation');
    expect(result[0]).not.toHaveProperty('pickupInstructions');
    expect(result[0]).not.toHaveProperty('waypoints');
    expect(result[0]).not.toHaveProperty('destinationAnchor');
  });

  it('passes selected compatibility filters through the shared Ride service contract', async () => {
    RideService.searchRides.mockResolvedValue([ride({ id: 'compatible' })]);

    await SmartSearchService.search({ vehicleType: 'suv', language: 'english' });

    expect(RideService.searchRides).toHaveBeenCalledWith({
      from: '',
      to: '',
      date: '',
      proximity: null,
      confirmedLocations: null,
      compatibility: { vehicleType: 'suv', language: 'english' }
    });
  });

  it('uses an exact confirmed recommendation without silently enabling radius search', async () => {
    RideService.searchRides.mockResolvedValue([]);
    await SmartSearchService.search({
      destination: 'Jonker Street', destinationPlaceId: 'fixture_jonker'
    });
    expect(RideService.searchRides).toHaveBeenCalledWith(expect.objectContaining({
      proximity: null,
      confirmedLocations: { pickupPlaceId: '', destinationPlaceId: 'fixture_jonker' }
    }));
  });

  it('resolves a reloaded Google destination only when radius matching is requested', async () => {
    RideService.searchRides.mockResolvedValue([]);

    await SmartSearchService.search({
      destination: 'KLCC', destinationSearchPlaceId: 'google-klcc', proximityKm: 10
    });

    expect(resolveLocationPlaceId).toHaveBeenCalledWith('google-klcc');
    expect(RideService.searchRides).toHaveBeenCalledWith(expect.objectContaining({
      proximity: {
        destinationSearchPlaceId: 'google-klcc',
        center: { lat: 3.139, lng: 101.6869 },
        radiusKm: 10
      }
    }));
  });

  it('keeps coordinates transient while preserving the confirmed destination and radius in the URL', () => {
    const criteria = normalizeSmartSearchCriteria({
      destination: 'KLCC', destinationSearchPlaceId: 'google-klcc',
      destinationLatitude: 3.1579, destinationLongitude: 101.7123, proximityKm: 25
    });
    const params = smartSearchCriteriaToParams(criteria);

    expect(params.get('destinationSearchPlaceId')).toBe('google-klcc');
    expect(params.get('proximityKm')).toBe('25');
    expect(params.toString()).not.toMatch(/latitude|longitude|3\.1579|101\.7123/i);
  });

  it('includes the mock radius boundary and excludes rides without verified destination anchors', async () => {
    RideService.searchRides.mockResolvedValue([
      ride({
        id: 'boundary', destination: 'Nearby',
        destinationLocation: { placeId: 'nearby' },
        destinationAnchor: { latitude: 0, longitude: 0.044966 }
      }),
      ride({ id: 'unverified', destination: 'Unknown', destinationLocation: { placeId: 'unknown' } })
    ]);

    const result = await SmartSearchService.search({
      destination: 'Selected place', destinationSearchPlaceId: 'google-selected',
      destinationLatitude: 0, destinationLongitude: 0, proximityKm: 5
    });

    expect(result.map((item) => item.id)).toEqual(['boundary']);
    expect(result[0].proximityDistanceKm).toBe(5);
  });

  it('filters after a local departure time and sorts deterministically by departure', () => {
    const result = filterAndSortRides([
      ride({ id: 'late', time: '11:00', departureAt: '2026-08-20T03:00:00.000Z' }),
      ride({ id: 'early', time: '08:00', departureAt: '2026-08-20T00:00:00.000Z' }),
      ride({ id: 'middle', time: '10:00', departureAt: '2026-08-20T02:00:00.000Z' })
    ], { departAfter: '09:00' });
    expect(result.map((item) => item.id)).toEqual(['middle', 'late']);
  });

  it('matches confirmed mock endpoints exactly and uses text only for legacy rides without IDs', async () => {
    RideService.searchRides.mockResolvedValue([
      ride({
        id: 'exact', pickup: 'KL Sentral', destination: 'Ipoh Station',
        pickupLocation: { placeId: 'google-kl' }, destinationLocation: { placeId: 'google-ipoh' }
      }),
      ride({
        id: 'different-id', pickup: 'KL Sentral', destination: 'Ipoh Station',
        pickupLocation: { placeId: 'google-other-kl' }, destinationLocation: { placeId: 'google-ipoh' }
      }),
      ride({
        id: 'legacy', pickup: 'KL Sentral entrance', destination: 'Ipoh Station',
        pickupLocation: null, destinationLocation: null
      })
    ]);

    const result = await SmartSearchService.search({
      pickup: 'KL Sentral', pickupPlaceId: 'google-kl',
      destination: 'Ipoh Station', destinationSearchPlaceId: 'google-ipoh'
    });

    expect(result.map((item) => item.id)).toEqual(['exact', 'legacy']);
    expect(RideService.searchRides).toHaveBeenCalledWith(expect.objectContaining({
      confirmedLocations: { pickupPlaceId: 'google-kl', destinationPlaceId: 'google-ipoh' }
    }));
    expect(result[0]).not.toHaveProperty('pickupLocation');
    expect(result[0]).not.toHaveProperty('destinationLocation');
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

  it('returns a two-leg fallback only when no suitable direct ride remains', async () => {
    const first = ride({
      id: 'leg-one',
      pickupLocation: { placeId: 'google-kl' },
      destination: 'George Town Heritage Core',
      destinationLocation: { placeId: 'fixture_georgetown' },
      departureAt: '2099-09-10T00:00:00.000Z',
      date: '2099-09-10', time: '08:00', journeyScale: 'Urban',
      estimatedArrivalAt: '2099-09-10T02:00:00.000Z'
    });
    const second = ride({
      id: 'leg-two',
      pickup: 'George Town Heritage Core',
      pickupLocation: { placeId: 'fixture_georgetown' },
      destination: 'Ipoh Station',
      destinationLocation: { placeId: 'google-ipoh' },
      departureAt: '2099-09-10T02:30:00.000Z',
      date: '2099-09-10', time: '10:30', journeyScale: 'Urban',
      estimatedArrivalAt: '2099-09-10T04:00:00.000Z'
    });
    RideService.searchRides.mockResolvedValueOnce([]).mockResolvedValueOnce([first, second]);

    const result = await SmartSearchService.search({
      pickup: 'KL', pickupPlaceId: 'google-kl',
      destination: 'Ipoh', destinationSearchPlaceId: 'google-ipoh', date: '2099-09-10',
      minSeats: 2, tags: ['No smoking']
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'multileg:leg-one:leg-two', journeyType: 'multi-leg', waitMinutes: 30
    });
    expect(RideService.searchRides).toHaveBeenCalledTimes(2);
  });
});
