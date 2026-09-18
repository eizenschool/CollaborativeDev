// Great-circle distance for the journey-cost signal, checked against known
// Malaysian city pairs rather than against itself.

import { describe, expect, it } from 'vitest';
import { distanceKm, isUsablePoint, maxDistanceKm } from '../geo.js';

const KL = { lat: 3.1390, lng: 101.6869 };
const PENANG = { lat: 5.4141, lng: 100.3288 };
const JOHOR_BAHRU = { lat: 1.4927, lng: 103.7414 };

describe('isUsablePoint', () => {
  it('accepts a valid coordinate pair', () => {
    expect(isUsablePoint(KL)).toBe(true);
  });

  it('rejects out-of-range latitude or longitude', () => {
    expect(isUsablePoint({ lat: 91, lng: 0 })).toBe(false);
    expect(isUsablePoint({ lat: 0, lng: 181 })).toBe(false);
  });

  it('rejects missing or non-numeric input', () => {
    expect(isUsablePoint(null)).toBe(false);
    expect(isUsablePoint({})).toBe(false);
    expect(isUsablePoint({ lat: 'three', lng: 101 })).toBe(false);
  });
});

describe('distanceKm', () => {
  // KL to George Town is roughly 300 km great-circle; 5% tolerance covers the
  // difference between earth-radius conventions without letting a real error pass.
  it('matches the known KL - Penang distance', () => {
    expect(distanceKm(KL, PENANG)).toBeGreaterThan(285);
    expect(distanceKm(KL, PENANG)).toBeLessThan(315);
  });

  it('matches the known KL - Johor Bahru distance', () => {
    expect(distanceKm(KL, JOHOR_BAHRU)).toBeGreaterThan(280);
    expect(distanceKm(KL, JOHOR_BAHRU)).toBeLessThan(320);
  });

  it('returns zero for a point to itself', () => {
    expect(distanceKm(KL, KL)).toBeCloseTo(0, 6);
  });

  it('is symmetric', () => {
    expect(distanceKm(KL, PENANG)).toBeCloseTo(distanceKm(PENANG, KL), 9);
  });

  // Null, not 0: a missing origin means the distance is unknown, and scoring it
  // as "right here" would push every candidate to the top of the journey-cost
  // axis on the strength of absent information.
  it('returns null rather than zero when either point is unusable', () => {
    expect(distanceKm(null, PENANG)).toBeNull();
    expect(distanceKm(KL, undefined)).toBeNull();
    expect(distanceKm({ lat: 999, lng: 0 }, PENANG)).toBeNull();
  });
});

describe('maxDistanceKm', () => {
  it('returns the greatest usable distance', () => {
    expect(maxDistanceKm([12, 340, 88])).toBe(340);
  });

  it('skips nulls and zeroes rather than counting them', () => {
    expect(maxDistanceKm([null, 0, 45, undefined])).toBe(45);
  });

  it('returns 0 for an empty or fully unusable set', () => {
    expect(maxDistanceKm([])).toBe(0);
    expect(maxDistanceKm([null, undefined])).toBe(0);
  });
});
