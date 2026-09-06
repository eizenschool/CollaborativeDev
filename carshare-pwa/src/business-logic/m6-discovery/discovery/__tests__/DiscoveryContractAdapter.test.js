// The anti-corruption layer between Destination Discovery and Modules 2 and 5.
//
// What is being pinned here is the *matching* behaviour, because it is the part
// most likely to silently produce an empty served list: Module 2 stores a typed
// destination string, the catalogue stores a place record, and the two rarely
// spell a location the same way.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { RideService } from '../../../m2-rides/RideService.js';
import {
  departureDates,
  getPublishedRides,
  getRidesByPlace,
  rideReferencesPlace,
  referencesPlace
} from '../DiscoveryContractAdapter.js';

const place = (id, name, aliases = [], sourcePlaceId = '') =>
  ({ id, name, rideDestinationAliases: aliases, sourcePlaceId });
const ride = (id, destination, date, seatsTotal = 4, seatsAvailable = 2, destinationPlaceId = '') =>
  ({ id, destination, date, seatsTotal, seatsAvailable, destinationPlaceId });

afterEach(() => vi.restoreAllMocks());

describe('referencesPlace', () => {
  it('matches an exact name', () => {
    expect(referencesPlace('Jonker Street', place('p', 'Jonker Street'))).toBe(true);
  });

  // The case that motivated aliases: a Host types "Georgetown, Penang" while the
  // catalogue calls it "George Town Heritage Core". Neither string contains the
  // other, so plain substring matching silently fails.
  it('matches across a spacing difference via an alias', () => {
    const georgeTown = place('p', 'George Town Heritage Core', ['Georgetown']);
    expect(referencesPlace('Georgetown, Penang', georgeTown)).toBe(true);
  });

  it('ignores case and punctuation', () => {
    expect(referencesPlace('JONKER  STREET,', place('p', 'jonker street'))).toBe(true);
  });

  it('matches when the ride destination is the broader term', () => {
    expect(referencesPlace('Melaka Sentral, Melaka', place('p', 'Jonker Street', ['Melaka Sentral']))).toBe(true);
  });

  it('does not match an unrelated destination', () => {
    expect(referencesPlace('Cyberjaya, Selangor', place('p', 'Jonker Street'))).toBe(false);
  });

  it('does not match an empty destination', () => {
    expect(referencesPlace('', place('p', 'Jonker Street'))).toBe(false);
    expect(referencesPlace(null, place('p', 'Jonker Street'))).toBe(false);
  });
});

describe('rideReferencesPlace', () => {
  const catStatue = place(
    'p_cat_statue',
    'Cat Statue, Kuching, Sarawak.',
    ['Kuching'],
    'google-cat-statue'
  );

  it('rejects a broad text match when the confirmed destination is a different place', () => {
    const waterfrontRide = ride(
      'r_waterfront', 'Kuching Waterfront', '2026-09-15', 4, 3, 'google-waterfront'
    );

    expect(rideReferencesPlace(waterfrontRide, catStatue)).toBe(false);
  });

  it('matches the confirmed destination Place ID even when its display text differs', () => {
    const exactRide = ride(
      'r_cat', 'Jalan Tunku Abdul Rahman', '2026-09-15', 4, 3, 'google-cat-statue'
    );

    expect(rideReferencesPlace(exactRide, catStatue)).toBe(true);
  });

  it('keeps text matching for a legacy ride with no confirmed destination ID', () => {
    expect(rideReferencesPlace(
      ride('r_legacy', 'Cat Statue, Kuching', '2026-09-15'),
      catStatue
    )).toBe(true);
  });
});

describe('getPublishedRides', () => {
  it('preserves the confirmed destination Place ID used for exact matching', async () => {
    vi.spyOn(RideService, 'searchRides').mockResolvedValue([{
      id: 'r_cat',
      destination: 'Kuching',
      destinationPhotoPlaceId: 'google-cat-statue',
      date: '2026-09-15',
      seatsTotal: 4,
      seatsAvailable: 3
    }]);

    await expect(getPublishedRides()).resolves.toEqual([
      expect.objectContaining({
        id: 'r_cat',
        destinationPlaceId: 'google-cat-statue'
      })
    ]);
  });
});

describe('getRidesByPlace', () => {
  const places = [
    place('p_gt', 'George Town Heritage Core', ['Georgetown']),
    place('p_jonker', 'Jonker Street', ['Melaka Sentral'])
  ];
  const rides = [
    ride('r1', 'Georgetown, Penang', '2026-08-15'),
    ride('r2', 'Melaka Sentral, Melaka', '2026-08-15'),
    ride('r3', 'Georgetown, Penang', '2026-08-20')
  ];

  it('groups rides by the place they serve', () => {
    const result = getRidesByPlace(places, rides, '2026-08-15');
    expect(result.get('p_gt').map((r) => r.id)).toEqual(['r1']);
    expect(result.get('p_jonker').map((r) => r.id)).toEqual(['r2']);
  });

  it('excludes rides on other dates', () => {
    const result = getRidesByPlace(places, rides, '2026-08-20');
    expect(result.get('p_gt').map((r) => r.id)).toEqual(['r3']);
    expect(result.has('p_jonker')).toBe(false);
  });

  it('omits places with no ride rather than mapping them to an empty array', () => {
    const result = getRidesByPlace(places, [], '2026-08-15');
    expect(result.size).toBe(0);
  });

  it('returns every matching ride when no date is given', () => {
    const result = getRidesByPlace(places, rides, null);
    expect(result.get('p_gt')).toHaveLength(2);
  });

  it('does not group a ride under a text alias when its confirmed Place ID differs', () => {
    const catStatue = place('p_cat', 'Cat Statue', ['Kuching'], 'google-cat');
    const result = getRidesByPlace([
      catStatue
    ], [
      ride('r_other', 'Kuching Waterfront', '2026-08-15', 4, 3, 'google-waterfront')
    ], null);

    expect(result.has('p_cat')).toBe(false);
  });
});

describe('departureDates', () => {
  it('returns distinct dates in ascending order', () => {
    const dates = departureDates([
      ride('r1', 'A', '2026-08-20'),
      ride('r2', 'B', '2026-08-15'),
      ride('r3', 'C', '2026-08-20')
    ]);
    expect(dates).toEqual(['2026-08-15', '2026-08-20']);
  });

  it('skips rides with no date', () => {
    expect(departureDates([ride('r1', 'A', null)])).toEqual([]);
  });

  it('survives an empty ride list', () => {
    expect(departureDates([])).toEqual([]);
  });
});
