// FR-6.15 Street View proxy inputs. Pure request parsing and URL building -
// no network, so this needs no fetch mocking at all, unlike the client-side
// version this replaced.
import { describe, expect, it } from 'vitest';
import {
  buildImageUrl, buildMetadataUrl, clampDimension, computeHeading, extractPanoramaLocation,
  hasCoverage, parseCoordinate, MAX_DIMENSION, RADIUS_METERS
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

describe('clampDimension', () => {
  it('uses the requested size when it is reasonable', () => {
    expect(clampDimension('500', 600)).toBe(500);
  });

  it('falls back to the default rather than refusing the request', () => {
    expect(clampDimension(null, 600)).toBe(600);
    expect(clampDimension('not-a-number', 600)).toBe(600);
    expect(clampDimension('-50', 600)).toBe(600);
    expect(clampDimension('0', 600)).toBe(600);
  });

  it('clamps to the free-tier ceiling rather than requesting a size Google would reject', () => {
    expect(clampDimension('4000', 600)).toBe(MAX_DIMENSION);
  });
});

describe('buildMetadataUrl / buildImageUrl', () => {
  it('builds the free metadata request, radius-limited and outdoor-only', () => {
    expect(buildMetadataUrl(3.139, 101.6869, 'server-key')).toBe(
      `https://maps.googleapis.com/maps/api/streetview/metadata?location=3.139,101.6869&radius=${RADIUS_METERS}&source=outdoor&key=server-key`
    );
  });

  it('builds the billed image request at the requested size, with the same radius/source guards', () => {
    expect(buildImageUrl(3.139, 101.6869, 600, 400, 'server-key')).toBe(
      `https://maps.googleapis.com/maps/api/streetview?location=3.139,101.6869&size=600x400&radius=${RADIUS_METERS}&source=outdoor&key=server-key`
    );
  });

  it('carries a heading when one is given', () => {
    expect(buildImageUrl(3.139, 101.6869, 600, 400, 'server-key', 271)).toContain('&heading=271');
  });

  it('omits heading entirely rather than defaulting to 0, which is a real direction', () => {
    const url = buildImageUrl(3.139, 101.6869, 600, 400, 'server-key');
    expect(url).not.toContain('heading');
  });

  it('escapes the key rather than pasting it into the query raw', () => {
    expect(buildMetadataUrl(3.139, 101.6869, 'a b&c')).toContain('key=a%20b%26c');
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
    // A panorama that landed exactly on the requested point has no meaningful
    // direction to turn toward it.
    expect(computeHeading(3.139, 101.6869, 3.139, 101.6869)).toBe(0);
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
