import { describe, expect, it } from 'vitest';
import { calculateCompositeHostImpact } from '../HostImpactEngine.js';
import {
  SMART_SEARCH_SORTS,
  buildSimilarSearchCriteria,
  filterAndSortRides,
  legacyRideSearchUrlFromParams,
  normalizeSmartSearchCriteria,
  smartSearchCriteriaFromParams,
  smartSearchCriteriaToParams,
  validateSmartSearchCriteria
} from '../SmartSearchService.js';

const ride = (overrides = {}) => ({
  id: overrides.id || 'ride',
  pickup: 'KL Sentral',
  destination: 'Ipoh',
  date: '2026-08-20',
  time: '09:00',
  departureAt: '2026-08-20T01:00:00.000Z',
  journeyScale: 'Intercity',
  seatsAvailable: 3,
  contribution: 'Share snacks',
  restrictionTags: ['No smoking', 'Pet-friendly'],
  status: 'Published',
  host: { completedTrips: 10, co2SavedKg: 20, reputationScore: 70, rating: 4.7 },
  ...overrides
});

describe('Module 4 smart search contracts', () => {
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
