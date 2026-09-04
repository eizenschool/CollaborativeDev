import { describe, expect, it } from 'vitest';
import {
  GUIDE_SPEECH_UNSUPPORTED,
  bestGuideSpeechAlternative,
  dedupeGuideTranscriptParts,
  guideSpeechErrorMessage,
  guideSpeechRecognitionLocale,
  isRecoverableBrowserSpeechError,
  isRetryableGuideSpeechError,
  normalizeGuideSpeechTranscript
} from '../../../presentation/components/guide/useGuideSpeechInput.js';

describe('Tumpang Guide Web Speech failure policy', () => {
  it('explains unsupported browsers without blocking typed input', () => {
    expect(GUIDE_SPEECH_UNSUPPORTED).toMatch(/not supported/i);
  });

  it('distinguishes denied microphone permission from recoverable recognition errors', () => {
    expect(guideSpeechErrorMessage('not-allowed')).toMatch(/permission was denied/i);
    expect(guideSpeechErrorMessage('no-speech')).toMatch(/keep typing/i);
    expect(guideSpeechErrorMessage('audio-capture')).toMatch(/microphone/i);
    expect(guideSpeechErrorMessage('network')).toMatch(/speech service/i);
    expect(isRetryableGuideSpeechError('aborted')).toBe(true);
    expect(isRetryableGuideSpeechError('network')).toBe(true);
    expect(isRetryableGuideSpeechError('not-allowed')).toBe(false);
    expect(isRecoverableBrowserSpeechError('no-speech')).toBe(true);
    expect(isRecoverableBrowserSpeechError('aborted')).toBe(true);
    expect(isRecoverableBrowserSpeechError('network')).toBe(false);
  });

  it('normalises common KL recognition variants', () => {
    expect(normalizeGuideSpeechTranscript('kay el bird part')).toBe('KL Bird Park');
    expect(normalizeGuideSpeechTranscript('Kuala Lumper')).toBe('Kuala Lumpur');
  });

  it('uses the explicitly selected speech language instead of guessing from the device', () => {
    expect(guideSpeechRecognitionLocale('en')).toBe('en-MY');
    expect(guideSpeechRecognitionLocale('zh-CN')).toBe('zh-CN');
    expect(guideSpeechRecognitionLocale('ms')).toBe('ms-MY');
    expect(guideSpeechRecognitionLocale('ta')).toBe('ta-MY');
  });

  it('falls back to the browser UI language for the auto option, never forcing English', () => {
    const originalLanguage = Object.getOwnPropertyDescriptor(navigator, 'language');
    Object.defineProperty(navigator, 'language', { value: 'ms-MY', configurable: true });
    expect(guideSpeechRecognitionLocale('auto')).toBe('ms-MY');
    if (originalLanguage) Object.defineProperty(navigator, 'language', originalLanguage);
  });

  it('collapses repeated browser final segments before inserting the draft', () => {
    expect(dedupeGuideTranscriptParts(['test', 'test', 'test'])).toBe('test');
    expect(dedupeGuideTranscriptParts(['KL Bird Park', 'KL Bird Park'])).toBe('KL Bird Park');
  });

  it('catches a replayed final segment that lands a few parts back after an engine restart', () => {
    // A restarted physical recognition object renumbers its own result
    // indexes from zero, so onresult's per-object seenFinalIndexes cannot
    // catch a replay - only the logical session's accumulated text can.
    // Before the fix, dedupe only compared against the single immediately-
    // previous part, so a replay landing two parts back (a new "this
    // weekend" final sits between the original and its replay) slipped
    // through untouched and produced a duplicated draft.
    const partsWithReplayTwoBack = ['KL Bird Park', 'this weekend', 'KL Bird Park'];
    expect(dedupeGuideTranscriptParts(partsWithReplayTwoBack)).toBe('KL Bird Park this weekend');
  });

  it('still merges a plain immediately-adjacent repeat', () => {
    expect(dedupeGuideTranscriptParts(['this weekend', 'KL Bird Park', 'KL Bird Park'])).toBe('this weekend KL Bird Park');
  });

  it('prefers a contextual KL alternative over a higher-confidence homophone', () => {
    const result = {
      0: { transcript: 'kill bird park', confidence: .9 },
      1: { transcript: 'K L bird park', confidence: .55 },
      length: 2
    };
    expect(bestGuideSpeechAlternative(result, ['KL Bird Park'])).toBe('KL bird park');
  });
});
