import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchTravelInfo } from '../travelInfo.ts';

afterEach(() => vi.unstubAllGlobals());

function fakeAdmin() {
  const health = new Map();
  return {
    schema() {
      return {
        from(table) {
          if (table === 'ai_guide_provider_health') {
            let provider;
            return {
              select() { return this; },
              eq(_column, value) { provider = value; return this; },
              async maybeSingle() { return { data: health.get(provider) || null, error: null }; },
              async upsert(row) { health.set(row.provider, row); return { error: null }; }
            };
          }
          return { async insert() { return { error: null }; } };
        }
      };
    }
  };
}

describe('Tumpang Guide real-time travel info (get_travel_info)', () => {
  it('returns a synthesized Gemini summary with safe, deduped citation URLs', async () => {
    vi.stubGlobal('Deno', { env: { get: (name) => ({ GEMINI_API_KEY: 'gemini-test' }[name] || '') } });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ steps: [{
      type: 'model_output', content: [{ text: JSON.stringify({
        summary: 'Expect scattered afternoon showers today, clearing by evening.'
      }), annotations: [
        { title: 'Malaysian Meteorological Department', url: 'https://www.met.gov.my/' },
        { title: 'Unsafe', url: 'javascript:alert(1)' }
      ] }]
    }] }), { status: 200 }));

    const result = await fetchTravelInfo({
      topic: 'weather in Kuala Lumpur this weekend', language: 'en', fetchImpl
    });
    expect(result.provider).toBe('gemini');
    expect(result.summary).toContain('showers');
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].url).toMatch(/^https:/);
    const request = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(request.tools).toEqual([{ type: 'google_search' }]);
    expect(request.response_format.schema.properties).toEqual({ summary: { type: 'string' } });
  });

  it('never asks the provider to identify a new place - only to summarize a topic', async () => {
    vi.stubGlobal('Deno', { env: { get: (name) => ({ GEMINI_API_KEY: 'gemini-test' }[name] || '') } });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ steps: [{
      type: 'model_output', content: [{ text: JSON.stringify({ summary: 'Grab is the most common option; ride-hailing apps work well.' }),
        annotations: [{ title: 'Source', url: 'https://example.com/transport' }] }]
    }] }), { status: 200 }));

    await fetchTravelInfo({ topic: 'transport options in Penang', language: 'en', relatedPlaceName: 'KL Bird Park', fetchImpl });
    const request = JSON.parse(fetchImpl.mock.calls[0][1].body);
    const prompt = JSON.parse(request.input);
    expect(prompt.instruction).toMatch(/never identifying, endorsing, describing or introducing a new place/i);
    expect(prompt.relatedCataloguePlace).toBe('KL Bird Park');
  });

  it('explicitly requires calling the search tool before answering (regression: Groq rejected the request with "Tool choice is required, but model did not call a tool" when the prompt only said to synthesize an answer, never telling the model it must search first)', async () => {
    vi.stubGlobal('Deno', { env: { get: (name) => ({ GEMINI_API_KEY: 'gemini-test' }[name] || '') } });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ steps: [{
      type: 'model_output', content: [{ text: JSON.stringify({ summary: 'Expect scattered showers this weekend.' }),
        annotations: [{ title: 'Source', url: 'https://example.com/weather' }] }]
    }] }), { status: 200 }));

    await fetchTravelInfo({ topic: 'weather this weekend', language: 'en', fetchImpl });
    const request = JSON.parse(fetchImpl.mock.calls[0][1].body);
    const prompt = JSON.parse(request.input);
    expect(prompt.instruction).toMatch(/must call the search tool/i);
    expect(prompt.instruction).toMatch(/never answer from memory alone/i);
  });

  it('retries once when Groq rejects a forced tool_choice because the model skipped calling browser_search, then succeeds', async () => {
    vi.stubGlobal('Deno', { env: { get: (name) => ({ GROQ_API_KEY: 'groq-test' }[name] || '') } });
    let groqCalls = 0;
    const fetchImpl = vi.fn(async () => {
      groqCalls += 1;
      if (groqCalls === 1) {
        return new Response(JSON.stringify({ error: { message: 'Tool choice is required, but model did not call a tool' } }), { status: 400 });
      }
      return new Response(JSON.stringify({ choices: [{ message: {
        content: 'Expect light showers in the afternoon.',
        executed_tools: [{ search_results: { results: [{ title: 'Met Malaysia', url: 'https://www.met.gov.my/' }] } }]
      } }] }), { status: 200 });
    });
    const result = await fetchTravelInfo({ topic: 'weather tomorrow', language: 'en', fetchImpl });
    expect(groqCalls).toBe(2);
    expect(result.provider).toBe('groq');
    expect(result.summary).toContain('showers');
  });

  it('does not retry a Groq failure unrelated to the forced tool choice (e.g. no sources, or an outright provider error)', async () => {
    vi.stubGlobal('Deno', { env: { get: (name) => ({ GROQ_API_KEY: 'groq-test' }[name] || '') } });
    let groqCalls = 0;
    const fetchImpl = vi.fn(async () => {
      groqCalls += 1;
      return new Response(JSON.stringify({ error: { message: 'invalid api key' } }), { status: 401 });
    });
    await expect(fetchTravelInfo({ topic: 'weather tomorrow', language: 'en', fetchImpl })).rejects.toThrow();
    expect(groqCalls).toBe(1);
  });

  it('falls back from Gemini search to Groq browser search', async () => {
    vi.stubGlobal('Deno', { env: { get: (name) => ({
      GEMINI_API_KEY: 'gemini-test', GROQ_API_KEY: 'groq-test',
      M6_GUIDE_GEMINI_MODEL: 'gemini-test', M6_GUIDE_GROQ_MODEL: 'groq-test'
    }[name] || '') } });
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).includes('generativelanguage.googleapis.com')) return new Response('{}', { status: 429 });
      return new Response(JSON.stringify({ choices: [{ message: {
        content: 'Trains run every 15 minutes between the two cities on weekdays.',
        executed_tools: [{ search_results: { results: [{ title: 'Rail operator', url: 'https://www.ktmb.com.my/' }] } }]
      } }] }), { status: 200 });
    });
    const result = await fetchTravelInfo({ topic: 'train frequency between KL and Ipoh', language: 'en', fetchImpl });
    expect(result.provider).toBe('groq');
    expect(result.summary).toContain('Trains run');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('throws with both providers recorded when neither can answer', async () => {
    vi.stubGlobal('Deno', { env: { get: (name) => ({
      GEMINI_API_KEY: 'gemini-test', GROQ_API_KEY: 'groq-test'
    }[name] || '') } });
    const fetchImpl = vi.fn(async (url) => new Response('{}', {
      status: String(url).includes('generativelanguage.googleapis.com') ? 429 : 503
    }));
    const request = fetchTravelInfo({ topic: 'weather', language: 'en', fetchImpl });
    await expect(request).rejects.toThrow();
    await request.catch((error) => {
      expect(error.providerFailures.map((item) => item.provider)).toEqual(['gemini', 'groq']);
    });
  });

  it('skips a provider that the shared reliability table already marked as cooling down', async () => {
    vi.stubGlobal('Deno', { env: { get: (name) => ({
      GEMINI_API_KEY: 'gemini-test', GROQ_API_KEY: 'groq-test'
    }[name] || '') } });
    const admin = fakeAdmin();
    await admin.schema().from('ai_guide_provider_health').upsert({
      provider: 'gemini', cooldown_until: new Date(Date.now() + 60_000).toISOString(), last_http_status: 429
    });
    let geminiCalls = 0;
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).includes('generativelanguage.googleapis.com')) { geminiCalls += 1; return new Response('{}', { status: 200 }); }
      return new Response(JSON.stringify({ choices: [{ message: {
        content: 'Ferries depart hourly from the jetty.',
        executed_tools: [{ search_results: { results: [{ title: 'Port authority', url: 'https://example.com/port' }] } }]
      } }] }), { status: 200 });
    });
    const result = await fetchTravelInfo({ topic: 'ferry schedule', language: 'en', fetchImpl, admin });
    expect(geminiCalls).toBe(0);
    expect(result.provider).toBe('groq');
  });
});
