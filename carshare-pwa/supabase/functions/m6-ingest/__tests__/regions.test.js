// The sweep's region list, made explicit for the first time - previously
// only Kuala Lumpur's circle existed anywhere in code, and it carried a real
// bug (id "kuala-lumpur" paired with state "Selangor").
import { describe, it, expect } from 'vitest';
import { SWEEP_REGIONS, isWithinSweptRegions } from '../regions.ts';

describe('SWEEP_REGIONS', () => {
  it('gives every region a non-empty state, matching its own id', () => {
    const byId = Object.fromEntries(SWEEP_REGIONS.map((r) => [r.id, r.state]));
    expect(byId['kuala-lumpur']).toBe('Kuala Lumpur');
    expect(byId.penang).toBe('Penang');
    expect(byId.melaka).toBe('Melaka');
    expect(byId.selangor).toBe('Selangor');
  });

  it('keeps every coordinate within valid range', () => {
    for (const region of SWEEP_REGIONS) {
      expect(region.latitude).toBeGreaterThanOrEqual(-90);
      expect(region.latitude).toBeLessThanOrEqual(90);
      expect(region.longitude).toBeGreaterThanOrEqual(-180);
      expect(region.longitude).toBeLessThanOrEqual(180);
    }
  });

  it('never exceeds the 50 km radius index.ts clamps a caller-supplied region to', () => {
    for (const region of SWEEP_REGIONS) {
      expect(region.radiusMeters).toBeLessThanOrEqual(50_000);
      expect(region.radiusMeters).toBeGreaterThan(0);
    }
  });

  it('covers four distinct region ids with no duplicates', () => {
    const ids = SWEEP_REGIONS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('isWithinSweptRegions', () => {
  it('is true exactly at a region\'s own centre', () => {
    const kl = SWEEP_REGIONS.find((r) => r.id === 'kuala-lumpur');
    expect(isWithinSweptRegions(kl.latitude, kl.longitude)).toBe(true);
  });

  it('is true a few kilometres from a centre, well inside the 50 km radius', () => {
    const kl = SWEEP_REGIONS.find((r) => r.id === 'kuala-lumpur');
    // Roughly 5km north - short of a degree of latitude, comfortably inside.
    expect(isWithinSweptRegions(kl.latitude + 0.045, kl.longitude)).toBe(true);
  });

  it('is false for a coordinate outside every circle - e.g. Kota Kinabalu, Sabah', () => {
    expect(isWithinSweptRegions(5.9804, 116.0735)).toBe(false);
  });

  it('is false for a non-finite coordinate rather than throwing', () => {
    expect(isWithinSweptRegions(NaN, 101.6869)).toBe(false);
    expect(isWithinSweptRegions(3.139, undefined)).toBe(false);
  });

  it('accepts an explicit region list instead of the default sweep set', () => {
    const onlyPenang = [SWEEP_REGIONS.find((r) => r.id === 'penang')];
    const kl = SWEEP_REGIONS.find((r) => r.id === 'kuala-lumpur');
    expect(isWithinSweptRegions(kl.latitude, kl.longitude, onlyPenang)).toBe(false);
  });
});
