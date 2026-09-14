import { describe, expect, it } from 'vitest';
import {
  GUIDE_CONTENT_SAFETY_POLICY_VERSION,
  classifyGuideContent
} from '../GuideContentSafety.js';

describe('Tumpang Guide content safety policy', () => {
  it('masks non-targeted profanity while preserving the travel question', () => {
    const result = classifyGuideContent('damn, where should I go? shit weather today');
    expect(result.decision).toBe('mask');
    expect(result.category).toBe('casual_profanity');
    expect(result.sanitizedText).toContain('where should I go?');
    expect(result.sanitizedText).not.toMatch(/damn|shit/i);
  });

  it('normalises common obfuscation without changing ordinary place words', () => {
    expect(classifyGuideContent('f.u.c.k, show me food near KL').sanitizedText)
      .toMatch(/^\*+, show me food near KL$/i);
    expect(classifyGuideContent('I want food in Johor Bahru').decision).toBe('allow');
  });

  it('blocks targeted insults in the four core language paths', () => {
    expect(classifyGuideContent('you are stupid, now help me').category).toBe('targeted_abuse');
    expect(classifyGuideContent('你这个白痴').category).toBe('targeted_abuse');
    expect(classifyGuideContent('kau memang bodoh').category).toBe('targeted_abuse');
    expect(classifyGuideContent('நீ முட்டாள்').category).toBe('targeted_abuse');
  });

  it('still catches a targeted insult when an intensifier sits between the subject and the insult', () => {
    // Regression test: "you are so stupid" previously slipped through as
    // decision "allow" because the pattern only accepted an optional
    // article ("an idiot"), not an intensifier like "so"/"really"/"such a".
    expect(classifyGuideContent('you are so stupid, I hate this app').decision).toBe('block');
    expect(classifyGuideContent('you are so stupid, I hate this app').category).toBe('targeted_abuse');
    expect(classifyGuideContent("you're really such an idiot").category).toBe('targeted_abuse');
    expect(classifyGuideContent('so stupid').category).toBe('targeted_abuse');
  });

  it('blocks threats and keeps an urgent help request on the emergency path', () => {
    expect(classifyGuideContent('I will kill you').decision).toBe('block');
    expect(classifyGuideContent('我正在被攻击，拨打 999').decision).toBe('emergency');
    expect(classifyGuideContent('Damn, I am in danger, please help me now.').decision).toBe('emergency');
  });

  it('routes self-harm intent to its own decision, distinct from threat/emergency/abuse', () => {
    // "kill myself" must never be caught by the "kill you/him/her/them"
    // threat rule (wrong object), scored as targeted abuse, or answered with
    // the external-danger emergency copy ("call 999 for the police").
    expect(classifyGuideContent('I want to kill myself').decision).toBe('self_harm');
    expect(classifyGuideContent('I want to kill myself').category).toBe('self_harm');
    expect(classifyGuideContent('我不想活了').decision).toBe('self_harm');
    expect(classifyGuideContent('saya nak bunuh diri').decision).toBe('self_harm');
    expect(classifyGuideContent('எனக்கு செத்துவிடணும்').decision).toBe('self_harm');
  });

  it('never masks or drops self-harm wording the way it would ordinary profanity', () => {
    const result = classifyGuideContent('I really want to die, can you help me find somewhere quiet');
    expect(result.decision).toBe('self_harm');
    expect(result.sanitizedText).toContain('die');
  });

  it('does not expose matched words and reports a stable policy version', () => {
    const result = classifyGuideContent('you are stupid');
    expect(result).toEqual({
      decision: 'block', category: 'targeted_abuse', sanitizedText: '', languageHints: ['en'],
      policyVersion: GUIDE_CONTENT_SAFETY_POLICY_VERSION
    });
    expect(result).not.toHaveProperty('matches');
  });
});
