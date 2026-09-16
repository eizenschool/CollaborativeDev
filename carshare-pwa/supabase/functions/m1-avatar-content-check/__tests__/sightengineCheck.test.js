import { describe, expect, it, vi } from 'vitest';
import { checkImageWithSightengine } from '../sightengineCheck.ts';

function sightengineResponse({ nudity = {}, gore = {}, offensive = {}, text = '' } = {}) {
  return new Response(JSON.stringify({
    status: 'success',
    nudity: {
      sexual_activity: 0.001, sexual_display: 0.001, erotica: 0.001,
      very_suggestive: 0.001, suggestive: 0.001, mildly_suggestive: 0.001,
      none: 0.99, ...nudity
    },
    gore: { prob: 0.001, ...gore },
    offensive: {
      nazi: 0.001, asian_swastika: 0.001, confederate: 0.001,
      supremacist: 0.001, terrorist: 0.001, middle_finger: 0.001, ...offensive
    },
    text: { content: text },
    media: { id: 'med_test', uri: 'avatar' }
  }), { status: 200 });
}

describe('Module 1 avatar content check - Sightengine provider (sightengineCheck.ts)', () => {
  it('returns a clean verdict for an ordinary photo with no text', async () => {
    const fetchImpl = vi.fn(async () => sightengineResponse());
    const result = await checkImageWithSightengine({
      apiUser: 'user', apiSecret: 'secret', imageBase64: 'ZmFrZQ==', fetchImpl
    });
    expect(result).toEqual({ flagged: false, categories: [], reason: 'No issues found.' });
  });

  it('flags gore at or above the 0.5 threshold', async () => {
    const fetchImpl = vi.fn(async () => sightengineResponse({ gore: { prob: 0.6 } }));
    const result = await checkImageWithSightengine({
      apiUser: 'user', apiSecret: 'secret', imageBase64: 'ZmFrZQ==', fetchImpl
    });
    expect(result.flagged).toBe(true);
    expect(result.categories).toEqual(['graphic_violence']);
  });

  it('flags explicit nudity classes as sexual_content, deduped if multiple trigger', async () => {
    const fetchImpl = vi.fn(async () => sightengineResponse({
      nudity: { sexual_activity: 0.9, sexual_display: 0.7 }
    }));
    const result = await checkImageWithSightengine({
      apiUser: 'user', apiSecret: 'secret', imageBase64: 'ZmFrZQ==', fetchImpl
    });
    expect(result.categories).toEqual(['sexual_content']);
  });

  it('does NOT flag merely "suggestive" nudity classes (ordinary swimwear/gym photos stay clean)', async () => {
    const fetchImpl = vi.fn(async () => sightengineResponse({
      nudity: { suggestive: 0.95, mildly_suggestive: 0.95 }
    }));
    const result = await checkImageWithSightengine({
      apiUser: 'user', apiSecret: 'secret', imageBase64: 'ZmFrZQ==', fetchImpl
    });
    expect(result.flagged).toBe(false);
  });

  it('does NOT flag below the 0.5 threshold', async () => {
    const fetchImpl = vi.fn(async () => sightengineResponse({
      nudity: { sexual_activity: 0.49 }, gore: { prob: 0.49 }
    }));
    const result = await checkImageWithSightengine({
      apiUser: 'user', apiSecret: 'secret', imageBase64: 'ZmFrZQ==', fetchImpl
    });
    expect(result.flagged).toBe(false);
  });

  it('flags a hate/extremist symbol', async () => {
    const fetchImpl = vi.fn(async () => sightengineResponse({ offensive: { nazi: 0.8 } }));
    const result = await checkImageWithSightengine({
      apiUser: 'user', apiSecret: 'secret', imageBase64: 'ZmFrZQ==', fetchImpl
    });
    expect(result.categories).toEqual(['hate_or_extremist_symbols']);
  });

  it('flags an offensive gesture (middle_finger) - a category Vision/SafeSearch cannot detect', async () => {
    const fetchImpl = vi.fn(async () => sightengineResponse({ offensive: { middle_finger: 0.75 } }));
    const result = await checkImageWithSightengine({
      apiUser: 'user', apiSecret: 'secret', imageBase64: 'ZmFrZQ==', fetchImpl
    });
    expect(result.categories).toEqual(['offensive_gesture']);
  });

  it('flags an ID document from OCR text - MyKad keyword', async () => {
    const fetchImpl = vi.fn(async () => sightengineResponse({ text: 'KAD PENGENALAN MALAYSIA\nMYKAD\nDANIEL LIM' }));
    const result = await checkImageWithSightengine({
      apiUser: 'user', apiSecret: 'secret', imageBase64: 'ZmFrZQ==', fetchImpl
    });
    expect(result.flagged).toBe(true);
    expect(result.categories).toEqual(['identity_document']);
  });

  it('flags an ID document from OCR text - a 12-digit IC-number pattern', async () => {
    const fetchImpl = vi.fn(async () => sightengineResponse({ text: 'Some random text 950101-14-5678 more text' }));
    const result = await checkImageWithSightengine({
      apiUser: 'user', apiSecret: 'secret', imageBase64: 'ZmFrZQ==', fetchImpl
    });
    expect(result.categories).toEqual(['identity_document']);
  });

  it('flags visible personal information from OCR text - a phone number', async () => {
    const fetchImpl = vi.fn(async () => sightengineResponse({ text: 'Call me at 012-345 6789 anytime' }));
    const result = await checkImageWithSightengine({
      apiUser: 'user', apiSecret: 'secret', imageBase64: 'ZmFrZQ==', fetchImpl
    });
    expect(result.categories).toEqual(['personal_information_visible']);
  });

  it('flags visible personal information from OCR text - an email address', async () => {
    const fetchImpl = vi.fn(async () => sightengineResponse({ text: 'contact daniel@example.com for details' }));
    const result = await checkImageWithSightengine({
      apiUser: 'user', apiSecret: 'secret', imageBase64: 'ZmFrZQ==', fetchImpl
    });
    expect(result.categories).toEqual(['personal_information_visible']);
  });

  it('sends the image as multipart form-data with a media file field, api_user, api_secret, and models', async () => {
    const fetchImpl = vi.fn(async () => sightengineResponse());
    await checkImageWithSightengine({
      apiUser: 'user-123', apiSecret: 'secret-abc', imageBase64: 'ZmFrZQ==', mimeType: 'image/png', fetchImpl
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe('https://api.sightengine.com/1.0/check.json');
    expect(init.method).toBe('POST');
    const form = init.body;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get('api_user')).toBe('user-123');
    expect(form.get('api_secret')).toBe('secret-abc');
    expect(form.get('models')).toBe('nudity-2.1,gore-2.0,offensive-2.0,ocr');
    const media = form.get('media');
    expect(media).toBeInstanceOf(Blob);
    expect(media.type).toBe('image/png');
  });

  it('throws with the Sightengine status on a non-OK response, for the caller to decide fail-open', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ status: 'failure', error: { message: 'quota exceeded' } }), { status: 429 }));
    await expect(checkImageWithSightengine({
      apiUser: 'user', apiSecret: 'secret', imageBase64: 'ZmFrZQ==', fetchImpl
    })).rejects.toMatchObject({ status: 429 });
  });

  it('throws on a 200 response whose body reports status "failure"', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ status: 'failure', error: { message: 'invalid api_secret' } }), { status: 200 }));
    await expect(checkImageWithSightengine({
      apiUser: 'user', apiSecret: 'bad-secret', imageBase64: 'ZmFrZQ==', fetchImpl
    })).rejects.toThrow(/invalid api_secret/);
  });

  it('retries once on a transient failure before succeeding', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      .mockResolvedValueOnce(sightengineResponse());
    const result = await checkImageWithSightengine({
      apiUser: 'user', apiSecret: 'secret', imageBase64: 'ZmFrZQ==', fetchImpl
    });
    expect(result.flagged).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

// Regression: visionCheck.ts (the Google Cloud Vision provider) was deleted
// when this check moved to Sightengine-only, after Vision turned out
// non-deployable live (a Google Cloud billing-account "payment anomaly"
// blocking even its free tier - see docs/ai/DECISIONS.md, D039). Before
// that, contentCheck.ts (the Gemini-based provider) was deleted for the
// same reason - three separate live issues in one session. index.ts (not
// this file) owns the actual provider wiring and has `jsr:`/`npm:` imports
// Vitest cannot resolve (see vitest.config.js), so this reads its source
// text directly rather than importing it, the same way the project's own
// SQL contract tests read `.sql` files without executing them.
describe('index.ts uses Sightengine only - Vision and Gemini fully removed from this function', () => {
  it('has no active reference to GOOGLE_VISION_API_KEY, GEMINI_API_KEY, a Gemini endpoint, or the deleted visionCheck.ts/contentCheck.ts (prose explaining the history is fine)', async () => {
    const source = await import('node:fs/promises').then(({ readFile }) => readFile(
      new URL('../index.ts', import.meta.url), 'utf8'
    ));
    expect(source).not.toContain('GEMINI_API_KEY');
    expect(source).not.toContain('GOOGLE_VISION_API_KEY');
    expect(source).not.toContain('generativelanguage.googleapis.com');
    expect(source).not.toContain('contentCheck.ts');
    expect(source).not.toContain('checkAvatarImage');
    expect(source).not.toContain('checkImageWithVision');
    expect(source).toContain('SIGHTENGINE_API_USER');
    expect(source).toContain('SIGHTENGINE_API_SECRET');
    expect(source).toContain('./sightengineCheck.ts');
  });

  it('never modified Module 6 - m6-tumpang-guide keeps its own Gemini usage untouched', async () => {
    const source = await import('node:fs/promises').then(({ readFile }) => readFile(
      new URL('../../m6-tumpang-guide/gemini.ts', import.meta.url), 'utf8'
    ));
    expect(source).toContain('generativelanguage.googleapis.com');
  });
});
