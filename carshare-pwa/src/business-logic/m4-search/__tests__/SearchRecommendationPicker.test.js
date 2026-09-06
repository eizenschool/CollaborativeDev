import { describe, expect, it } from 'vitest';
import {
  collectSearchRecommendations,
  filterSearchRecommendations
} from '../SearchRecommendationPicker.js';

const candidate = (sourcePlaceId, name, category, state = 'Melaka') => ({
  place: { sourcePlaceId, name, category, state },
  reasons: [{ key: 'quality', text: `Popular ${category} choice`, contribution: 0.4 }]
});

describe('Search destination recommendation picker helpers', () => {
  it('preserves ranked sections and removes duplicate or unusable place hints', () => {
    const results = collectSearchRecommendations({
      primary: [candidate('jonker', 'Jonker Street', 'culinary')],
      unserved: [candidate('jonker', 'Duplicate Jonker', 'culinary')],
      withheld: [candidate('fort', 'A Famosa', 'heritage'), candidate('', 'Missing ID', 'heritage')]
    });

    expect(results.map((item) => [item.place.sourcePlaceId, item.sectionKey])).toEqual([
      ['jonker', 'recommended'],
      ['fort', 'more']
    ]);
  });

  it('filters by category and by name, state, or recommendation reason', () => {
    const candidates = collectSearchRecommendations({
      primary: [
        candidate('jonker', 'Jonker Street', 'culinary'),
        candidate('taman', 'Taman Negara', 'nature', 'Pahang')
      ],
      unserved: [candidate('festival', 'Rainforest Festival', 'event', 'Sarawak')]
    });

    expect(filterSearchRecommendations(candidates, { category: 'nature' })
      .map((item) => item.place.sourcePlaceId)).toEqual(['taman']);
    expect(filterSearchRecommendations(candidates, { query: 'sarawak' })
      .map((item) => item.place.sourcePlaceId)).toEqual(['festival']);
    expect(filterSearchRecommendations(candidates, { query: 'popular culinary' })
      .map((item) => item.place.sourcePlaceId)).toEqual(['jonker']);
  });
});
