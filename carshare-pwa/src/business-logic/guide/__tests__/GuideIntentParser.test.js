import { describe, expect, it } from 'vitest';
import { dateRangeDays, mergeGuideIntent, normalizePlanState, sanitizedPlanSummary } from '../GuideIntentParser.js';

describe('Tumpang Guide intent parser', () => {
  const today = '2026-08-30';

  it.each([
    ['en', '2 people from Kuala Lumpur want nature tomorrow'],
    ['zh-CN', '明天从吉隆坡出发，3人想看自然'],
    ['ms', '4 orang dari Kuala Lumpur mahu makanan esok'],
    ['ta', 'நாளை Kuala Lumpur இருந்து 2 பேர் இயற்கை பார்க்க வேண்டும்']
  ])('parses a controlled %s request without an LLM', (language, text) => {
    const plan = mergeGuideIntent({ language }, text, { today });
    expect(plan.language).toBe(language);
    expect(plan.startDate).toBe('2026-08-31');
    expect(plan.origin?.label).toBeTruthy();
    expect(plan.partySize).toBeGreaterThanOrEqual(2);
    expect(plan.preferredCategories.length).toBeGreaterThan(0);
  });

  it('caps a date range at seven inclusive days', () => {
    expect(dateRangeDays('2026-09-01', '2026-09-30')).toEqual([
      '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04',
      '2026-09-05', '2026-09-06', '2026-09-07'
    ]);
    expect(normalizePlanState({ startDate: '2026-09-01', endDate: '2026-09-30' }).endDate).toBe('2026-09-07');
  });

  it('understands written party sizes so natural English does not trigger a duplicate question', () => {
    const plan = mergeGuideIntent({ language: 'en' }, 'Two people from Kuala Lumpur want nature tomorrow', { today });
    expect(plan.partySize).toBe(2);
  });

  it('falls back from an empty QA date and never leaks exact coordinates into the model summary', () => {
    const plan = mergeGuideIntent({ origin: { label: 'Current location', lat: 3.139, lng: 101.6869 } }, 'today', { today: '' });
    expect(plan.startDate).toMatch(/^20\d{2}-\d{2}-\d{2}$/);
    expect(sanitizedPlanSummary(plan).origin).toEqual({ label: 'Current location' });
  });
});
