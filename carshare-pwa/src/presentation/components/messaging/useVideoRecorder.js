import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_VIDEO_BYTES } from '../../../business-logic/MessagingService.js';

const MIME_CANDIDATES = [
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
];

const EXTENSIONS = {
  'video/webm': 'webm',
  'video/mp4': 'mp4',
};

export function baseVideoMimeType(value) {
  return value?.split(';')[0]?.trim().toLowerCase() || '';
}

export function selectVideoRecordingMimeType(MediaRecorderClass = globalThis.MediaRecorder) {
  return MIME_CANDIDATES.find((candidate) => MediaRecorderClass?.isTypeSupported?.(candidate)) || '';
}

function cameraError(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
    return new Error('Camera or microphone permission was denied. Allow access and try again.');
  }
  if (error?.name === 'NotFoundError') {
    return new Error('No camera was found on this device.');
  }
  if (error?.name === 'NotReadableError') {
    return new Error('The camera is already in use by another application.');
  }
  return new Error(error?.message || 'Unable to start video recording.');
}

export default function useVideoRecorder({ onRecordingReady, onError }) {
  const [isStarting, setIsStarting] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [previewStream, setPreviewStream] = useState(null);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const bytesRef = useRef(0);
  const timerRef = useRef(null);
  const startedAtRef = useRef(0);
  const discardRef = useRef(false);
  const sizeExceededRef = useRef(false);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const readyCallbackRef = useRef(onRecordingReady);
  const errorCallbackRef = useRef(onError);

  readyCallbackRef.current = onRecordingReady;
  errorCallbackRef.current = onError;

  const clearTimer = useCallback(() => {
    if (timerRef.current) globalThis.clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks?.().forEach((track) => track.stop());
    streamRef.current = null;
    if (mountedRef.current) setPreviewStream(null);
  }, []);

  const finishUi = useCallback(() => {
    if (!mountedRef.current) return;
    setIsStarting(false);
    setIsRecording(false);
    setIsProcessing(false);
    setElapsedSeconds(0);
  }, []);

  const stopRecording = useCallback((discard = false) => {
    generationRef.current += 1;
    discardRef.current = discard;
    clearTimer();
    if (mountedRef.current) {
      setIsStarting(false);
      setIsRecording(false);
      setIsProcessing(!discard && recorderRef.current?.state === 'recording');
    }
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop();
    } else {
      stopTracks();
      finishUi();
    }
  }, [clearTimer, finishUi, stopTracks]);

  const startRecording = useCallback(async () => {
    if (isStarting || isRecording || isProcessing) return false;
    if (!globalThis.isSecureContext) {
      throw new Error('Video recording requires an HTTPS connection.');
    }
    if (!globalThis.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Video recording is not supported by this browser.');
    }

    const mimeType = selectVideoRecordingMimeType();
    if (!mimeType) {
      throw new Error('This browser cannot record MP4 or WebM video.');
    }

    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setIsStarting(true);
    setElapsedSeconds(0);
    discardRef.current = false;
    sizeExceededRef.current = false;
    chunksRef.current = [];
    bytesRef.current = 0;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: true,
      });
      if (!mountedRef.current || generationRef.current !== generation) {
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }

      const recorder = new globalThis.MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 2_500_000,
        audioBitsPerSecond: 96_000,
      });
      recorderRef.current = recorder;
      streamRef.current = stream;
      setPreviewStream(stream);

      recorder.addEventListener('dataavailable', (event) => {
        if (!event.data?.size) return;
        chunksRef.current.push(event.data);
        bytesRef.current += event.data.size;
        if (bytesRef.current > MAX_VIDEO_BYTES && recorder.state === 'recording') {
          sizeExceededRef.current = true;
          clearTimer();
          if (mountedRef.current) {
            setIsRecording(false);
            setIsProcessing(true);
          }
          recorder.stop();
        }
      });

      recorder.addEventListener('error', (event) => {
        discardRef.current = true;
        errorCallbackRef.current?.(cameraError(event.error));
      });

      recorder.addEventListener('stop', () => {
        const shouldDiscard = discardRef.current;
        const sizeExceeded = sizeExceededRef.current;
        const chunks = chunksRef.current;
        const recordedMimeType = baseVideoMimeType(recorder.mimeType || chunks[0]?.type || mimeType);
        recorderRef.current = null;
        chunksRef.current = [];
        bytesRef.current = 0;
        stopTracks();
        finishUi();

        if (sizeExceeded) {
          errorCallbackRef.current?.(new Error('Recorded video exceeds the 50 MB limit. Record a shorter clip.'));
          return;
        }
        if (shouldDiscard || !chunks.length) return;

        const blob = new Blob(chunks, { type: recordedMimeType });
        if (!blob.size) {
          errorCallbackRef.current?.(new Error('The video recording is empty. Please record it again.'));
          return;
        }
        const extension = EXTENSIONS[recordedMimeType] || 'webm';
        readyCallbackRef.current?.(new File(
          [blob],
          `video-${Date.now()}.${extension}`,
          { type: recordedMimeType },
        ));
      }, { once: true });

      startedAtRef.current = Date.now();
      recorder.start(1000);
      setIsStarting(false);
      setIsRecording(true);
      timerRef.current = globalThis.setInterval(() => {
        if (mountedRef.current) {
          setElapsedSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
        }
      }, 250);
      return true;
    } catch (error) {
      if (generationRef.current !== generation) return false;
      generationRef.current += 1;
      clearTimer();
      stopTracks();
      finishUi();
      throw cameraError(error);
    }
  }, [clearTimer, finishUi, isProcessing, isRecording, isStarting, stopTracks]);

  const finishRecording = useCallback(() => stopRecording(false), [stopRecording]);
  const cancelRecording = useCallback(() => stopRecording(true), [stopRecording]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      discardRef.current = true;
      clearTimer();
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
      stopTracks();
    };
  }, [clearTimer, stopTracks]);

  return {
    isStarting,
    isRecording,
    isProcessing,
    elapsedSeconds,
    previewStream,
    startRecording,
    stopRecording: finishRecording,
    cancelRecording,
  };
}
