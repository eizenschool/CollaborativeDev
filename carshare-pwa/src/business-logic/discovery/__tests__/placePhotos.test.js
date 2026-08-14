// FR-6.13/6.14 - building the live photo request.
//
// The important property is what does NOT produce a URL: a fixture reference
// must never reach Google, or the offline demo and this suite would start
// making real, billable requests. Every null here is a fall back to the
// illustration tier, never an empty slot.

import { describe, expect, it } from 'vitest';
import { buildPlacePhotoUrl, hasFetchablePhoto } from '../placePhotos.js';

const LIVE = 'places/ChIJBWbm2tM3zDERTno0px940s4/photos/AWCwydiZN7EYn-ogY9wZ4S227VDDSQ';
const KEY = { apiKey: 'test-key' };

describe('buildPlacePhotoUrl', () => {
  it('builds a media URL from a live Google reference', () => {
    const url = buildPlacePhotoUrl(LIVE, KEY);
    expect(url).toBe(
      `https://places.googleapis.com/v1/${LIVE}/media?maxWidthPx=800&key=test-key`
    );
  });

  it('carries the requested width, so a card does not pay for a huge image', () => {
    expect(buildPlacePhotoUrl(LIVE, { ...KEY, maxWidthPx: 400 })).toContain('maxWidthPx=400');
  });

  it('clamps width to what Google accepts', () => {
    expect(buildPlacePhotoUrl(LIVE, { ...KEY, maxWidthPx: 99999 })).toContain('maxWidthPx=4800');
    expect(buildPlacePhotoUrl(LIVE, { ...KEY, maxWidthPx: 0 })).toContain('maxWidthPx=1');
  });

  // The load-bearing one. Fixture references are placeholders, not resource
  // names; sending one to Google would be a paid request for a 404.
  it('refuses a fixture placeholder', () => {
    expect(buildPlacePhotoUrl('fixture:georgetown-1', KEY)).toBeNull();
  });

  it('refuses anything that is not a photo resource name', () => {
    expect(buildPlacePhotoUrl('places/ChIJabc', KEY)).toBeNull();
    expect(buildPlacePhotoUrl('https://example.com/photo.jpg', KEY)).toBeNull();
    expect(buildPlacePhotoUrl('', KEY)).toBeNull();
    expect(buildPlacePhotoUrl(null, KEY)).toBeNull();
    expect(buildPlacePhotoUrl(undefined, KEY)).toBeNull();
  });

  it('returns null with no key configured, rather than a URL that would 403', () => {
    expect(buildPlacePhotoUrl(LIVE, { apiKey: '' })).toBeNull();
  });

  it('escapes the key rather than pasting it into the query raw', () => {
    expect(buildPlacePhotoUrl(LIVE, { apiKey: 'a b&c' })).toContain('key=a%20b%26c');
  });
});

describe('hasFetchablePhoto', () => {
  // No key is configured under test, so nothing is fetchable - which is exactly
  // the guarantee that keeps the suite off the network.
  it('is false for a place holding only fixture references', () => {
    expect(hasFetchablePhoto({ photoReferences: [{ reference: 'fixture:a' }] })).toBe(false);
  });

  it('is false for a place with no photos at all', () => {
    expect(hasFetchablePhoto({ photoReferences: [] })).toBe(false);
    expect(hasFetchablePhoto({})).toBe(false);
    expect(hasFetchablePhoto(null)).toBe(false);
  });
});
