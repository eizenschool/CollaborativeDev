import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TRANSLATION_LANGUAGES } from '../../../business-logic/MessagingService.js';
import { IconX } from '../icons.jsx';

const VOICE_LOCALES = {
  en: ['en-MY', 'en-GB', 'en-US', 'en'],
  zh: ['zh-CN', 'zh-SG', 'zh-TW', 'zh'],
  ms: ['ms-MY', 'ms'],
  ta: ['ta-MY', 'ta-IN', 'ta'],
};

function findVoice(voices, language) {
  const preferences = VOICE_LOCALES[language] || [];
  for (const locale of preferences) {
    const exact = voices.find((voice) => voice.lang.toLowerCase() === locale.toLowerCase());
    if (exact) return exact;
  }
  return voices.find((voice) => preferences.some((locale) =>
    voice.lang.toLowerCase().startsWith(locale.toLowerCase()),
  )) || null;
}

function useSpeechVoice(language) {
  const [voices, setVoices] = useState([]);
  useEffect(() => {
    if (!('speechSynthesis' in window)) return undefined;
    const update = () => setVoices(window.speechSynthesis.getVoices());
    update();
    window.speechSynthesis.addEventListener?.('voiceschanged', update);
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', update);
  }, []);
  return useMemo(() => findVoice(voices, language), [language, voices]);
}

export default function MessageTranslation({
  message,
  targetLanguage,
  onTargetLanguageChange,
  onTranslate,
  isVoiceMessage = false,
}) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showLanguages, setShowLanguages] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isResultDismissed, setIsResultDismissed] = useState(false);
  const requestSequence = useRef(0);
  const speechVoice = useSpeechVoice(result?.targetLanguage || targetLanguage);
  const canSpeak = Boolean(result && speechVoice && 'speechSynthesis' in window);

  useEffect(() => {
    requestSequence.current += 1;
    setResult(null);
    setError('');
    setIsLoading(false);
    setIsResultDismissed(false);
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    setIsSpeaking(false);
  }, [message.editedAt, message.deletedAt]);

  useEffect(() => () => {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }, []);

  const translate = useCallback(async (language) => {
    if (!language) {
      setShowLanguages(true);
      return;
    }
    if (navigator.onLine === false) {
      setError('Translation needs an internet connection. Your original message is still available.');
      return;
    }
    const sequence = ++requestSequence.current;
    setIsLoading(true);
    setError('');
    setIsResultDismissed(false);
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    setIsSpeaking(false);
    try {
      const translated = await onTranslate(message.id, language);
      if (requestSequence.current === sequence) {
        setResult(translated);
        setIsResultDismissed(false);
      }
    } catch (translationError) {
      if (requestSequence.current !== sequence) return;
      const fallback = translationError?.code === 'FREE_TIER_EXHAUSTED'
        ? 'The free AI allowance is used up. Try again after 8:00 AM Malaysia time.'
        : 'Translation is temporarily unavailable. Please try again.';
      setError(translationError?.message || fallback);
    } finally {
      if (requestSequence.current === sequence) setIsLoading(false);
    }
  }, [message.id, onTranslate]);

  const chooseLanguage = (language) => {
    onTargetLanguageChange(language);
    setShowLanguages(false);
    void translate(language);
  };

  const toggleSpeech = () => {
    if (!canSpeak) return;
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(result.translatedText);
    utterance.voice = speechVoice;
    utterance.lang = speechVoice.lang;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  const closeResult = () => {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    setIsSpeaking(false);
    setIsResultDismissed(true);
  };

  return (
    <div className="message-translation" aria-live="polite">
      <div className="message-translation-actions">
        <button
          type="button"
          className="message-translation-trigger"
          onClick={() => void translate(targetLanguage)}
          disabled={isLoading}
        >
          {isLoading
            ? (isVoiceMessage ? 'Transcribing…' : 'Translating…')
            : isVoiceMessage
              ? 'Transcribe & translate'
              : `Translate${targetLanguage ? ` to ${TRANSLATION_LANGUAGES[targetLanguage]}` : ''}`}
        </button>
        {targetLanguage && (
          <button
            type="button"
            className="message-translation-change"
            onClick={() => setShowLanguages((current) => !current)}
            aria-expanded={showLanguages}
          >
            Change
          </button>
        )}
      </div>

      {showLanguages && (
        <div className="message-translation-languages" aria-label="Choose translation language">
          <span>Translate to</span>
          <div>
            {Object.entries(TRANSLATION_LANGUAGES).map(([code, label]) => (
              <button key={code} type="button" onClick={() => chooseLanguage(code)}>
                {label}
              </button>
            ))}
          </div>
          <small>Message content is processed by Cloudflare Workers AI.</small>
        </div>
      )}

      {error && <p className="message-translation-error" role="alert">{error}</p>}

      {result && !isResultDismissed && (
        <div className="message-translation-result">
          <button
            type="button"
            className="message-translation-result-close"
            onClick={closeResult}
            aria-label="Close translation result"
            title="Close translation result"
          >
            <IconX size={16} aria-hidden="true" />
          </button>
          {result.transcript && (
            <div>
              <span>Transcript</span>
              <p>{result.transcript}</p>
            </div>
          )}
          <div>
            <span>{TRANSLATION_LANGUAGES[result.targetLanguage] || 'Translation'}</span>
            <p>{result.translatedText}</p>
          </div>
          <div className="message-translation-result-actions">
            <button type="button" onClick={toggleSpeech} disabled={!canSpeak}>
              {isSpeaking ? 'Stop listening' : 'Listen'}
            </button>
            {result.cached && <small>Saved translation</small>}
          </div>
          {!speechVoice && (
            <small className="message-translation-voice-unavailable">
              This device has no {TRANSLATION_LANGUAGES[result.targetLanguage]} reading voice.
            </small>
          )}
        </div>
      )}
    </div>
  );
}
