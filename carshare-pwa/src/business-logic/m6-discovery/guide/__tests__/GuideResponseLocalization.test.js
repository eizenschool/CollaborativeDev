import { describe, expect, it } from 'vitest';
import { GUIDE_MODE } from '../constants.js';
import { localizeGuideResponse, localizedDifferentPlacesCommand } from '../GuideResponseLocalization.js';

const response = {
  mode: GUIDE_MODE.RECOMMEND,
  assistantMessage: 'Original provider explanation',
  language: 'en',
  planState: { language: 'en', startDate: '2026-08-30', origin: { label: 'Kuala Lumpur' }, partySize: 2, preferredCategories: ['nature'] },
  quickReplies: ['obsolete canned reply'],
  recommendations: [{ placeId: 'place-1', role: 'best_match', verifiedReasonCodes: ['affinity'], tradeoffCode: 'none' }],
  actions: [],
  batchId: 'batch-1',
  traceId: 'trace-1'
};

describe('Tumpang Guide display localization', () => {
  it('keeps AI copy and the immutable batch without recreating canned replies', () => {
    const localized = localizeGuideResponse({ ...response, source: 'ai' }, 'en');
    expect(localized.localizedMessage).toBe('Original provider explanation');
    expect(localized.quickReplies).toEqual([]);
    expect(localized.planState.language).toBe('en');
    expect(localized.recommendations).toEqual(response.recommendations);
    expect(localized.batchId).toBe(response.batchId);
  });

  it('uses a localized explicit different-places command', () => {
    expect(localizedDifferentPlacesCommand('zh-CN')).toBe('推荐其他地点');
    expect(localizedDifferentPlacesCommand('ms')).toBe('Cadangkan tempat lain');
    expect(localizedDifferentPlacesCommand('ta')).toContain('வேறு');
  });

  it('keeps an AI acknowledgement when the server has verified its clarification field', () => {
    const localized = localizeGuideResponse({
      ...response, mode: GUIDE_MODE.CLARIFY, source: 'ai', recommendations: [],
      assistantMessage: 'I understood Melaka. What kind of food experience sounds good?',
      planState: { language: 'en', origin: { label: 'Melaka' } }
    }, 'en');
    expect(localized.localizedMessage).toContain('understood Melaka');
    expect(localized.localizedMessage).toContain('What kind of food');
  });

  it('shows an AI retry message instead of falsely claiming there are no candidates', () => {
    const localized = localizeGuideResponse({
      ...response, mode: GUIDE_MODE.FALLBACK, source: 'unavailable', recommendations: [],
      assistantMessage: 'Provider request failed.'
    }, 'en');
    expect(localized.localizedMessage).toContain('AI service is temporarily unavailable');
    expect(localized.localizedMessage).not.toContain('no place');
  });

  it('never replaces a rules-authored clarify question with an unrelated canned question (regression: reopening a saved chat turned "which destination?" into "what matters most: food, heritage, nature, or an event?")', () => {
    const localized = localizeGuideResponse({
      ...response, mode: GUIDE_MODE.CLARIFY, source: 'rules', recommendations: [],
      assistantMessage: '你想查到哪个地点的车程？', language: 'zh-CN',
      planState: { language: 'zh-CN', origin: null, preferredCategories: [] }
    }, 'en');
    expect(localized.localizedMessage).toBe('你想查到哪个地点的车程？');
    expect(localized.localizedMessage).not.toContain('What matters most');
  });

  it('keeps an AI answer in its own language rather than substituting canned copy when no translation of it exists', () => {
    const localized = localizeGuideResponse({
      ...response, source: 'gemini', language: 'zh-CN',
      assistantMessage: '没问题！既然您对历史古迹感兴趣，我为您挑选了几个好去处。'
    }, 'en');
    expect(localized.localizedMessage).toContain('历史古迹');
    expect(localized.localizedMessage).not.toContain('catalogue-verified');
  });

  it('still prefers a real translation of that same message when one has been cached', () => {
    const localized = localizeGuideResponse({
      ...response, source: 'gemini', language: 'zh-CN',
      assistantMessage: '我为您挑选了几个好去处。',
      localizedMessages: { en: 'I picked a few good spots for you.' }
    }, 'en');
    expect(localized.localizedMessage).toBe('I picked a few good spots for you.');
  });

  it('falls back to canned copy only when the response carries no text of its own', () => {
    const localized = localizeGuideResponse({
      ...response, mode: GUIDE_MODE.CLARIFY, source: 'rules', recommendations: [],
      assistantMessage: '', localizedMessage: '',
      planState: { language: 'en', origin: null, preferredCategories: [] }
    }, 'en');
    expect(localized.localizedMessage).toBe('Where will you be starting from?');
  });

  it('keeps a travel_info answer intact and picks up its cached translation', () => {
    const weather = {
      ...response, mode: GUIDE_MODE.TRAVEL_INFO, source: 'rules', recommendations: [],
      assistantMessage: 'Malacca City明天（9月4日）的天气为阵雨。', language: 'zh-CN'
    };
    expect(localizeGuideResponse(weather, 'en').localizedMessage).toContain('阵雨');
    expect(localizeGuideResponse({ ...weather, localizedMessages: { en: 'Showers tomorrow in Malacca City.' } }, 'en')
      .localizedMessage).toBe('Showers tomorrow in Malacca City.');
  });

  it('localizes a verified conversational action without changing its Place ID', () => {
    const localized = localizeGuideResponse({
      ...response, mode: GUIDE_MODE.ACTION, source: 'groq', recommendations: [],
      assistantMessage: 'Confirm to save KL Bird Park.',
      actions: [{ type: 'record_interest', placeId: 'place-1', requiresConfirmation: true }]
    }, 'zh-CN');
    expect(localized.actions[0]).toMatchObject({ type: 'record_interest', placeId: 'place-1', label: '保存兴趣' });
  });
});

