import { afterEach, describe, expect, it, vi } from 'vitest';
import { GUIDE_REASON } from '../constants.js';
import { GUIDE_LANGUAGE_OPTIONS, GUIDE_LOCALE, detectGuideLanguage, getInitialGuideLanguage, guideCopy, guideReasonText } from '../GuideLanguage.js';

afterEach(() => vi.unstubAllGlobals());

describe('Tumpang Guide four-language verified templates', () => {
  it.each([
    ['en', 'en-MY'],
    ['zh-CN', 'zh-CN'],
    ['ms', 'ms-MY'],
    ['ta', 'ta-MY']
  ])('maps %s voice input onto the expected Web Speech locale', (language, locale) => {
    expect(GUIDE_LOCALE[language]).toBe(locale);
  });

  it('renders the same verified reason code through each language template', () => {
    const values = ['en', 'zh-CN', 'ms', 'ta'].map((language) => guideReasonText(
      GUIDE_REASON.SEASON,
      { name: 'Official Place Name', category: 'nature' },
      { origin: { label: 'Kuala Lumpur' }, partySize: 2 },
      language
    ));
    expect(values.every(Boolean)).toBe(true);
    expect(new Set(values).size).toBe(4);
  });

  it('keeps core UI copy complete when the provider is unavailable', () => {
    for (const language of ['en', 'zh-CN', 'ms', 'ta']) {
      const copy = guideCopy(language);
      expect(copy.heroTitle).toBeTruthy();
      expect(copy.startingPointPlaceholder).toBeTruthy();
      expect(copy.startVoice).toBeTruthy();
      expect(copy.feedbackBadTradeoff).toBeTruthy();
    }
  });

  it('keeps metadata for all 19 AI-selectable language and region packs', () => {
    expect(GUIDE_LANGUAGE_OPTIONS).toHaveLength(19);
    expect(GUIDE_LANGUAGE_OPTIONS.slice(0, 4).map((item) => item.value))
      .toEqual(['en', 'zh-CN', 'ms', 'ta']);
    expect(new Set(GUIDE_LANGUAGE_OPTIONS.map((item) => item.value)).size).toBe(19);
  });

  it('starts a new user in English and restores the last successful AI language', () => {
    const values = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key)
    });
    expect(getInitialGuideLanguage()).toBe('en');
    localStorage.setItem('letstumpang_m6_guide_language_v1', 'ja');
    expect(getInitialGuideLanguage()).toBe('ja');
  });
});

describe('Tumpang Guide response-language detection (regression: replying "kl" to a Chinese clarifying question flipped the whole conversation to English)', () => {
  it('keeps a bare single-token reply in the conversation\'s existing language instead of treating any Latin letter as an English declaration', () => {
    // "kl"/"jb"/"kk" are place-name aliases this app itself resolves as
    // locations elsewhere (weather.ts's MALAYSIA_CITIES) - one Latin token is
    // not a reliable language signal in either direction.
    expect(detectGuideLanguage('kl', 'zh-CN')).toBe('zh-CN');
    expect(detectGuideLanguage('KLCC', 'zh-CN')).toBe('zh-CN');
    expect(detectGuideLanguage('yes', 'zh-CN')).toBe('zh-CN');
    expect(detectGuideLanguage('123', 'zh-CN')).toBe('zh-CN');
  });

  it('still detects a real multi-word English sentence as English, even mid Chinese/Malay/Tamil conversation', () => {
    expect(detectGuideLanguage('what is the weather like', 'zh-CN')).toBe('en');
    expect(detectGuideLanguage('how long to get there', 'ta')).toBe('en');
  });

  it('still detects Chinese, Malay and Tamil regardless of token count', () => {
    expect(detectGuideLanguage('马六甲', 'en')).toBe('zh-CN');
    expect(detectGuideLanguage('cuaca', 'en')).toBe('ms');
    expect(detectGuideLanguage('வானிலை', 'en')).toBe('ta');
  });

  it('falls back to English only when there is truly no fallback language and no signal at all', () => {
    expect(detectGuideLanguage('kl')).toBe('en');
    expect(detectGuideLanguage('')).toBe('en');
  });
});
