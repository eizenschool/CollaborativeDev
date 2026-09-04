import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GUIDE_LOCALE } from '../../../business-logic/guide/GuideLanguage.js';

export const GUIDE_SPEECH_UNSUPPORTED = 'Voice input is not supported by this browser.';

export function normalizeGuideSpeechTranscript(value) {
  return String(value || '')
    .replace(/\b(?:k\s*[.\-]?\s*l|kay\s+el)\b/gi, 'KL')
    .replace(/\bkuala\s+lump(?:er|or)\b/gi, 'Kuala Lumpur')
    .replace(/\bkl\s+bird\s+part\b/gi, 'KL Bird Park')
    .replace(/\s+/g, ' ')
    .trim();
}

export function guideSpeechRecognitionLocale(language) {
  // 'auto' has no engine-level auto-detect in the Web Speech API. Fall back
  // to the browser's own UI language so it still matches the speaker most
  // of the time, instead of forcing English.
  if (language === 'auto') {
    return (typeof navigator !== 'undefined' && navigator.language) || GUIDE_LOCALE.en;
  }
  const locales = { en: 'en-MY', 'en-MY': 'en-MY', 'zh-CN': 'zh-CN', zh: 'zh-CN', ms: 'ms-MY', 'ms-MY': 'ms-MY', ta: 'ta-MY', 'ta-MY': 'ta-MY' };
  return locales[language] || GUIDE_LOCALE[language] || GUIDE_LOCALE.en;
}

export function bestGuideSpeechAlternative(result, phrases = []) {
  const expected = phrases.map((item) => normalizeGuideSpeechTranscript(item).toLowerCase()).filter(Boolean);
  const alternatives = Array.from({ length: Number(result?.length) || 0 }, (_, index) => result[index])
    .filter(Boolean).map((item) => {
      const text = normalizeGuideSpeechTranscript(item.transcript);
      const lower = text.toLowerCase();
      const phraseBoost = expected.some((phrase) => lower.includes(phrase)) ? 2 : 0;
      return { text, score: (Number(item.confidence) || 0) + phraseBoost };
    });
  return alternatives.sort((left, right) => right.score - left.score)[0]?.text || '';
}

// A restarted physical recognition object renumbers its result indexes from
// zero, so it can replay text the logical session already accumulated
// before the restart. Comparing only against the immediately-previous part
// misses a replay that lands a few parts back (e.g. the engine restarts
// mid-sentence and re-emits the last two finals as one). Check a short
// trailing window instead of just the last entry.
const DEDUPE_LOOKBACK = 4;

export function dedupeGuideTranscriptParts(parts = []) {
  const output = [];
  for (const rawPart of parts) {
    const part = normalizeGuideSpeechTranscript(rawPart);
    if (!part) continue;
    const lower = part.toLocaleLowerCase();
    let mergedAt = -1;
    for (let index = output.length - 1; index >= 0 && index >= output.length - DEDUPE_LOOKBACK; index -= 1) {
      const candidate = output[index];
      const candidateLower = candidate.toLocaleLowerCase();
      if (lower === candidateLower || candidateLower.endsWith(` ${lower}`) || lower.endsWith(` ${candidateLower}`)) {
        if (lower.length > candidateLower.length) output[index] = part;
        mergedAt = index;
        break;
      }
    }
    if (mergedAt === -1) output.push(part);
  }
  return output.join(' ').replace(/\s+([,.;!?。！？])/g, '$1').trim();
}

export function guideSpeechErrorMessage(errorCode, copy = {}) {
  if (errorCode === 'not-allowed' || errorCode === 'service-not-allowed') return copy.voicePermissionDenied || 'Microphone permission was denied.';
  if (errorCode === 'no-speech') return copy.voiceNoSpeech || 'No speech was recognised. You can keep typing.';
  if (errorCode === 'language-not-supported') return copy.voiceLanguageUnsupported || 'This language is not supported for voice input. You can keep typing.';
  if (errorCode === 'audio-capture') return copy.voiceMicrophoneUnavailable || 'No working microphone was found. Check the selected input device and try again.';
  if (errorCode === 'network') return copy.voiceNetworkUnavailable || 'The browser speech service could not be reached. You can use cloud transcription or keep typing.';
  if (errorCode === 'aborted') return copy.voiceInterrupted || 'Voice input was interrupted. Please try once more or keep typing.';
  return copy.voiceStopped || 'Voice input stopped. You can keep typing.';
}

export function isRetryableGuideSpeechError(errorCode) {
  return errorCode === 'aborted' || errorCode === 'network' || errorCode === 'no-speech';
}

// A browser can end one physical recognition object after a pause even while
// the user is still dictating. These two errors are safe to recover from in
// the same logical dictation session. Permission, microphone and language
// errors must still stop immediately and remain visible to the user.
export function isRecoverableBrowserSpeechError(errorCode) {
  return errorCode === 'aborted' || errorCode === 'no-speech';
}

function speechRecognitionClass() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function mediaRecorderSupported() {
  return typeof window !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
}

function recorderMimeType() {
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
    .find((type) => window.MediaRecorder.isTypeSupported?.(type)) || '';
}

export function useGuideSpeechInput({ copy = {}, language = 'en', onTranscript, onInterim, transcribeAudio }) {
  const recognitionRef = useRef(null);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const sessionRef = useRef(0);
  const disposedRef = useRef(false);
  const finalPartsRef = useRef([]);
  const restartTimerRef = useRef(null);
  const finalizedSessionRef = useRef(0);
  const browserSessionActiveRef = useRef(false);
  const stoppedByUserRef = useRef(false);
  const [listening, setListening] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [fallbackRequired, setFallbackRequired] = useState(false);
  const Recognition = speechRecognitionClass();
  const browserSupported = Boolean(Recognition);
  const cloudFallbackAvailable = mediaRecorderSupported() && Boolean(transcribeAudio);
  const supported = browserSupported || cloudFallbackAvailable;

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks?.().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const resetSession = useCallback(() => {
    finalPartsRef.current = [];
    onInterim?.('');
  }, [onInterim]);

  const finishBrowserSession = useCallback((token) => {
    if (token !== sessionRef.current || finalizedSessionRef.current === token) return;
    finalizedSessionRef.current = token;
    browserSessionActiveRef.current = false;
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    const finalText = dedupeGuideTranscriptParts(finalPartsRef.current);
    if (finalText) onTranscript?.(finalText);
    onInterim?.('');
    setListening(false); setProcessing(false); recognitionRef.current = null;
  }, [onInterim, onTranscript]);

  const stop = useCallback(() => {
    stoppedByUserRef.current = true;
    browserSessionActiveRef.current = false;
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch { finishBrowserSession(sessionRef.current); } return; }
    if (browserSupported) finishBrowserSession(sessionRef.current);
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }, [browserSupported, finishBrowserSession]);

  const startBrowser = useCallback(() => {
    disposedRef.current = false;
    const token = sessionRef.current + 1;
    sessionRef.current = token; stoppedByUserRef.current = false; resetSession();
    finalizedSessionRef.current = 0;
    browserSessionActiveRef.current = true;
    setError(''); setFallbackRequired(false);
    const scheduleRestart = () => {
      if (restartTimerRef.current || token !== sessionRef.current || stoppedByUserRef.current
          || disposedRef.current || !browserSessionActiveRef.current) return;
      restartTimerRef.current = setTimeout(() => {
        restartTimerRef.current = null;
        if (token !== sessionRef.current || stoppedByUserRef.current
            || disposedRef.current || !browserSessionActiveRef.current) return;
        createRecognition();
      }, 250);
    };
    function createRecognition() {
      if (token !== sessionRef.current || stoppedByUserRef.current
          || disposedRef.current || !browserSessionActiveRef.current) return;
      let recognition;
      try {
        recognition = new Recognition();
      } catch (creationError) {
        browserSessionActiveRef.current = false;
        setListening(false); setProcessing(false);
        setError(guideSpeechErrorMessage('unknown', copy));
        setFallbackRequired(cloudFallbackAvailable);
        return;
      }
      recognition.lang = guideSpeechRecognitionLocale(language);
      // continuous keeps the normal browser session alive through pauses;
      // onend recovery handles engines that still stop the physical object.
      recognition.continuous = true;
      recognition.interimResults = true;
      // Alternatives are useful for search ranking, not dictation. Selecting
      // one high-confidence hallucination is worse than keeping the browser's
      // primary transcript, especially for short words such as "test".
      recognition.maxAlternatives = 1;
      const seenFinalIndexes = new Set();
      recognition.onstart = () => { setListening(true); setProcessing(false); };
      recognition.onresult = (event) => {
        if (token !== sessionRef.current) return;
        const interim = [];
        for (let index = event.resultIndex || 0; index < event.results.length; index += 1) {
          const result = event.results[index];
          const text = bestGuideSpeechAlternative(result, []);
          if (!text) continue;
          if (result.isFinal) {
            // Some browser engines replay earlier final results with the next
            // result event. A physical recognition object owns its indexes;
            // the logical session owns the accumulated text.
            if (seenFinalIndexes.has(index)) continue;
            seenFinalIndexes.add(index);
            finalPartsRef.current.push(text);
          } else interim.push(text);
        }
        onInterim?.(dedupeGuideTranscriptParts(interim));
      };
      recognition.onerror = (event) => {
        if (token !== sessionRef.current) return;
        const code = String(event.error || 'unknown');
        if (isRecoverableBrowserSpeechError(code) && !stoppedByUserRef.current) {
          // Do not discard finalParts: the next physical object is part of
          // the same user session and its final text is merged once on stop.
          setError('');
          setFallbackRequired(false);
          return;
        }
        const canUseCloudFallback = cloudFallbackAvailable && !stoppedByUserRef.current;
        stoppedByUserRef.current = true;
        browserSessionActiveRef.current = false;
        setListening(false);
        setError(guideSpeechErrorMessage(code, copy));
        setFallbackRequired(canUseCloudFallback);
        setProcessing(false);
      };
      recognition.onend = () => {
        if (recognitionRef.current === recognition) recognitionRef.current = null;
        if (token !== sessionRef.current) return;
        if (stoppedByUserRef.current || disposedRef.current || !browserSessionActiveRef.current) {
          finishBrowserSession(token);
          return;
        }
        scheduleRestart();
      };
      recognitionRef.current = recognition;
      try { recognition.start(); } catch (startError) {
        recognitionRef.current = null;
        if (startError?.name === 'InvalidStateError' && !stoppedByUserRef.current) {
          scheduleRestart();
          return;
        }
        stoppedByUserRef.current = true;
        browserSessionActiveRef.current = false;
        setListening(false); setProcessing(false);
        setError(guideSpeechErrorMessage(startError?.name === 'NotAllowedError' ? 'not-allowed' : 'unknown', copy));
        setFallbackRequired(cloudFallbackAvailable);
      }
    }
    createRecognition();
  }, [Recognition, cloudFallbackAvailable, copy, finishBrowserSession, language, onInterim, resetSession]);

  const startCloudFallback = useCallback(async () => {
    disposedRef.current = false;
    if (!cloudFallbackAvailable) { setError(copy.voiceUnsupported || GUIDE_SPEECH_UNSUPPORTED); return; }
    setError(''); setFallbackRequired(false); setProcessing(false); stoppedByUserRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: { ideal: 1 } } });
      streamRef.current = stream;
      const mimeType = recorderMimeType();
      const recorder = new window.MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder; chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data?.size) chunksRef.current.push(event.data); };
      recorder.onerror = () => { releaseStream(); recorderRef.current = null; setListening(false); setProcessing(false); setError(copy.voiceStartFailed || 'Voice recording failed. You can keep typing.'); };
      recorder.onstop = async () => {
        // Unmounting the composer must cancel recording. It must never turn
        // into an implicit cloud-transcription consent event.
        if (disposedRef.current) {
          chunksRef.current = []; recorderRef.current = null; releaseStream();
          return;
        }
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        chunksRef.current = []; recorderRef.current = null; releaseStream(); setListening(false); setProcessing(true);
        try {
          const result = await transcribeAudio(blob);
          const text = normalizeGuideSpeechTranscript(result?.text || '');
          if (!text) throw new Error('no-speech');
          onTranscript?.(text); setError('');
        } catch (transcriptionError) {
          const reason = transcriptionError?.reason || (transcriptionError?.name === 'AbortError' ? 'network' : 'unknown');
          setError(reason === 'provider_429' ? (copy.voiceProviderBusy || 'Voice transcription is busy. Please retry shortly.')
            : reason === 'transcription_low_confidence' ? (copy.voiceLowConfidence || 'I could not hear that reliably, so nothing was inserted.')
              : reason === 'no-speech' || transcriptionError?.message === 'no-speech' ? guideSpeechErrorMessage('no-speech', copy)
                : (copy.voiceTranscriptionFailed || 'Voice transcription could not be completed. Please try again or keep typing.'));
        } finally { setProcessing(false); }
      };
      recorder.start(); setListening(true);
    } catch (captureError) {
      releaseStream(); setListening(false); setProcessing(false);
      const code = captureError?.name === 'NotAllowedError' ? 'not-allowed'
        : captureError?.name === 'NotFoundError' || captureError?.name === 'NotReadableError' ? 'audio-capture' : 'unknown';
      setError(guideSpeechErrorMessage(code, copy));
    }
  }, [cloudFallbackAvailable, copy, onTranscript, releaseStream, transcribeAudio]);

  const start = useCallback(() => {
    if (listening || processing) return;
    if (!browserSupported) { setError(copy.voiceUnsupported || GUIDE_SPEECH_UNSUPPORTED); setFallbackRequired(cloudFallbackAvailable); return; }
    startBrowser();
  }, [browserSupported, cloudFallbackAvailable, copy, listening, processing, startBrowser]);

  useEffect(() => () => {
    disposedRef.current = true;
    sessionRef.current += 1;
    browserSessionActiveRef.current = false;
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    try { recognitionRef.current?.abort?.(); } catch { /* best effort */ }
    if (recorderRef.current?.state === 'recording') {
      // Detach the upload-producing handler before stopping the recorder.
      // This is cleanup, not a user-confirmed Groq fallback action.
      recorderRef.current.ondataavailable = null;
      recorderRef.current.onstop = null;
      try { recorderRef.current.stop(); } catch { /* best effort */ }
      recorderRef.current = null;
      chunksRef.current = [];
    }
    releaseStream();
  }, [releaseStream]);

  // A single derived state name for the UI, instead of four separate
  // booleans it would otherwise have to combine itself. 'reviewing' (holding
  // editable transcribed text, nothing auto-sent) is a composer-level idea
  // layered on top by the caller, since the hook itself has no concept of
  // draft text - it only ever fills the composer via onTranscript.
  const state = error ? 'error' : listening ? 'recording' : processing ? 'processing' : 'idle';

  return useMemo(() => ({
    supported, browserSupported, cloudFallbackAvailable, fallbackRequired, listening, processing, error, state,
    start, stop, startCloudFallback
  }), [browserSupported, cloudFallbackAvailable, error, fallbackRequired, listening, processing, start, startCloudFallback, state, stop, supported]);
}
