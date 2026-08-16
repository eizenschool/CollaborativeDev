// FR-6.15 Street View proxy inputs. Pure request parsing and URL building -
// no network, so this needs no fetch mocking at all, unlike the client-side
// version this replaced.
import { describe, expect, it } from 'vitest';
import {
  buildImageUrl, buildMetadataUrl, clampDimension, hasCoverage, parseCoordinate, MAX_DIMENSION
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
  it('builds the free metadata request', () => {
    expect(buildMetadataUrl(3.139, 101.6869, 'server-key')).toBe(
      'https://maps.googleapis.com/maps/api/streetview/metadata?location=3.139,101.6869&key=server-key'
    );
  });

  it('builds the billed image request at the requested size', () => {
    expect(buildImageUrl(3.139, 101.6869, 600, 400, 'server-key')).toBe(
      'https://maps.googleapis.com/maps/api/streetview?location=3.139,101.6869&size=600x400&key=server-key'
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
