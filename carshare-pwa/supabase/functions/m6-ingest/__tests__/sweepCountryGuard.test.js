// index.ts reads Deno.env at module scope, so it cannot be imported directly
// by Vitest (same reasoning as m6-tumpang-guide's intentPatchScope.test.js) -
// this pins the fix as a source-text assertion instead.
//
// Regression: processCatalogueRequests (the "request this place" flow) has
// always guarded a single Google Place lookup with isMalaysiaAddress before
// upserting it. The regional sweep's enrichment loop fetches the exact same
// addressComponents field but never checked it, so a border region's 50km
// circle could upsert a place from another country. Confirmed against real
// data: sweeping Labuan (5.2831, 115.2308) pulled in six places whose state
// resolved to Brunei's Brunei-Muara district, and sweeping Perlis (6.4414,
// 100.1986) pulled in one place in Thailand's Songkhla province - both
// borders sit well inside 50km of those regions' hub coordinates.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(import.meta.dirname, '../index.ts'), 'utf8');

describe('Tumpang catalogue ingestion sweep stays inside Malaysia', () => {
  it('checks isMalaysiaAddress inside the sweep enrichment loop, not only inside processCatalogueRequests', () => {
    const sweepLoop = source.slice(
      source.indexOf('for (const [placeId, item] of discovered)'),
      source.indexOf('const enriched = ') > -1
        ? source.indexOf('const enriched = ')
        : source.length
    );
    expect(sweepLoop).toContain('isMalaysiaAddress(detail.addressComponents)');
    expect(sweepLoop).toContain('outOfCountry.push');
  });

  it('checks the country before spending the classification/category work on a foreign place', () => {
    const loopStart = source.indexOf('for (const [placeId, item] of discovered)');
    const countryCheck = source.indexOf('isMalaysiaAddress(detail.addressComponents)', loopStart);
    const classify = source.indexOf('classifyPlace(types, primaryType)', loopStart);
    expect(countryCheck).toBeGreaterThan(loopStart);
    expect(countryCheck).toBeLessThan(classify);
  });

  it('reports outOfCountry in the response so a border region silently pulling in another country is visible immediately, not discovered later from a state-count query', () => {
    expect(source).toContain('outOfCountry,');
  });
});
