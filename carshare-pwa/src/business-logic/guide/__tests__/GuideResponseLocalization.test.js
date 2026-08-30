import { describe, expect, it } from 'vitest';
import { GUIDE_MODE } from '../constants.js';
import { localizeGuideResponse, localizedDifferentPlacesCommand } from '../GuideResponseLocalization.js';

const response = {
  mode: GUIDE_MODE.RECOMMEND,
  assistantMessage: 'Original provider explanation',
  language: 'en',
  planState: { language: 'en', startDate: '2026-08-30', origin: { label: 'Kuala Lumpur' }, partySize: 2, preferredCategories: ['nature'] },
  quickReplies: ['old reply'],
  recommendations: [{ placeId: 'place-1', role: 'best_match', verifiedReasonCodes: ['affinity'], tradeoffCode: 'none' }],
  actions: [],
  batchId: 'batch-1',
  traceId: 'trace-1'
};

describe('Tumpang Guide display localization', () => {
  it('changes copy without reranking or changing the recommendation batch', () => {
    const localized = localizeGuideResponse(response, 'zh-CN');
    expect(localized.localizedMessage).toContain('三个');
    expect(localized.planState.language).toBe('zh-CN');
    expect(localized.recommendations).toEqual(response.recommendations);
    expect(localized.batchId).toBe(response.batchId);
  });

  it('uses a localized explicit different-places command', () => {
    expect(localizedDifferentPlacesCommand('zh-CN')).toBe('推荐其他地点');
    expect(localizedDifferentPlacesCommand('ms')).toBe('Cadangkan tempat lain');
    expect(localizedDifferentPlacesCommand('ta')).toContain('வேறு');
  });
});

