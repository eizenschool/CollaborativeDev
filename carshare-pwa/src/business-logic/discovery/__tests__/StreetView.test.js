// FR-6.15 - the client side of the Street View proxy. Pure URL building, no
// fetch mocking needed: the metadata-first coverage check now happens inside
// the Supabase Edge Function (supabase/functions/m6-streetview), not here. No
// Supabase project is configured under test, so every builder returns null
// unless a test explicitly passes a base URL - the same "off by default, on
// only when configured" guarantee placePhotos.test.js pins for Place Photos.

import { describe, expect, it } from 'vitest';
import { buildStreetViewProxyUrl, hasStreetViewProxy } from '../StreetView.js';

const SUPABASE = { baseUrl: 'https://pnetstmovctfwqcumodx.supabase.co' };
const KL = { lat: 3.139, lng: 101.6869 };

describe('hasStreetViewProxy', () => {
  it('is false with no Supabase project configured, which is the fixture-mode state', () => {
    expect(hasStreetViewProxy('')).toBe(false);
    expect(hasStreetViewProxy(undefined)).toBe(false);
  });

  it('is true once a Supabase URL is supplied', () => {
    expect(hasStreetViewProxy(SUPABASE.baseUrl)).toBe(true);
  });
});

describe('buildStreetViewProxyUrl', () => {
  it('builds the proxy request at the default size', () => {
    expect(buildStreetViewProxyUrl(KL.lat, KL.lng, SUPABASE)).toBe(
      'https://pnetstmovctfwqcumodx.supabase.co/functions/v1/m6-streetview?lat=3.139&lng=101.6869&w=600&h=400'
    );
  });

  it('carries a requested size', () => {
    const url = buildStreetViewProxyUrl(KL.lat, KL.lng, { ...SUPABASE, width: 500, height: 300 });
    expect(url).toContain('w=500&h=300');
  });

  it('clamps to the free-tier ceiling rather than requesting a size Google would reject', () => {
    const url = buildStreetViewProxyUrl(KL.lat, KL.lng, { ...SUPABASE, width: 4000, height: 4000 });
    expect(url).toContain('w=640&h=640');
  });

  it('tolerates a trailing slash on the configured Supabase URL', () => {
    const url = buildStreetViewProxyUrl(KL.lat, KL.lng, { baseUrl: `${SUPABASE.baseUrl}/` });
    expect(url).toBe(
      'https://pnetstmovctfwqcumodx.supabase.co/functions/v1/m6-streetview?lat=3.139&lng=101.6869&w=600&h=400'
    );
  });

  it('returns null with no Supabase project configured, rather than a URL that would 404', () => {
    expect(buildStreetViewProxyUrl(KL.lat, KL.lng, { baseUrl: '' })).toBeNull();
  });

  it('returns null for coordinates that are not finite numbers', () => {
    expect(buildStreetViewProxyUrl(undefined, KL.lng, SUPABASE)).toBeNull();
    expect(buildStreetViewProxyUrl(KL.lat, null, SUPABASE)).toBeNull();
    expect(buildStreetViewProxyUrl(NaN, KL.lng, SUPABASE)).toBeNull();
  });

  it('never leaks a Google API key - there is nothing in this URL for one to leak from', () => {
    // The regression this module exists to prevent: a Street View URL built
    // in the browser bundle carrying a Google key. This one carries no `key=`
    // parameter at all, because the key lives only in the Edge Function.
    expect(buildStreetViewProxyUrl(KL.lat, KL.lng, SUPABASE)).not.toContain('key=');
  });
});
