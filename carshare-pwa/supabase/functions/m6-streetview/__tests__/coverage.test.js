// FR-6.15 Street View coverage check. Pure request parsing, URL building and
// response interpretation - no network, so this needs no fetch mocking.
import { describe, expect, it } from 'vitest';
import {
  buildMetadataUrl, computeHeading, extractCaptureDate, extractPanoramaLocation,
  hasCoverage, parseCoordinate, RADIUS_METERS
} from '../coverage.ts';

describe('parseCoordinate', () => {
  it('parses a valid coordinate string', () => {
    expect(parseCoordinate('3.139', -90, 90)).toBe(3.139);
    expect(parseCoordinate('-101.6869', -180, 180)).toBe(-101.6869);
  });

  it('refuses a missing parameter', () => {
    expect(parseCoordinate(null, -90, 90)).toBeNull();
    expect(parseCoordinate('', -90, 90)).toBeNull();
  });

  it('refuses garbage that is not a number', () => {
    expect(parseCoordinate('not-a-number', -90, 90)).toBeNull();
    expect(parseCoordinate('NaN', -90, 90)).toBeNull();
  });

  it('refuses a coordinate outside its axis range', () => {
    expect(parseCoordinate('91', -90, 90)).toBeNull();
    expect(parseCoordinate('-181', -180, 180)).toBeNull();
  });

  it('accepts the boundary values themselves', () => {
    expect(parseCoordinate('90', -90, 90)).toBe(90);
    expect(parseCoordinate('-90', -90, 90)).toBe(-90);
  });
});

describe('buildMetadataUrl', () => {
  it('builds the free metadata request, radius-limited and outdoor-only', () => {
    expect(buildMetadataUrl(3.139, 101.6869, 'server-key')).toBe(
      `https://maps.googleapis.com/maps/api/streetview/metadata?location=3.139,101.6869&radius=${RADIUS_METERS}&source=outdoor&key=server-key`
    );
  });

  it('escapes the key rather than pasting it into the query raw', () => {
    expect(buildMetadataUrl(3.139, 101.6869, 'a b&c')).toContain('key=a%20b%26c');
  });
});

describe('hasCoverage', () => {
  it('is true only for an explicit "OK" status', () => {
    expect(hasCoverage({ status: 'OK' })).toBe(true);
  });

  it("is false for Google's documented \"no coverage here\" status", () => {
    expect(hasCoverage({ status: 'ZERO_RESULTS' })).toBe(false);
  });

  it('is false for a missing, malformed, or non-object body', () => {
    expect(hasCoverage(null)).toBe(false);
    expect(hasCoverage(undefined)).toBe(false);
    expect(hasCoverage('OK')).toBe(false);
    expect(hasCoverage({})).toBe(false);
    expect(hasCoverage({ status: null })).toBe(false);
  });
});

describe('extractPanoramaLocation', () => {
  it('reads the panorama location from a real metadata response shape', () => {
    expect(extractPanoramaLocation({ status: 'OK', location: { lat: 3.14, lng: 101.69 } }))
      .toEqual({ lat: 3.14, lng: 101.69 });
  });

  it('returns null when the response carries no location', () => {
    expect(extractPanoramaLocation({ status: 'OK' })).toBeNull();
    expect(extractPanoramaLocation({ status: 'ZERO_RESULTS' })).toBeNull();
  });

  it('returns null for a malformed or non-object location', () => {
    expect(extractPanoramaLocation({ location: null })).toBeNull();
    expect(extractPanoramaLocation({ location: 'nowhere' })).toBeNull();
    expect(extractPanoramaLocation({ location: { lat: 'nope', lng: 101.69 } })).toBeNull();
  });

  it('returns null for a missing or non-object body', () => {
    expect(extractPanoramaLocation(null)).toBeNull();
    expect(extractPanoramaLocation(undefined)).toBeNull();
    expect(extractPanoramaLocation('OK')).toBeNull();
  });
});

describe('extractCaptureDate', () => {
  it('reads the capture date when present', () => {
    expect(extractCaptureDate({ status: 'OK', date: '2019-08' })).toBe('2019-08');
  });

  it('returns null rather than an empty string when absent', () => {
    expect(extractCaptureDate({ status: 'OK' })).toBeNull();
    expect(extractCaptureDate({ status: 'OK', date: '' })).toBeNull();
    expect(extractCaptureDate({ status: 'OK', date: '   ' })).toBeNull();
  });

  it('returns null for a missing or malformed body', () => {
    expect(extractCaptureDate(null)).toBeNull();
    expect(extractCaptureDate({ date: 42 })).toBeNull();
  });
});

describe('computeHeading', () => {
  // Small deltas near the equator so the great-circle formula resolves to
  // clean cardinal bearings, which is the property under test - not floating
  // point precision at extreme latitudes.
  it('points north when the target is due north', () => {
    expect(computeHeading(0, 0, 1, 0)).toBe(0);
  });

  it('points east when the target is due east', () => {
    expect(computeHeading(0, 0, 0, 1)).toBe(90);
  });

  it('points south when the target is due south', () => {
    expect(computeHeading(0, 0, -1, 0)).toBe(180);
  });

  it('points west when the target is due west', () => {
    expect(computeHeading(0, 0, 0, -1)).toBe(270);
  });

  it('always returns a value in [0, 360)', () => {
    expect(computeHeading(5.42, 100.34, 5.41, 100.33)).toBeGreaterThanOrEqual(0);
    expect(computeHeading(5.42, 100.34, 5.41, 100.33)).toBeLessThan(360);
  });

  it('defaults to north rather than throwing for identical coordinates', () => {
    expect(computeHeading(3.139, 101.6869, 3.139, 101.6869)).toBe(0);
  });
});
