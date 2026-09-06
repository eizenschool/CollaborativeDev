// Boundary Value Analysis - UC6.3 GPS cross-check tolerance (100 metres).
//
// The three cases that matter are one metre inside, exactly on, and one metre
// outside the radius. "Exactly on" is the interesting one: the proposal states the
// tolerance as a radius, so a point sitting on the boundary is inside it, and that
// reading is pinned here rather than left to whoever next edits the comparison.

import { describe, expect, it } from 'vitest';
import { evaluateGpsCrossCheck, haversineDistanceM } from '../GeoVerification.js';
import { GPS_RESULT, GPS_TOLERANCE_M } from '../constants.js';

// Metres per degree of latitude, from the same mean earth radius the implementation
// uses (2 x pi x 6371000 / 360). Latitude-only offsets keep the geometry simple:
// unlike longitude, a degree of latitude is the same length everywhere.
const METRES_PER_DEG_LAT = (2 * Math.PI * 6371000) / 360;
const ORIGIN = { lat: 3.1390, lng: 101.6869 }; // Kuala Lumpur

function pointNorthOf(origin, metres) {
  return { lat: origin.lat + metres / METRES_PER_DEG_LAT, lng: origin.lng };
}

describe('haversineDistanceM', () => {
  it('returns zero for two identical points', () => {
    expect(haversineDistanceM(ORIGIN, ORIGIN)).toBeCloseTo(0, 5);
  });

  it('measures a known latitude offset to within a metre', () => {
    const distance = haversineDistanceM(ORIGIN, pointNorthOf(ORIGIN, 500));
    expect(distance).toBeGreaterThan(499);
    expect(distance).toBeLessThan(501);
  });
});

describe('evaluateGpsCrossCheck - BVA on the 100m tolerance', () => {
  it('passes at 99m (just inside the radius)', () => {
    const result = evaluateGpsCrossCheck(ORIGIN, pointNorthOf(ORIGIN, GPS_TOLERANCE_M - 1));
    expect(result.result).toBe(GPS_RESULT.PASS);
    expect(result.distanceM).toBe(99);
  });

  it('passes at exactly 100m (boundary is inclusive)', () => {
    const result = evaluateGpsCrossCheck(ORIGIN, pointNorthOf(ORIGIN, GPS_TOLERANCE_M));
    expect(result.result).toBe(GPS_RESULT.PASS);
    expect(result.distanceM).toBe(100);
  });

  it('reports a mismatch at 101m (just outside the radius)', () => {
    const result = evaluateGpsCrossCheck(ORIGIN, pointNorthOf(ORIGIN, GPS_TOLERANCE_M + 1));
    expect(result.result).toBe(GPS_RESULT.MISMATCH);
    expect(result.distanceM).toBe(101);
  });
});

describe('evaluateGpsCrossCheck - equivalence partitions for unusable input', () => {
  // UC6.3 A2: a device that cannot report a position is recorded as Unavailable and
  // must not be scored as a mismatch, otherwise switching off location services
  // would look identical to faking a pickup.
  const unusable = [
    ['null coordinates', null],
    ['undefined coordinates', undefined],
    ['missing lng', { lat: 3.139 }],
    ['non-numeric lat', { lat: 'x', lng: 101.6 }],
    ['out-of-range lat', { lat: 91, lng: 101.6 }],
    ['out-of-range lng', { lat: 3.139, lng: 181 }]
  ];

  it.each(unusable)('reports Unavailable for %s on the client side', (_label, coords) => {
    const result = evaluateGpsCrossCheck(ORIGIN, coords);
    expect(result.result).toBe(GPS_RESULT.UNAVAILABLE);
    expect(result.distanceM).toBeNull();
  });

  it.each(unusable)('reports Unavailable for %s on the host side', (_label, coords) => {
    const result = evaluateGpsCrossCheck(coords, ORIGIN);
    expect(result.result).toBe(GPS_RESULT.UNAVAILABLE);
    expect(result.distanceM).toBeNull();
  });
});
