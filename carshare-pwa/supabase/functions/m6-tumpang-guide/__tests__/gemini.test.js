import { describe, expect, it, vi } from 'vitest';
import { callGemini } from '../gemini.ts';

function successResponse(message = 'Ready') {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify({
      mode: 'clarify', assistantMessage: message, language: 'en', planState: {},
      quickReplies: [], recommendations: [], actions: []
    }) }] } }]
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('Gemini provider resilience', () => {
  it('retries one transient 429 and keeps the structured response', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 429 }))
      .mockResolvedValueOnce(successResponse('Recovered'));

    const result = await callGemini({
      apiKey: 'test-key', model: 'gemini-3.5-flash-lite', prompt: '{}', fetchImpl,
      timeoutMs: 3000, maxAttempts: 2
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.assistantMessage).toBe('Recovered');
  });

  it('does not retry a non-transient authentication failure', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 403 }));

    await expect(callGemini({
      apiKey: 'bad-key', model: 'gemini-3.5-flash-lite', prompt: '{}', fetchImpl,
      timeoutMs: 1000, maxAttempts: 2
    })).rejects.toMatchObject({ status: 403 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
