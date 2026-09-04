import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildIntentPrompt, callProviderChain, INTENT_SCHEMA, mergeProviderIntent,
  normalizeStrictJsonSchema, preserveSmallTalkPlan, providerOrder, RECOMMENDATION_COPY_SCHEMA,
  resolveClarificationField, VERIFIED_GUIDE_CAPABILITIES
} from '../providers.ts';
import { normalizeGeminiSchema } from '../gemini.ts';

const emptyConfidence = Object.freeze({
  origin: 0, party: 0, date: 0, preference: 0, budget: 0,
  indoorPreference: 0, accessibilityRequired: 0, children: 0,
  recommendationMode: 0, requestedMode: 0, language: 0
});

function extraction(patch, confidence = {}) {
  return {
    intentPatch: {
      originLabel: '', partySize: 0, startDate: '', endDate: '', preferredCategories: [],
      budget: '', indoorPreference: '', accessibilityRequired: false, children: false,
      recommendationMode: '', requestedMode: '', requestedPlaceName: '', requestedAction: '', ...patch
    },
    confidence: { ...emptyConfidence, ...confidence },
    needsConfirmation: [], nextQuestionField: '', language: 'zh-CN', languageConfidence: .99,
    switchLanguage: true, assistantMessage: '明白了。'
  };
}

// A minimal fake of the Supabase admin client, just enough to back
// providerInCooldown()/recordProviderAttempt() (reliability.ts) against an
// in-memory table instead of a real database. This is now the single shared
// cooldown mechanism callProviderChain() reads/writes (replacing the old
// process-local Map), so a test that wants to prove cooldown behavior across
// two callProviderChain() calls has to give it a fake admin to persist state
// between those calls, the same way a real Edge Function request would via
// private.ai_guide_provider_health.
function createFakeGuideAdmin() {
  const health = new Map();
  const attempts = [];
  return {
    health, attempts,
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
          if (table === 'ai_guide_provider_attempts') {
            return { async insert(row) { attempts.push(row); return { error: null }; } };
          }
          throw new Error(`Unexpected table in fake Guide admin: ${table}`);
        }
      };
    }
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Tumpang Guide AI intent contract', () => {
  it('assigns the complete primary turn to Gemini and the complete backup turn to Groq', () => {
    expect(providerOrder()).toEqual({ primary: 'gemini', secondary: 'groq' });
  });
  it('accepts any still-missing field selected by the AI instead of rejecting a useful clarification', () => {
    const emptyPlan = { language: 'zh-CN', preferredCategories: [] };
    expect(resolveClarificationField(emptyPlan, 'preference')).toMatchObject({
      field: 'preference', providerFieldValid: true
    });
    expect(resolveClarificationField(emptyPlan, 'unspecified')).toMatchObject({
      field: 'origin', providerFieldValid: false
    });
    expect(resolveClarificationField({
      startDate: '2026-09-05', origin: { label: 'Kuala Lumpur' },
      partySize: 2, preferredCategories: []
    }, 'date')).toMatchObject({
      field: 'preference', providerFieldValid: false, missing: ['preference']
    });
  });

  it('provides verified Help context for explaining how to use the Guide', () => {
    expect(VERIFIED_GUIDE_CAPABILITIES.travelPlanning.join(' ')).toContain('catalogue');
    expect(VERIFIED_GUIDE_CAPABILITIES.placeQuestions.join(' ')).toContain('sources');
    expect(VERIFIED_GUIDE_CAPABILITIES.appActions.join(' ')).toContain('confirm');
  });

  it.each(['我們在馬六甲，大概有2個人', '馬六甲'])(
    'sends the exact raw message to the AI understanding layer: %s',
    (message) => {
      const prompt = JSON.parse(buildIntentPrompt({
        message, plan: { language: 'zh-CN' }, recentMessages: [], today: '2026-08-30'
      }));
      expect(prompt.userMessage).toBe(message);
      expect(prompt.instruction).toContain('rules have not interpreted the message');
    }
  );

  it('accepts both Melaka and two people from the exact reported sentence', () => {
    const result = mergeProviderIntent({
      language: 'zh-CN', startDate: '2026-09-01', endDate: '2026-09-01',
      preferredCategories: ['nature']
    }, extraction({ originLabel: '马六甲', partySize: 2 }, { origin: .99, party: .96 }));

    expect(result.plan).toMatchObject({ origin: { label: '马六甲' }, partySize: 2 });
  });

  it('switches the plan language only for a high-confidence meaningful message', () => {
    const switched = mergeProviderIntent({ language: 'en' }, extraction({}, { language: .99 }));
    expect(switched.plan.language).toBe('en');
    expect(switched.responseLanguage).toBe('zh-CN');
    expect(switched.switchLanguage).toBe(true);

    const ambiguous = extraction({}, { language: .4 });
    ambiguous.language = 'ja'; ambiguous.languageConfidence = .4;
    const retained = mergeProviderIntent({ language: 'en' }, ambiguous);
    expect(retained.plan.language).toBe('en');
    expect(retained.responseLanguage).toBe('en');
  });

  it('classifies a named-place activity question as place_info', () => {
    const row = extraction({ requestedMode: 'place_info', requestedPlaceName: 'KL Bird Park' }, { requestedMode: .99 });
    const result = mergeProviderIntent({ language: 'zh-CN' }, row);
    expect(result).toMatchObject({ requestedMode: 'place_info', requestedPlaceName: 'KL Bird Park' });
  });

  it('keeps travel_info instead of silently discarding it to an empty mode (regression: this used to fall through to the recommend/clarify default and loop forever asking for origin)', () => {
    const row = extraction({ requestedMode: 'travel_info', requestedPlaceName: 'KL Bird Park' }, { requestedMode: .99 });
    const result = mergeProviderIntent({ language: 'zh-CN' }, row);
    expect(result.requestedMode).toBe('travel_info');
    expect(result.requestedMode).not.toBe('');
  });

  it.each(['我爱你', '为什么你不理我', 'I love you', 'terima kasih'])('routes casual conversation without requesting places: %s', (message) => {
    const prompt = JSON.parse(buildIntentPrompt({
      message, plan: { language: 'zh-CN' }, recentMessages: [], today: '2026-08-31'
    }));
    expect(prompt.userMessage).toBe(message);
    expect(prompt.smallTalkRouting).toContain('requestedMode to small_talk');
    expect(prompt.smallTalkRouting).toContain('Do not recommend places');

    const result = mergeProviderIntent({ language: 'zh-CN' }, extraction(
      { requestedMode: 'small_talk' }, { requestedMode: .99 }
    ));
    expect(result.requestedMode).toBe('small_talk');
  });

  it('routes a natural save request to a confirmed, verified app action', () => {
    const prompt = JSON.parse(buildIntentPrompt({
      message: '幫我保存這個地點', plan: { language: 'zh-CN' }, recentMessages: [], today: '2026-08-31',
      placeContext: [{ placeId: '11111111-1111-4111-8111-111111111111', name: 'KL Bird Park', role: 'place_info' }]
    }));
    expect(prompt.actionRouting).toContain('record_interest');
    expect(prompt.actionRouting).toContain('require confirmation');
    const result = mergeProviderIntent({ language: 'zh-CN' }, extraction({
      requestedMode: 'action', requestedAction: 'record_interest', requestedPlaceName: 'KL Bird Park'
    }, { requestedMode: .99 }));
    expect(result).toMatchObject({ requestedMode: 'action', requestedAction: 'record_interest', requestedPlaceName: 'KL Bird Park' });
  });

  it('keeps the Travel Brief and interface language unchanged for small talk', () => {
    const original = {
      language: 'en', origin: { label: 'Kuala Lumpur' }, partySize: 2,
      startDate: '2026-09-05', endDate: '2026-09-05', preferredCategories: ['nature']
    };
    const maliciousIntentPlan = {
      language: 'zh-CN', origin: { label: 'Melaka' }, partySize: 9,
      startDate: '2027-01-01', endDate: '2027-01-01', preferredCategories: ['culinary']
    };
    expect(preserveSmallTalkPlan(original, maliciousIntentPlan)).toMatchObject({
      language: 'en', origin: { label: 'Kuala Lumpur' }, partySize: 2,
      startDate: '2026-09-05', endDate: '2026-09-05', preferredCategories: ['nature']
    });
  });

  it('explicitly routes why-a-named-place-was-recommended to place_info rather than Help', () => {
    const prompt = JSON.parse(buildIntentPrompt({
      message: '为什么推荐我去 Omega Pork Noodle SS15',
      plan: { language: 'zh-CN' }, recentMessages: [], today: '2026-08-30'
    }));
    expect(prompt.instruction).toContain('why that named place was recommended');
    expect(prompt.instruction).toContain('not app Help');
  });

  it('supplies only verified recommendation names for contextual references', () => {
    const prompt = JSON.parse(buildIntentPrompt({
      message: 'why the first one?', plan: { language: 'en' }, recentMessages: [], today: '2026-08-30',
      placeContext: [
        { placeId: '11111111-1111-4111-8111-111111111111', name: 'KL Bird Park', role: 'best_match' },
        { placeId: '22222222-2222-4222-8222-222222222222', name: 'Merdeka Square', role: 'practical_alternative' }
      ]
    }));
    expect(prompt.verifiedPlaceContext.map((item) => item.name)).toEqual(['KL Bird Park', 'Merdeka Square']);
    expect(prompt.instruction).toContain('the first one');
  });

  it('normalizes schemas separately for Gemini and Groq strict output', () => {
    const gemini = normalizeGeminiSchema(RECOMMENDATION_COPY_SCHEMA);
    expect(gemini.type).toBe('OBJECT');
    expect(gemini.properties.recommendationCopy.type).toBe('ARRAY');
    expect(gemini.properties.recommendationCopy.items.type).toBe('OBJECT');
    expect(JSON.stringify(gemini)).not.toContain('maxLength');
    const groq = normalizeStrictJsonSchema(RECOMMENDATION_COPY_SCHEMA);
    expect(JSON.stringify(groq)).not.toContain('maxLength');
    expect(groq.required).toEqual(Object.keys(groq.properties));
    expect(groq.properties.recommendationCopy.items.additionalProperties).toBe(false);
    expect(groq.properties.recommendationCopy.items.required)
      .toEqual(Object.keys(groq.properties.recommendationCopy.items.properties));
  });

  it('treats a bare Melaka reply as the missing origin without erasing known fields', () => {
    const result = mergeProviderIntent({
      language: 'zh-CN', partySize: 2, startDate: '2026-09-01', endDate: '2026-09-01',
      preferredCategories: ['event']
    }, extraction({ originLabel: '马六甲' }, { origin: .98 }));

    expect(result.plan).toMatchObject({
      origin: { label: '马六甲' }, partySize: 2, preferredCategories: ['event']
    });
  });

  it('does not merge a low-confidence or confirmation-blocked field', () => {
    const row = extraction({ originLabel: 'Maybe Melaka', partySize: 8 }, { origin: .4, party: .99 });
    row.needsConfirmation = ['party'];
    const result = mergeProviderIntent({ language: 'en', partySize: 2 }, row);
    expect(result.plan.origin).toBeNull();
    expect(result.plan.partySize).toBe(2);
  });

  it('falls back from Gemini to Groq and returns the same strict intent payload', async () => {
    vi.stubGlobal('Deno', { env: { get: (name) => ({
      GEMINI_API_KEY: 'gemini-test', GROQ_API_KEY: 'groq-test',
      M6_GUIDE_GEMINI_MODEL: 'gemini-3.5-flash-lite', M6_GUIDE_GROQ_MODEL: 'openai/gpt-oss-20b'
    }[name] || '') } });
    const payload = extraction({ originLabel: 'Melaka', partySize: 2 }, { origin: .99, party: .99 });
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).includes('generativelanguage.googleapis.com')) return new Response('{}', { status: 429 });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }), { status: 200 });
    });

    const result = await callProviderChain({
      prompt: '{}', responseSchema: INTENT_SCHEMA, primary: 'gemini', secondary: 'groq',
      timeoutMs: 3000, fetchImpl
    });

    expect(result.provider).toBe('groq');
    expect(result.model).toBe('openai/gpt-oss-20b');
    expect(result.value.intentPatch).toMatchObject({ originLabel: 'Melaka', partySize: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('temporarily skips a provider that just returned 429', async () => {
    vi.stubGlobal('Deno', { env: { get: (name) => ({
      GEMINI_API_KEY: 'gemini-test', GROQ_API_KEY: 'groq-test',
      M6_GUIDE_GROQ_MODEL: 'openai/gpt-oss-20b'
    }[name] || '') } });
    const payload = extraction({}, {});
    let geminiCalls = 0;
    let groqCalls = 0;
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).includes('googleapis')) {
        geminiCalls += 1;
        return new Response('{}', { status: 429 });
      }
      groqCalls += 1;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }), { status: 200 });
    });

    const admin = createFakeGuideAdmin();
    await callProviderChain({ prompt: '{}', responseSchema: INTENT_SCHEMA, timeoutMs: 24_000, fetchImpl, admin });
    await callProviderChain({ prompt: '{}', responseSchema: INTENT_SCHEMA, timeoutMs: 24_000, fetchImpl, admin });

    expect(geminiCalls).toBe(1);
    expect(groqCalls).toBe(2);
  });

  it('fails clearly when both providers fail instead of manufacturing a rules response', async () => {
    vi.stubGlobal('Deno', { env: { get: (name) => ({
      GEMINI_API_KEY: 'gemini-test', GROQ_API_KEY: 'groq-test'
    }[name] || '') } });
    const fetchImpl = vi.fn(async (url) => new Response('{}', {
      status: String(url).includes('generativelanguage.googleapis.com') ? 429 : 503
    }));

    const request = callProviderChain({
      prompt: '{}', responseSchema: INTENT_SCHEMA, primary: 'gemini', secondary: 'groq',
      timeoutMs: 3000, fetchImpl
    });
    await expect(request).rejects.toMatchObject({
      message: expect.stringMatching(/groq 503/i),
      failures: [
        expect.objectContaining({ provider: 'gemini', status: 429 }),
        expect.objectContaining({ provider: 'groq', status: 503 })
      ]
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
