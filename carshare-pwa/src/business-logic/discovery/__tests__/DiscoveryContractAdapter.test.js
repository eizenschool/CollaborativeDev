// The anti-corruption layer between Destination Discovery and Modules 2 and 5.
//
// What is being pinned here is the *matching* behaviour, because it is the part
// most likely to silently produce an empty served list: Module 2 stores a typed
// destination string, the catalogue stores a place record, and the two rarely
// spell a location the same way.

import { describe, expect, it } from 'vitest';
import {
  departureDates,
  getRidesByPlace,
  referencesPlace
} from '../DiscoveryContractAdapter.js';

const place = (id, name, aliases = []) => ({ id, name, rideDestinationAliases: aliases });
const ride = (id, destination, date, seatsTotal = 4, seatsAvailable = 2) =>
  ({ id, destination, date, seatsTotal, seatsAvailable });

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
