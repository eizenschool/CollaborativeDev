import { describe, expect, it } from 'vitest';
import { GUIDE_REASON } from '../constants.js';
import { GUIDE_LOCALE, guideCopy, guideReasonText } from '../GuideLanguage.js';

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
});
