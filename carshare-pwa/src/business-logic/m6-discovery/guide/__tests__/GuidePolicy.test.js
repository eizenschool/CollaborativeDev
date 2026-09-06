import { describe, expect, it } from 'vitest';
import {
  guideResponseContextText, isEmergencyIntent, safeRecentMessages, shouldUseLocalGuideRules, validateGuideResponse
} from '../GuidePolicy.js';

const valid = {
  mode: 'recommend', assistantMessage: 'Three verified options.', language: 'en', planState: {},
  quickReplies: [], actions: [], remainingTurns: 4, fallbackReason: null, traceId: 'trace-1',
  recommendations: [{
    placeId: 'p1', role: 'best_match', verifiedReasonCodes: ['quality'], tradeoffCode: 'none'
  }]
};

describe('Tumpang Guide browser response policy', () => {
  it('accepts only catalogue allowlisted Place IDs', () => {
    expect(validateGuideResponse(valid, ['p1']).valid).toBe(true);
    expect(validateGuideResponse({ ...valid, recommendations: [{ ...valid.recommendations[0], placeId: 'invented' }] }, ['p1']))
      .toMatchObject({ valid: false, reason: 'place_not_allowlisted', rejectedPlaceId: 'invented' });
  });

  it('rejects unknown actions and unsupported evidence codes', () => {
    expect(validateGuideResponse({ ...valid, actions: [{ type: 'request_seat' }] }, ['p1']).reason).toBe('unknown_action');
    expect(validateGuideResponse({ ...valid, recommendations: [{ ...valid.recommendations[0], verifiedReasonCodes: ['model_says_so'] }] }, ['p1']).reason).toBe('unverified_reason');
  });

  it('keeps exactly the latest six dialogue rounds', () => {
    const messages = Array.from({ length: 16 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', text: `message-${index}` }));
    const recent = safeRecentMessages(messages);
    expect(recent).toHaveLength(12);
    expect(recent[0].text).toBe('message-4');
    expect(recent.at(-1).text).toBe('message-15');
  });

  it.each(['I am in immediate danger', '有人昏迷，请拨打999', 'Bahaya segera, hubungi 999', 'உடனடி ஆபத்து, 999 அழை'])('stops recommendation on unequivocal emergency intent: %s', (text) => {
    expect(isEmergencyIntent(text)).toBe(true);
  });

  it('accepts a card-free small-talk response', () => {
    const response = {
      ...valid, mode: 'small_talk', assistantMessage: '我也很喜欢和你聊天。',
      recommendations: [], quickReplies: [], actions: []
    };
    expect(validateGuideResponse(response, [])).toMatchObject({ valid: true });
    expect(validateGuideResponse({ ...response, recommendations: valid.recommendations }, ['p1']))
      .toMatchObject({ valid: false, reason: 'small_talk_has_actions' });
  });

  it('accepts a card-free travel_info response instead of rejecting it as an unknown mode (regression: a live get_travel_info reply used to come back from the browser fallback re-validation as "AI service unavailable / unknown mode")', () => {
    const response = {
      ...valid, mode: 'travel_info', assistantMessage: 'Expect scattered showers this weekend.',
      recommendations: [], quickReplies: [], actions: []
    };
    expect(validateGuideResponse(response, [])).toMatchObject({ valid: true });
  });

  it('accepts a deterministic weather/route answer built by get_weather_forecast or get_route_estimate, since both reuse the already-registered travel_info mode and need zero client-side registration', () => {
    const weatherShaped = {
      ...valid, mode: 'travel_info', assistantMessage: 'In Kuala Lumpur: expect showers this weekend, 32°/25°.',
      recommendations: [], quickReplies: [], actions: [],
      travelInfo: { category: 'weather', locationName: 'Kuala Lumpur', days: [] }
    };
    expect(validateGuideResponse(weatherShaped, [])).toMatchObject({ valid: true });
    const routeShaped = {
      ...valid, mode: 'travel_info', assistantMessage: 'Batu Caves is about 30 minutes away, roughly 13 km.',
      recommendations: [], quickReplies: [], actions: [],
      travelInfo: { category: 'route', destinationName: 'Batu Caves', distanceMeters: 13000 }
    };
    expect(validateGuideResponse(routeShaped, [])).toMatchObject({ valid: true });
  });

  it('accepts only a verified, confirmation-gated conversational action', () => {
    const response = {
      ...valid, mode: 'action', assistantMessage: 'I can save KL Bird Park after you confirm.',
      recommendations: [], quickReplies: [], actions: [{
        type: 'record_interest', placeId: 'p1', requiresConfirmation: true
      }]
    };
    expect(validateGuideResponse(response, ['p1'])).toMatchObject({ valid: true });
    expect(validateGuideResponse({ ...response, actions: [{ ...response.actions[0], placeId: 'invented' }] }, ['p1']))
      .toMatchObject({ valid: false, reason: 'action_place_not_allowlisted' });
  });

  it('keeps previous place sections as context so a detail follow-up can add information', () => {
    const text = guideResponseContextText({ placeInfo: {
      officialName: 'KL Bird Park', summary: 'A walk-through aviary experience.',
      highlights: ['Bird presentations', 'Feeding sessions'], practicalNotes: ['Opening hours: check the official site']
    } });
    expect(text).toContain('Previous public venue facts for KL Bird Park');
    expect(text).toContain('Already covered activities: Bird presentations; Feeding sessions');
    expect(text).toContain('Already covered practical information: Opening hours');
    expect(text).not.toContain('A walk-through aviary experience');
  });

  it('does not mistake an ordinary help request for an emergency', () => {
    expect(isEmergencyIntent('help me save this to my interest')).toBe(false);
  });

  it('never lets online production turns bypass AI into local rules', () => {
    expect(shouldUseLocalGuideRules({ online: true })).toBe(false);
    expect(shouldUseLocalGuideRules({ online: true, qaMode: true, forceFallback: 'timeout' })).toBe(false);
    expect(shouldUseLocalGuideRules({ online: false })).toBe(true);
    expect(shouldUseLocalGuideRules({ online: true, fixtureMode: true })).toBe(true);
    expect(shouldUseLocalGuideRules({ online: true, qaMode: true, forceFallback: 'offline' })).toBe(true);
  });
});

