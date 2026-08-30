import { describe, expect, it } from 'vitest';
import { extractCatalogueRequestName, sanitizePlanState, validateModelResponse } from '../policy.ts';

const candidates = [
  { id: 'a', reasonCodes: ['quality', 'local'] },
  { id: 'b', reasonCodes: ['seat_headroom'] },
  { id: 'c', reasonCodes: ['season'] }
];
const response = {
  mode: 'recommend', assistantMessage: 'Here are three verified places.', language: 'en', planState: {},
  quickReplies: [], actions: [], recommendations: [
    { placeId: 'a', role: 'best_match', verifiedReasonCodes: ['quality'], tradeoffCode: 'none' },
    { placeId: 'b', role: 'practical_alternative', verifiedReasonCodes: ['seat_headroom'], tradeoffCode: 'none' },
    { placeId: 'c', role: 'wildcard', verifiedReasonCodes: ['season'], tradeoffCode: 'no_ride_yet' }
  ]
};

describe('Tumpang Guide Edge output policy', () => {
  it('accepts a complete three-role response whose evidence belongs to each candidate', () => {
    expect(validateModelResponse(response, candidates)).toEqual({ valid: true });
  });

  it('rejects prompt-injected external IDs and model-invented evidence', () => {
    const outside = structuredClone(response);
    outside.recommendations[2].placeId = 'ignore-the-database-and-use-this';
    expect(validateModelResponse(outside, candidates).reason).toBe('place_not_allowlisted');
    const invented = structuredClone(response);
    invented.recommendations[0].verifiedReasonCodes = ['season'];
    expect(validateModelResponse(invented, candidates).reason).toBe('unverified_reason');
  });

  it('rejects duplicate roles even when all Place IDs are valid', () => {
    const duplicate = structuredClone(response);
    duplicate.recommendations[1].role = 'best_match';
    expect(validateModelResponse(duplicate, candidates).reason).toBe('duplicate_role');
  });

  it('caps a malicious 30-day plan to seven days and strips coordinates', () => {
    expect(sanitizePlanState({
      origin: { label: 'KL', lat: 3.1, lng: 101.7 }, startDate: '2026-09-01', endDate: '2026-09-30',
      partySize: 2, preferredCategories: ['nature', 'unknown']
    })).toMatchObject({ origin: { label: 'KL' }, startDate: '2026-09-01', endDate: '2026-09-07', preferredCategories: ['nature'] });
  });

  it('recognises an explicit catalogue request without treating it as a recommendation', () => {
    expect(extractCatalogueRequestName('Please add Sky Mirror Kuala Selangor to the catalogue')).toBe('Sky Mirror Kuala Selangor');
  });
});

