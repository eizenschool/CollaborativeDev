import { useCallback, useEffect, useRef, useState } from 'react';
import { GUIDE_LOCALE } from '../../../business-logic/guide/GuideLanguage.js';

export const GUIDE_SPEECH_UNSUPPORTED = 'Voice input is not supported by this browser.';

export function guideSpeechErrorMessage(errorCode, copy = {}) {
  if (errorCode === 'not-allowed' || errorCode === 'service-not-allowed') return copy.voicePermissionDenied || 'Microphone permission was denied.';
  if (errorCode === 'no-speech') return copy.voiceNoSpeech || 'No speech was recognised. You can keep typing.';
  if (errorCode === 'language-not-supported') return copy.voiceLanguageUnsupported || 'This language is not supported for voice input. You can keep typing.';
  return copy.voiceStopped || 'Voice input stopped. You can keep typing.';
}

export function useGuideSpeechInput({ language, copy = {}, onTranscript, onInterim }) {
  const recognitionRef = useRef(null);
  const [listening, setListening] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const supported = typeof window !== 'undefined'
    && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

  useEffect(() => () => recognitionRef.current?.abort?.(), []);

  const start = useCallback(() => {
    if (!supported) { setError(copy.voiceUnsupported || GUIDE_SPEECH_UNSUPPORTED); return; }
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new Recognition();
    recognition.lang = GUIDE_LOCALE[language] || language || GUIDE_LOCALE.en;
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onstart = () => { setError(''); setProcessing(false); setListening(true); };
    recognition.onresult = (event) => {
      let interim = '';
      let finalText = '';
      for (let index = event.resultIndex || 0; index < event.results.length; index += 1) {
        const text = event.results[index]?.[0]?.transcript || '';
        if (event.results[index].isFinal) finalText += text;
        else interim += text;
      }
      if (interim) onInterim?.(interim);
      if (finalText) onTranscript?.(finalText);
    };
    recognition.onerror = (event) => {
      setError(guideSpeechErrorMessage(event.error, copy));
      setListening(false); setProcessing(false);
    };
    recognition.onend = () => { setListening(false); setProcessing(false); };
    recognitionRef.current = recognition;
    setError(''); setProcessing(true); setListening(true);
    try { recognition.start(); } catch { setError(copy.voiceStartFailed || 'Voice input could not start. You can keep typing.'); setListening(false); setProcessing(false); }
  }, [copy, language, onInterim, onTranscript, supported]);

  const stop = useCallback(() => {
    setProcessing(true);
    recognitionRef.current?.stop?.();
  }, []);
  return { supported, listening, processing, error, start, stop };
}
