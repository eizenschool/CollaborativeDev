import { describe, expect, it } from 'vitest';
import { sanitizePublicGuidePayload } from '../publicPayload.ts';

describe('public Guide response payload', () => {
  it('removes provider ownership metadata recursively while keeping public source labels safe', () => {
    expect(sanitizePublicGuidePayload({
      provider: 'groq', model: 'openai/gpt-oss-20b', source: 'groq',
      placeInfo: { provider: 'gemini', model: 'gemini-3.7-flash', source: 'gemini', officialName: 'KL Bird Park' },
      toolResults: [{ intentProvider: 'gemini', providerModel: 'private', source: 'rules', placeId: 'place-1' }]
    })).toEqual({
      source: 'ai',
      placeInfo: { source: 'ai', officialName: 'KL Bird Park' },
      toolResults: [{ source: 'rules', placeId: 'place-1' }]
    });
  });
});
