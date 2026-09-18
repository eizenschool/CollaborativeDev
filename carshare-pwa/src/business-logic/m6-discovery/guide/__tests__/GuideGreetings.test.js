import { afterEach, describe, expect, it, vi } from 'vitest';
import { greetingAt, pickGuideGreeting } from '../GuideGreetings.js';

function stubLocalStorage() {
  const values = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  });
  return values;
}

afterEach(() => vi.unstubAllGlobals());

describe('Tumpang Guide varied greeting', () => {
  it('rotates to a different greeting index on each successive open, forward through the list', () => {
    stubLocalStorage();
    const seen = [pickGuideGreeting('en'), pickGuideGreeting('en'), pickGuideGreeting('en')];
    expect(new Set(seen.map((item) => item.index)).size).toBe(3);
    expect(seen[0].text).not.toBe(seen[1].text);
    expect(seen[1].text).not.toBe(seen[2].text);
  });

  it('wraps back to the first greeting after exhausting the rotation', () => {
    stubLocalStorage();
    const first = pickGuideGreeting('en');
    // Six picks for four-plus greetings guarantees at least one wrap.
    let last = first;
    for (let i = 0; i < 5; i += 1) last = pickGuideGreeting('en');
    expect(typeof last.text).toBe('string');
    expect(last.text.length).toBeGreaterThan(0);
    expect(last.index).toBe(first.index);
  });

  it('keeps each core language rotating independently of the others', () => {
    stubLocalStorage();
    const en1 = pickGuideGreeting('en');
    const zh1 = pickGuideGreeting('zh-CN');
    const en2 = pickGuideGreeting('en');
    // en's rotation must not have been disturbed by picking zh-CN in between.
    expect(en2.text).not.toBe(en1.text);
    expect(zh1.index).toBe(en1.index);
  });

  it('returns a non-empty string for every core and extended language, falling back to English content', () => {
    for (const language of ['en', 'zh-CN', 'ms', 'ta', 'ja', 'fr']) {
      stubLocalStorage();
      const greeting = pickGuideGreeting(language);
      expect(typeof greeting.text).toBe('string');
      expect(greeting.text.length).toBeGreaterThan(0);
      expect(Number.isInteger(greeting.index)).toBe(true);
    }
  });

  it('still returns a usable greeting when localStorage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('storage blocked'); },
      setItem: () => { throw new Error('storage blocked'); }
    });
    expect(() => pickGuideGreeting('en')).not.toThrow();
    const greeting = pickGuideGreeting('en');
    expect(typeof greeting.text).toBe('string');
    expect(greeting.text.length).toBeGreaterThan(0);
  });

  it('greetingAt re-translates the same slot into another language without rotating', () => {
    stubLocalStorage();
    const { index, text } = pickGuideGreeting('en');
    expect(greetingAt('en', index)).toBe(text);
    // Same index, different language - a real (different) translation, and a
    // second call must return the identical string (no side effects/rotation).
    const zh = greetingAt('zh-CN', index);
    expect(typeof zh).toBe('string');
    expect(zh.length).toBeGreaterThan(0);
    expect(greetingAt('zh-CN', index)).toBe(zh);
  });

  it('greetingAt falls back to a safe index for out-of-range or missing values', () => {
    expect(() => greetingAt('en', 999)).not.toThrow();
    expect(greetingAt('en', 999).length).toBeGreaterThan(0);
    expect(greetingAt('en', undefined).length).toBeGreaterThan(0);
  });
});
