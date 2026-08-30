import { describe, expect, it } from 'vitest';
import {
  GUIDE_SPEECH_UNSUPPORTED,
  guideSpeechErrorMessage
} from '../../../presentation/components/guide/useGuideSpeechInput.js';

describe('Tumpang Guide Web Speech failure policy', () => {
  it('explains unsupported browsers without blocking typed input', () => {
    expect(GUIDE_SPEECH_UNSUPPORTED).toMatch(/not supported/i);
  });

  it('distinguishes denied microphone permission from recoverable recognition errors', () => {
    expect(guideSpeechErrorMessage('not-allowed')).toMatch(/permission was denied/i);
    expect(guideSpeechErrorMessage('no-speech')).toMatch(/keep typing/i);
  });
});
