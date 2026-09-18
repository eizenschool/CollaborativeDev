import { describe, expect, it } from 'vitest';
import { selectGuideBatch, selectGuideRecommendations } from '../GuideRecommendationEngine.js';

const candidate = (placeId, category, desirability, accessibility, servedByRide = true) => ({
  placeId, place: { id: placeId, category, reviewCount: 30 }, desirability, accessibility, servedByRide,
  distanceKm: 20,
  signals: {
    desirability: { affinity: .8, season: 1, quality: .8, headroom: .6, local: 1 },
    accessibility: { seatHeadroom: servedByRide ? .5 : 0, journeyCost: .8, demandConvergence: .25 }
  }
});

describe('Tumpang Guide recommendation roles', () => {
  it('returns Best, Practical and a category-diverse Wildcard without duplicates', () => {
    const results = selectGuideRecommendations([
      candidate('p1', 'nature', .92, .72),
      candidate('p2', 'nature', .70, .95),
      candidate('p3', 'heritage', .86, .61),
      candidate('p4', 'culinary', .73, .45, false)
    ]);
    expect(results.map((item) => item.role)).toEqual(['best_match', 'practical_alternative', 'wildcard']);
    expect(new Set(results.map((item) => item.placeId)).size).toBe(3);
    expect(results[2].candidate.place.category).not.toBe(results[0].candidate.place.category);
    expect(results.every((item) => item.verifiedReasonCodes.length > 0)).toBe(true);
  });

  it('never invents a third result when fewer catalogue candidates exist', () => {
    expect(selectGuideRecommendations([candidate('p1', 'nature', .8, .8)])).toHaveLength(1);
  });

  it('does not repeat a shown place while three unseen catalogue places remain', () => {
    const results = selectGuideBatch([
      candidate('p1', 'nature', .95, .8), candidate('p2', 'heritage', .9, .8),
      candidate('p3', 'culinary', .85, .8), candidate('p4', 'event', .7, .8)
    ], { shownPlaceIds: ['p1'] });
    expect(results.map((item) => item.placeId)).not.toContain('p1');
    expect(results.every((item) => item.previouslyShown === false)).toBe(true);
  });

  it('reuses and labels a shown place only when unseen candidates are insufficient', () => {
    const results = selectGuideBatch([
      candidate('p1', 'nature', .95, .8), candidate('p2', 'heritage', .9, .8)
    ], { shownPlaceIds: ['p1'] });
    expect(results.some((item) => item.placeId === 'p1' && item.previouslyShown)).toBe(true);
  });

  it('never repeats a place after an explicit different-places request', () => {
    const results = selectGuideBatch([
      candidate('p1', 'nature', .95, .8), candidate('p2', 'heritage', .9, .8)
    ], { shownPlaceIds: ['p1'], recommendationMode: 'different' });
    expect(results.map((item) => item.placeId)).toEqual(['p2']);
    expect(results.every((item) => item.previouslyShown === false)).toBe(true);
  });
});
