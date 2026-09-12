import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_ORIGIN,
  discoveryFilters,
  matchingCandidates,
  normalizeOrigin,
  trafficText,
  validTravelDate
} from '../DiscoveryJourney.js';

const storage = new Map();
globalThis.sessionStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear()
};

describe('DiscoveryJourney', () => {
  beforeEach(() => storage.clear());

  it('keeps a valid selected calendar date even when that date has no rides', () => {
    expect(validTravelDate('2030-01-01')).toBe(true);
    expect(discoveryFilters(new URLSearchParams('date=2030-01-01')).date).toBe('2030-01-01');
  });

  it('rejects malformed calendar dates and falls back to the local date', () => {
    expect(validTravelDate('2030-02-30')).toBe(false);
    expect(discoveryFilters(new URLSearchParams('date=not-a-date')).date).not.toBe('not-a-date');
  });

  it('normalises the location shape returned by the shared location component', () => {
    expect(normalizeOrigin({
      label: 'George Town, Penang', placeId: 'place-1', latitude: 5.4141, longitude: 100.3288
    })).toEqual({
      label: 'George Town, Penang', placeId: 'place-1', lat: 5.4141, lng: 100.3288, isDefault: false
    });
    expect(DEFAULT_ORIGIN.isDefault).toBe(true);
  });

  it('applies category and text filters to every result group', () => {
    const rows = [
      { place: { name: 'Kek Lok Si', state: 'Penang', category: 'heritage' } },
      { place: { name: 'Taman Negara', state: 'Pahang', category: 'nature' } }
    ];
    expect(matchingCandidates(rows, 'nature', 'pahang')).toEqual([rows[1]]);
    expect(matchingCandidates(rows, 'culinary', '')).toEqual([]);
  });

  it('separates unknown ride information from a date with no listed ride', () => {
    expect(trafficText([], 'unavailable')).toBe('Ride information unavailable');
    expect(trafficText([])).toBe('No listed ride for this date');
    expect(trafficText([{ seatsAvailable: 2 }, { seatsAvailable: 0 }]))
      .toBe('2 listed rides · up to 2 seats in one ride');
    expect(trafficText([{ seatsAvailable: 0 }]))
      .toBe('1 listed ride · no seats remaining');
    expect(trafficText([{ seatsAvailable: 1 }]))
      .toBe('1 listed ride · up to 1 seat in one ride');
  });
});
