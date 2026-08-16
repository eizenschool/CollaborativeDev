// FR-6.15 - metadata-first Street View. `hasStreetViewCoverage` is exercised
// with an injected fetch stub, in line with the project rule that automated
// tests never make a real network call. No key is configured under test, so
// every pure URL builder returns null unless a test explicitly passes one -
// the same "off by default, on only with a key" guarantee placePhotos.test.js
// pins for Place Photos.

import { describe, expect, it, vi } from 'vitest';
import {
  buildStreetViewImageUrl,
  buildStreetViewMetadataUrl,
  hasStreetViewCoverage,
  hasStreetViewKey
} from '../StreetView.js';

const KEY = { apiKey: 'test-key' };
const KL = { lat: 3.139, lng: 101.6869 };

describe('hasStreetViewKey', () => {
  it('is false with no key configured, which is the state of this repository today', () => {
    expect(hasStreetViewKey('')).toBe(false);
    expect(hasStreetViewKey(undefined)).toBe(false);
  });

  it('is true once a key is supplied', () => {
    expect(hasStreetViewKey('test-key')).toBe(true);
  });
});

describe('buildStreetViewMetadataUrl', () => {
  it('builds the free metadata request', () => {
    expect(buildStreetViewMetadataUrl(KL.lat, KL.lng, KEY)).toBe(
      'https://maps.googleapis.com/maps/api/streetview/metadata?location=3.139,101.6869&key=test-key'
    );
  });

  it('returns null with no key configured, rather than a URL that would 403', () => {
    expect(buildStreetViewMetadataUrl(KL.lat, KL.lng, { apiKey: '' })).toBeNull();
  });

  it('returns null for coordinates that are not finite numbers', () => {
    expect(buildStreetViewMetadataUrl(undefined, KL.lng, KEY)).toBeNull();
    expect(buildStreetViewMetadataUrl(KL.lat, null, KEY)).toBeNull();
    expect(buildStreetViewMetadataUrl(NaN, KL.lng, KEY)).toBeNull();
  });

  it('escapes the key rather than pasting it into the query raw', () => {
    expect(buildStreetViewMetadataUrl(KL.lat, KL.lng, { apiKey: 'a b&c' }))
      .toContain('key=a%20b%26c');
  });
});

describe('buildStreetViewImageUrl', () => {
  it('builds the billed image request at the requested size', () => {
    expect(buildStreetViewImageUrl(KL.lat, KL.lng, KEY)).toBe(
      'https://maps.googleapis.com/maps/api/streetview?location=3.139,101.6869&size=600x400&key=test-key'
    );
  });

  it('clamps to the free-tier ceiling rather than requesting a size Google would reject', () => {
    expect(buildStreetViewImageUrl(KL.lat, KL.lng, { ...KEY, width: 4000, height: 4000 }))
      .toContain('size=640x640');
  });

  it('returns null with no key configured', () => {
    expect(buildStreetViewImageUrl(KL.lat, KL.lng, { apiKey: '' })).toBeNull();
  });

  it('returns null for invalid coordinates', () => {
    expect(buildStreetViewImageUrl(undefined, undefined, KEY)).toBeNull();
  });
});

describe('hasStreetViewCoverage', () => {
  it('is false with no key configured, and never calls fetch', async () => {
    const fetchImpl = vi.fn();
    const covered = await hasStreetViewCoverage(KL.lat, KL.lng, { apiKey: '', fetchImpl });
    expect(covered).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('is true only for an explicit "OK" status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'OK' })
    });
    expect(await hasStreetViewCoverage(KL.lat, KL.lng, { ...KEY, fetchImpl })).toBe(true);
  });

  it('is false for Google\'s documented "no coverage here" status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ZERO_RESULTS' })
    });
    expect(await hasStreetViewCoverage(KL.lat, KL.lng, { ...KEY, fetchImpl })).toBe(false);
  });

  it('is false for an HTTP failure', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false });
    expect(await hasStreetViewCoverage(KL.lat, KL.lng, { ...KEY, fetchImpl })).toBe(false);
  });

  it('is false rather than throwing when the network call itself fails', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(hasStreetViewCoverage(KL.lat, KL.lng, { ...KEY, fetchImpl })).resolves.toBe(false);
  });

  it('is false rather than throwing on a malformed response body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => { throw new SyntaxError('not json'); }
    });
    await expect(hasStreetViewCoverage(KL.lat, KL.lng, { ...KEY, fetchImpl })).resolves.toBe(false);
  });

  it('checks metadata before ever building the billed image request', async () => {
    // The property FR-6.15 exists for: a caller cannot reach the image URL
    // through this function without first passing the free metadata check.
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'OK' }) });
    await hasStreetViewCoverage(KL.lat, KL.lng, { ...KEY, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toContain('/metadata?');
  });
});
