import { describe, expect, it } from 'vitest';
import {
  assertNoCardsOrActionsFromSearch, detectSelfContradictedInfoRecommendation, extractCatalogueRequestName,
  isEmergencyText, isOrdinaryDiscomfortText, sanitizePlanState, validateModelResponse
} from '../policy.ts';

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

  it('accepts a small-talk response only when it contains no recommendation cards', () => {
    const casual = {
      ...response, mode: 'small_talk', assistantMessage: '谢谢你，我也很喜欢和你聊天。',
      recommendations: [], quickReplies: [], actions: []
    };
    expect(validateModelResponse(casual, [])).toEqual({ valid: true });
    expect(validateModelResponse({ ...casual, recommendations: response.recommendations }, candidates))
      .toMatchObject({ valid: false, reason: 'small_talk_has_actions' });
  });

  it('allows a verified place action without creating a recommendation card', () => {
    const actionResponse = {
      ...response, mode: 'action', assistantMessage: 'Confirm to save this place.', recommendations: [],
      actions: [{ type: 'record_interest', placeId: 'a', requiresConfirmation: true }]
    };
    expect(validateModelResponse(actionResponse, candidates)).toEqual({ valid: true });
  });

  it('keeps ordinary help requests in the AI intent flow', () => {
    expect(isEmergencyText('help me save this to my interest')).toBe(false);
    expect(isEmergencyText('我感觉不舒服')).toBe(false);
    expect(isOrdinaryDiscomfortText('我感觉不舒服')).toBe(true);
    expect(isEmergencyText('someone is unconscious, call 999')).toBe(true);
  });

  it('rejects a search-tool answer that smuggles in a recommendation card or an action', () => {
    expect(assertNoCardsOrActionsFromSearch('place_info', { recommendations: [], actions: [] }))
      .toEqual({ valid: true });
    expect(assertNoCardsOrActionsFromSearch('travel_info', { recommendations: [], actions: [] }))
      .toEqual({ valid: true });
    expect(assertNoCardsOrActionsFromSearch('place_info', {
      recommendations: [{ placeId: 'a', role: 'best_match', verifiedReasonCodes: ['quality'], tradeoffCode: 'none' }],
      actions: []
    })).toMatchObject({ valid: false, reason: 'search_response_had_cards_or_actions' });
    expect(assertNoCardsOrActionsFromSearch('travel_info', {
      recommendations: [], actions: [{ type: 'record_interest', placeId: 'a', requiresConfirmation: true }]
    })).toMatchObject({ valid: false, reason: 'search_response_had_cards_or_actions' });
  });

  it('leaves non-search modes alone, since the boundary only applies to search-tool answers', () => {
    expect(assertNoCardsOrActionsFromSearch('recommend', { recommendations: response.recommendations, actions: [] }))
      .toEqual({ valid: true });
    expect(assertNoCardsOrActionsFromSearch('action', {
      recommendations: [], actions: [{ type: 'record_interest', placeId: 'a', requiresConfirmation: true }]
    })).toEqual({ valid: true });
  });

  it('catches a recommend batch whose own assistantMessage admits it could not check real-time conditions', () => {
    const englishCase = detectSelfContradictedInfoRecommendation('recommend', {
      assistantMessage: 'I cannot check live weather forecasts, but here are some wonderful spots to consider!',
      recommendations: response.recommendations
    });
    expect(englishCase).toMatchObject({ matched: true, reason: 'self_contradicted_info_recommendation' });

    const englishConfirmCase = detectSelfContradictedInfoRecommendation('recommend', {
      assistantMessage: 'While I cannot confirm real-time walking conditions, here are some fantastic spots!',
      recommendations: response.recommendations
    });
    expect(englishConfirmCase.matched).toBe(true);

    const chineseCase = detectSelfContradictedInfoRecommendation('recommend', {
      assistantMessage: '关于天气情况，我们的系统在推荐生成阶段无法提供实时的天气预报。不过，为您精选了以下三个景点。',
      recommendations: response.recommendations
    });
    expect(chineseCase.matched).toBe(true);
  });

  it('leaves a confident recommend batch and a genuine travel_info answer alone', () => {
    expect(detectSelfContradictedInfoRecommendation('recommend', {
      assistantMessage: 'Here are three verified places that fit your plan.', recommendations: response.recommendations
    })).toEqual({ matched: false });
    expect(detectSelfContradictedInfoRecommendation('recommend', {
      assistantMessage: 'I cannot check live weather forecasts right now.', recommendations: []
    })).toEqual({ matched: false });
    expect(detectSelfContradictedInfoRecommendation('travel_info', {
      assistantMessage: 'I cannot check live weather forecasts right now.', recommendations: []
    })).toEqual({ matched: false });
  });
});

