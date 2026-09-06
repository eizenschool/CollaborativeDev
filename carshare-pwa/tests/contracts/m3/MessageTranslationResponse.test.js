import { describe, expect, it } from 'vitest';
import { completionText } from '../../../supabase/functions/m3-message-translation/response.ts';

describe('Cloudflare translation response parsing', () => {
  it('reads the current OpenAI-compatible chat completion shape', () => {
    expect(completionText({
      choices: [{ message: { role: 'assistant', content: '{"translatedText":"你好"}' } }],
    })).toBe('{"translatedText":"你好"}');
  });

  it('keeps compatibility with legacy Workers AI response fields', () => {
    expect(completionText({ response: 'Selamat pagi' })).toBe('Selamat pagi');
    expect(completionText({ generated_text: 'Good morning' })).toBe('Good morning');
  });

  it('supports array content parts and rejects empty completions', () => {
    expect(completionText({
      choices: [{ message: { content: [{ type: 'text', text: 'வணக்கம்' }] } }],
    })).toBe('வணக்கம்');
    expect(completionText({ choices: [{ message: { content: [] } }] })).toBe('');
  });
});
