import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  callGeminiGroundedPlaceInfo, fetchGroundedPlaceInfo, matchCataloguePlaces,
  resetPlaceInfoReliabilityStateForTests, structureGroqSearchText
} from '../placeInfo.ts';

const birdPark = {
  id: 'p-bird', name: 'KL Bird Park', state: 'Kuala Lumpur', category: 'nature', lifecycle_state: 'Active'
};

afterEach(() => {
  resetPlaceInfoReliabilityStateForTests();
  vi.unstubAllGlobals();
});

describe('Tumpang Guide controlled place information', () => {
  it('turns Groq search markdown into compact spotlight sections', () => {
    const content = structureGroqSearchText(
      "**What's fun at KL Bird Park?** - **Free-flight walk-in aviary** – Stroll among 2000 birds of 200 species.【1†L8-L13】 - **Daily bird shows** – Performances run at scheduled times. - **Opening hours** – 9:00 am to 5:30 pm daily.【1†L14-L19】 - **Admission fees** – Check current official prices before visiting.",
      'KL Bird Park'
    );
    expect(content.summary).toBe('Free-flight walk-in aviary: Stroll among 2000 birds of 200 species.');
    expect(content.highlights).toEqual(['Daily bird shows: Performances run at scheduled times.']);
    expect(content.practicalNotes).toEqual([
      'Opening hours: 9:00 am to 5:30 pm daily.',
      'Admission fees: Check current official prices before visiting.'
    ]);
    expect(JSON.stringify(content)).not.toContain('**');
    expect(JSON.stringify(content)).not.toContain('†L');
  });

  it('drops a fact cut off mid-word by the provider token budget instead of showing a half sentence', () => {
    const content = structureGroqSearchText(
      "**What's fun at KL Bird Park?** - **Free-flight walk-in aviary** – Stroll among 2000 birds of 200 species. - **Opening hours** – 9:00 am to 5:30 pm daily. - **Suggested visit** – Walk through the first two zones then get comfortable and ta",
      'KL Bird Park'
    );
    expect(content.summary).toBe('Free-flight walk-in aviary: Stroll among 2000 birds of 200 species.');
    expect(content.practicalNotes).toEqual(['Opening hours: 9:00 am to 5:30 pm daily.']);
    // The truncated "Suggested visit" fact never appears - not as a half
    // sentence, not anywhere in the output.
    expect(JSON.stringify(content)).not.toContain('Suggested visit');
    expect(JSON.stringify(content)).not.toContain('and ta');
  });

  it('trims a cut-off fact back to its last complete clause when one exists', () => {
    const content = structureGroqSearchText(
      "**What's fun at KL Bird Park?** - **Facilities** – Luggage storage is available near the entrance; a gift shop sells souvenirs and ot",
      'KL Bird Park'
    );
    expect(content.summary).toBe('Facilities: Luggage storage is available near the entrance;');
    expect(JSON.stringify(content)).not.toContain('and ot');
  });

  it('turns a flattened Groq markdown table into card sections without HTML or table syntax', () => {
    const content = structureGroqSearchText(
      "KL Bird Park – What's fun to do | Feature | Details (verified) | |----------------|----------------| | Location | 920 Jalan Cenderawasih, Kuala Lumpur | | Opening hours | Daily 9:00 a.m. – 5:30 p.m. | | Admission fees | • Adult RM 90<br>• Child RM 70 | Accessibility | Majority of the park is wheelchair-accessible | Main attractions | • *Free-flight walk-in aviary* with over 3,000 birds<br>• *Bird shows* at scheduled times | Facilities | • Luggage storage<br>• Hornbill Restaurant | Why it fits a nature-focused visit | • Immersive bird-watching experience<br>• Shaded pathways | Bottom line: KL Bird Park offers a well-structured nature visit.",
      'KL Bird Park'
    );
    expect(content.summary).toBe('KL Bird Park offers a well-structured nature visit.');
    expect(content.highlights).toEqual([
      'Free-flight walk-in aviary with over 3,000 birds',
      'Bird shows at scheduled times',
      'Immersive bird-watching experience',
      'Shaded pathways'
    ]);
    expect(content.practicalNotes).toEqual([
      'Opening hours: Daily 9:00 a.m. – 5:30 p.m.',
      'Admission fees: Adult RM 90; Child RM 70',
      'Accessibility: Majority of the park is wheelchair-accessible',
      'Facilities: Luggage storage; Hornbill Restaurant'
    ]);
    expect(JSON.stringify(content)).not.toMatch(/<br|\*|\|/u);
  });

  it('matches only recommendable catalogue places', () => {
    const matches = matchCataloguePlaces([
      birdPark,
      { ...birdPark, id: 'retired', lifecycle_state: 'Retired' },
      { id: 'other', name: 'Perdana Botanical Gardens', lifecycle_state: 'Active' }
    ], 'KL Bird Park');
    expect(matches.map((row) => row.id)).toEqual(['p-bird']);
    expect(matchCataloguePlaces([birdPark], 'Unknown Overseas Place')).toEqual([]);
  });

  it('returns grounded content and rejects unsafe citation URLs', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ steps: [{
      type: 'model_output', content: [{ text: JSON.stringify({
        summary: 'A large free-flight aviary experience.', highlights: ['Walk through aviaries'],
        audience: ['Families'], practicalNotes: ['Check the official site before visiting']
      }), annotations: [
        { title: 'Malaysia tourism', url: 'https://www.malaysia.travel/kl-bird-park' },
        { title: 'Unsafe', url: 'javascript:alert(1)' }
      ] }]
    }] }), { status: 200 }));

    const result = await callGeminiGroundedPlaceInfo({
      apiKey: 'test', model: 'gemini-test', place: birdPark, language: 'zh-CN',
      userMessage: 'KL Bird Park 有什么好玩的', fetchImpl
    });
    expect(result.provider).toBe('gemini');
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].url).toMatch(/^https:/);
    const request = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(request.response_format.type).toBe('text');
    expect(request.response_format.mime_type).toBe('application/json');
    expect(request.response_format.schema.type).toBe('object');
    expect(request.response_format.schema.properties.highlights.type).toBe('array');
    expect(request.response_format.schema.properties.highlights.items.type).toBe('string');
    expect(request.tools).toEqual([{ type: 'google_search' }]);
  });

  it('reuses an identical live place result briefly instead of spending provider quota twice', async () => {
    vi.stubGlobal('Deno', { env: { get: (name) => ({ GEMINI_API_KEY: 'gemini-test' }[name] || '') } });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ steps: [{
      type: 'model_output', content: [{ text: JSON.stringify({
        summary: 'A cited aviary visit.', highlights: ['Walk-through habitat'],
        audience: ['Families'], practicalNotes: []
      }), annotations: [{ title: 'Official venue', url: 'https://www.klbirdpark.com/' }] }]
    }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchImpl);

    const request = { place: birdPark, language: 'en', userMessage: 'What is fun there?' };
    const first = await fetchGroundedPlaceInfo(request);
    const second = await fetchGroundedPlaceInfo(request);

    expect(first.sourceStatus).toBe('live');
    expect(second.cacheStatus).toBe('hit');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('falls back from Gemini search to Groq browser search', async () => {
    vi.stubGlobal('Deno', { env: { get: (name) => ({
      GEMINI_API_KEY: 'gemini-test', GROQ_API_KEY: 'groq-test',
      M6_GUIDE_GEMINI_MODEL: 'gemini-test', M6_GUIDE_GROQ_MODEL: 'groq-test'
    }[name] || '') } });
    let groqCalls = 0;
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).includes('generativelanguage.googleapis.com')) return new Response('{}', { status: 429 });
      groqCalls += 1;
      if (groqCalls === 1) return new Response(JSON.stringify({ choices: [{ message: {
        content: 'Current evidence about the verified venue.',
        executed_tools: [{ search_results: { results: [{ title: 'Official venue', url: 'https://www.klbirdpark.com/' }] } }]
      } }] }), { status: 200 });
      return new Response(JSON.stringify({ choices: [{ message: {
        content: JSON.stringify({ summary: 'Verified venue overview.', highlights: ['Aviaries'], audience: ['Families'], practicalNotes: [] })
      } }] }), { status: 200 });
    });
    const result = await fetchGroundedPlaceInfo({ place: birdPark, language: 'en', userMessage: 'What can I do there?', fetchImpl });
    expect(result.provider).toBe('groq');
    expect(result.formatStatus).toBe('structured');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const groqRequest = JSON.parse(fetchImpl.mock.calls[1][1].body);
    expect(groqRequest.model).toBe('groq-test');
    expect(groqRequest.tools).toEqual([{ type: 'browser_search' }]);
    expect(groqRequest.tool_choice).toBe('required');
    expect(groqRequest).not.toHaveProperty('citation_options');
    expect(groqRequest.messages[0].content).not.toContain('Return one JSON object');
    const formatRequest = JSON.parse(fetchImpl.mock.calls[2][1].body);
    expect(formatRequest).not.toHaveProperty('tools');
    expect(formatRequest.response_format.json_schema.strict).toBe(true);
  });

  it('keeps grounded Groq text when the optional formatter is rejected', async () => {
    vi.stubGlobal('Deno', { env: { get: (name) => ({
      GROQ_API_KEY: 'groq-test', M6_GUIDE_GROQ_MODEL: 'openai/gpt-oss-20b'
    }[name] || '') } });
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return new Response(JSON.stringify({ choices: [{ message: {
        content: 'KL Bird Park has walk-through aviaries and scheduled bird presentations.',
        executed_tools: [{ search_results: { results: [{ title: 'Official venue', url: 'https://www.klbirdpark.com/' }] } }]
      } }] }), { status: 200 });
      return new Response(JSON.stringify({ error: { message: 'Structured output unavailable' } }), { status: 400 });
    });
    const result = await fetchGroundedPlaceInfo({
      place: birdPark, language: 'en', userMessage: 'What is fun there?', fetchImpl
    });
    expect(result.provider).toBe('groq');
    expect(result.sourceStatus).toBe('live');
    expect(result.formatStatus).toBe('search_text');
    expect(result.summary).toContain('walk-through aviaries');
    expect(result.sources).toEqual([{ title: 'Official venue', url: 'https://www.klbirdpark.com/' }]);
  });

  it('uses only previous public venue facts for a deeper follow-up and keeps practical data out of the summary', async () => {
    vi.stubGlobal('Deno', { env: { get: (name) => ({
      GROQ_API_KEY: 'groq-test', M6_GUIDE_GROQ_MODEL: 'openai/gpt-oss-20b'
    }[name] || '') } });
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return new Response(JSON.stringify({ choices: [{ message: {
        content: "KL Bird Park | Main attractions | • Free-flight aviary<br>• Bird presentations | Why it fits a nature-focused visit | • An immersive bird-watching visit | Opening hours | Check the official schedule | Bottom line: Visitors can explore a large walk-through habitat and observe birds at close range.",
        executed_tools: [{ search_results: { results: [{ title: 'Official venue', url: 'https://www.klbirdpark.com/' }] } }]
      } }] }), { status: 200 });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        summary: 'Admission fees: Adult RM90.', highlights: [], audience: [],
        practicalNotes: ['Opening hours: Check the official schedule']
      }) } }] }), { status: 200 });
    });
    const result = await fetchGroundedPlaceInfo({
      place: birdPark, language: 'en', userMessage: 'Can you explain in more detail?',
      previousPublicFacts: 'Previous public venue facts for KL Bird Park. Already covered activities: Bird feeding.',
      fetchImpl
    });
    const researchPrompt = JSON.parse(JSON.parse(fetchImpl.mock.calls[0][1].body).messages[0].content);
    expect(researchPrompt.previousPublicVenueFacts).toContain('Already covered activities: Bird feeding');
    expect(result.summary).toBe('Visitors can explore a large walk-through habitat and observe birds at close range.');
    expect(result.highlights).toContain('Free-flight aviary');
    expect(result.practicalNotes).toEqual(['Opening hours: Check the official schedule']);
  });

  it('preserves safe provider details when both live searches are rejected', async () => {
    vi.stubGlobal('Deno', { env: { get: (name) => ({
      GEMINI_API_KEY: 'gemini-test', GROQ_API_KEY: 'groq-test',
      M6_GUIDE_GEMINI_SEARCH_MODEL: 'gemini-search-test', M6_GUIDE_GROQ_MODEL: 'groq-test'
    }[name] || '') } });
    const fetchImpl = vi.fn(async (url) => new Response(JSON.stringify({
      error: { message: String(url).includes('googleapis') ? 'Unsupported schema' : 'Invalid request' }
    }), { status: 400 }));
    let failure;
    try {
      await fetchGroundedPlaceInfo({ place: birdPark, language: 'en', userMessage: 'Why?', fetchImpl });
    } catch (error) { failure = error; }
    expect(failure.providerFailures).toEqual([
      { provider: 'gemini', status: 400, reason: 'gemini search 400: Unsupported schema' },
      { provider: 'groq', status: 400, reason: 'groq search 400: Invalid request' }
    ]);
  });
});
