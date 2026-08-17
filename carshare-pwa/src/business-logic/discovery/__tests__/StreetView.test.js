// FR-6.15 - the client side of interactive Street View. checkStreetViewCoverage
// is exercised with an injected fetch stub, in line with the project rule that
// automated tests never make a real network call. No Supabase project or embed
// key is configured under test, so every function is off by default - the same
// guarantee placePhotos.test.js pins for Place Photos.

import { describe, expect, it, vi } from 'vitest';
import {
  buildStreetViewEmbedUrl, checkStreetViewCoverage, hasStreetViewEmbedKey
} from '../StreetView.js';

const SUPABASE = { baseUrl: 'https://pnetstmovctfwqcumodx.supabase.co' };
const EMBED_KEY = { apiKey: 'embed-key' };
const KL = { lat: 3.139, lng: 101.6869 };

describe('hasStreetViewEmbedKey', () => {
  it('is false with no embed key configured', () => {
    expect(hasStreetViewEmbedKey('')).toBe(false);
    expect(hasStreetViewEmbedKey(undefined)).toBe(false);
  });

  it('is true once an embed key is supplied', () => {
    expect(hasStreetViewEmbedKey('embed-key')).toBe(true);
  });
});

describe('buildStreetViewEmbedUrl', () => {
  it('builds the embed request', () => {
    expect(buildStreetViewEmbedUrl(KL.lat, KL.lng, EMBED_KEY)).toBe(
      'https://www.google.com/maps/embed/v1/streetview?key=embed-key&location=3.139,101.6869'
    );
  });

  it('carries a heading when one is given', () => {
    const url = buildStreetViewEmbedUrl(KL.lat, KL.lng, { ...EMBED_KEY, heading: 271 });
    expect(url).toContain('&heading=271');
  });

  it('omits heading entirely rather than defaulting to 0, which is a real direction', () => {
    expect(buildStreetViewEmbedUrl(KL.lat, KL.lng, EMBED_KEY)).not.toContain('heading');
  });

  it('returns null with no embed key configured, rather than a URL that would fail', () => {
    expect(buildStreetViewEmbedUrl(KL.lat, KL.lng, { apiKey: '' })).toBeNull();
  });

  it('returns null for coordinates that are not finite numbers', () => {
    expect(buildStreetViewEmbedUrl(undefined, KL.lng, EMBED_KEY)).toBeNull();
    expect(buildStreetViewEmbedUrl(KL.lat, null, EMBED_KEY)).toBeNull();
  });

  it('escapes the key rather than pasting it into the query raw', () => {
    expect(buildStreetViewEmbedUrl(KL.lat, KL.lng, { apiKey: 'a b&c' })).toContain('key=a%20b%26c');
  });
});

describe('checkStreetViewCoverage', () => {
  it('is not covered with no Supabase project configured, and never calls fetch', async () => {
    const fetchImpl = vi.fn();
    const result = await checkStreetViewCoverage(KL.lat, KL.lng, { baseUrl: '', fetchImpl });
    expect(result).toEqual({ covered: false, heading: null, capturedAt: null });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports coverage, heading, and capture date from a real response shape', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ covered: true, heading: 271, capturedAt: '2023-05' })
    });
    const result = await checkStreetViewCoverage(KL.lat, KL.lng, { ...SUPABASE, fetchImpl });
    expect(result).toEqual({ covered: true, heading: 271, capturedAt: '2023-05' });
  });

  it('reports no coverage when the function says so', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ covered: false }) });
    const result = await checkStreetViewCoverage(KL.lat, KL.lng, { ...SUPABASE, fetchImpl });
    expect(result.covered).toBe(false);
  });

  it('is not covered on an HTTP failure', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false });
    const result = await checkStreetViewCoverage(KL.lat, KL.lng, { ...SUPABASE, fetchImpl });
    expect(result.covered).toBe(false);
  });

  it('is not covered rather than throwing when the network call itself fails', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(checkStreetViewCoverage(KL.lat, KL.lng, { ...SUPABASE, fetchImpl }))
      .resolves.toEqual({ covered: false, heading: null, capturedAt: null });
  });

  it('is not covered rather than throwing on a malformed response body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => { throw new SyntaxError('not json'); }
    });
    await expect(checkStreetViewCoverage(KL.lat, KL.lng, { ...SUPABASE, fetchImpl }))
      .resolves.toEqual({ covered: false, heading: null, capturedAt: null });
  });

  it('tolerates a heading or capturedAt of the wrong type rather than passing it through', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ covered: true, heading: 'north', capturedAt: 42 })
    });
    const result = await checkStreetViewCoverage(KL.lat, KL.lng, { ...SUPABASE, fetchImpl });
    expect(result).toEqual({ covered: true, heading: null, capturedAt: null });
  });

  it('requests the coordinate it was given', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ covered: false }) });
    await checkStreetViewCoverage(KL.lat, KL.lng, { ...SUPABASE, fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toContain(`lat=${KL.lat}&lng=${KL.lng}`);
  });
});
