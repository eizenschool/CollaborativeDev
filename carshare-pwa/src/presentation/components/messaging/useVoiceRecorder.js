import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_VOICE_DURATION_SECONDS } from '../../../business-logic/MessagingService.js';
import { createVoiceWav } from './voiceAudio.js';

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

const EXTENSIONS = {
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
};

function baseMimeType(value) {
  return value?.split(';')[0]?.trim().toLowerCase() || 'audio/webm';
}

function selectRecordingMimeType() {
  return MIME_CANDIDATES.find((candidate) =>
    globalThis.MediaRecorder.isTypeSupported?.(candidate),
  );
}

function now() {
  return globalThis.performance?.now?.() || Date.now();
}

function microphoneError(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
    return new Error('Microphone permission was denied. Allow microphone access and try again.');
  }
  if (error?.name === 'NotFoundError') {
    return new Error('No microphone was found on this device.');
  }
  if (error?.name === 'NotReadableError') {
    return new Error('The microphone is already in use by another application.');
  }
  return new Error(error?.message || 'Unable to start voice recording.');
}

export default function useVoiceRecorder({
  onRecordingReady,
  onError,
  maxDurationSeconds = MAX_VOICE_DURATION_SECONDS,
}) {
  const [isStarting, setIsStarting] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const pcmChunksRef = useRef([]);
  const audioContextRef = useRef(null);
  const audioSourceRef = useRef(null);
  const audioProcessorRef = useRef(null);
  const silentGainRef = useRef(null);
  const timerRef = useRef(null);
  const startedAtRef = useRef(0);
  const stoppedAtRef = useRef(0);
  const discardRef = useRef(false);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const readyCallbackRef = useRef(onRecordingReady);
  const errorCallbackRef = useRef(onError);
  const stopInternalRef = useRef(() => {});

  readyCallbackRef.current = onRecordingReady;
  errorCallbackRef.current = onError;

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      globalThis.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks?.().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const stopPcmCapture = useCallback(() => {
    if (audioProcessorRef.current) audioProcessorRef.current.onaudioprocess = null;
    audioSourceRef.current?.disconnect?.();
    audioProcessorRef.current?.disconnect?.();
    silentGainRef.current?.disconnect?.();
    audioSourceRef.current = null;
    audioProcessorRef.current = null;
    silentGainRef.current = null;
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  }, []);

  const startPcmCapture = useCallback(async (stream) => {
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextClass) return false;
    const context = new AudioContextClass();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const silentGain = context.createGain();
    silentGain.gain.value = 0;
    pcmChunksRef.current = [];
    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      pcmChunksRef.current.push(new Float32Array(input));
    };
    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(context.destination);
    audioContextRef.current = context;
    audioSourceRef.current = source;
    audioProcessorRef.current = processor;
    silentGainRef.current = silentGain;
    if (context.state === 'suspended') await context.resume();
    return true;
  }, []);

  const finishUi = useCallback(() => {
    if (!mountedRef.current) return;
    setIsStarting(false);
    setIsRecording(false);
    setIsProcessing(false);
    setElapsedSeconds(0);
  }, []);

  const stopInternal = useCallback((discard = false) => {
    generationRef.current += 1;
    discardRef.current = discard;
    stoppedAtRef.current = now();
    clearTimer();
    if (mountedRef.current) {
      setIsStarting(false);
      setIsRecording(false);
      setIsProcessing(!discard && recorderRef.current?.state === 'recording');
    }
    const recorder = recorderRef.current;
    if (recorder?.state === 'recording') {
      recorder.stop();
    } else {
      stopPcmCapture();
      stopTracks();
      finishUi();
    }
  }, [clearTimer, finishUi, stopPcmCapture, stopTracks]);

  stopInternalRef.current = stopInternal;

  const startRecording = useCallback(async () => {
    if (isStarting || isRecording || isProcessing) return false;
    if (!globalThis.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Voice recording is not supported by this browser.');
    }

    const generation = generationRef.current + 1;
    generationRef.current = generation;
    discardRef.current = false;
    chunksRef.current = [];
    pcmChunksRef.current = [];
    setElapsedSeconds(0);
    setIsStarting(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current || generationRef.current !== generation) {
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }

      const mimeType = selectRecordingMimeType();
      if (!mimeType) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error('This browser cannot record a supported voice-message format.');
      }
      const options = { audioBitsPerSecond: 64000 };
      options.mimeType = mimeType;
      const recorder = new globalThis.MediaRecorder(stream, options);
      recorderRef.current = recorder;
      streamRef.current = stream;
      await startPcmCapture(stream);

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data?.size) chunksRef.current.push(event.data);
      });
      recorder.addEventListener('error', (event) => {
        discardRef.current = true;
        errorCallbackRef.current?.(microphoneError(event.error));
      });
      recorder.addEventListener('stop', () => {
        const shouldDiscard = discardRef.current;
        const chunks = chunksRef.current;
        const pcmChunks = pcmChunksRef.current;
        const inputSampleRate = audioContextRef.current?.sampleRate;
        const measuredDurationSeconds = Math.max(
          1,
          Math.min(maxDurationSeconds, Math.ceil(
            ((stoppedAtRef.current || now()) - startedAtRef.current) / 1000,
          )),
        );
        const playbackMimeType = recorder.mimeType || chunks[0]?.type || mimeType;
        const recordedType = baseMimeType(playbackMimeType);
        recorderRef.current = null;
        chunksRef.current = [];
        pcmChunksRef.current = [];
        stopPcmCapture();
        stopTracks();
        finishUi();
        if (shouldDiscard || (!pcmChunks.length && !chunks.length)) return;

        let blob;
        let durationSeconds = measuredDurationSeconds;
        if (pcmChunks.length && inputSampleRate) {
          const wav = createVoiceWav(pcmChunks, inputSampleRate);
          blob = wav.blob;
          durationSeconds = Math.max(
            1,
            Math.min(maxDurationSeconds, Math.ceil(wav.durationSeconds)),
          );
        } else {
          blob = new Blob(chunks, { type: playbackMimeType });
        }
        if (!blob.size) {
          errorCallbackRef.current?.(new Error('The voice recording is empty. Please record it again.'));
          return;
        }
        const fileType = blob.type || recordedType;
        const extension = EXTENSIONS[baseMimeType(fileType)] || 'webm';
        const file = new File(
          [blob],
          `voice-${Date.now()}.${extension}`,
          { type: fileType },
        );
        readyCallbackRef.current?.({ file, durationSeconds });
      }, { once: true });

      startedAtRef.current = now();
      stoppedAtRef.current = 0;
      // A single final data chunk is more reliable than concatenated short WebM
      // fragments in Chromium-based desktop shells.
      recorder.start();
      setIsStarting(false);
      setIsRecording(true);
      timerRef.current = globalThis.setInterval(() => {
        const elapsed = Math.min(
          maxDurationSeconds,
          Math.floor((now() - startedAtRef.current) / 1000),
        );
        if (mountedRef.current) setElapsedSeconds(elapsed);
        if (elapsed >= maxDurationSeconds) stopInternalRef.current(false);
      }, 250);
      return true;
    } catch (error) {
      if (generationRef.current === generation) generationRef.current += 1;
      clearTimer();
      stopPcmCapture();
      stopTracks();
      finishUi();
      throw microphoneError(error);
    }
  }, [clearTimer, finishUi, isProcessing, isRecording, isStarting, maxDurationSeconds, startPcmCapture, stopPcmCapture, stopTracks]);

  const stopRecording = useCallback(() => stopInternal(false), [stopInternal]);
  const cancelRecording = useCallback(() => stopInternal(true), [stopInternal]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      discardRef.current = true;
      clearTimer();
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
      stopPcmCapture();
      stopTracks();
    };
  }, [clearTimer, stopPcmCapture, stopTracks]);

  return {
    isStarting,
    isRecording,
    isProcessing,
    elapsedSeconds,
    startRecording,
    stopRecording,
    cancelRecording,
  };
}
