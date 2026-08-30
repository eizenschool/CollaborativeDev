import { describe, expect, it } from 'vitest';
import { isEmergencyIntent, safeRecentMessages, validateGuideResponse } from '../GuidePolicy.js';

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

  it.each(['SOS I am in danger', '紧急，快报警', 'Kecemasan, panggil polis', 'அவசரம், உதவி'])('stops recommendation on emergency intent: %s', (text) => {
    expect(isEmergencyIntent(text)).toBe(true);
  });
});

