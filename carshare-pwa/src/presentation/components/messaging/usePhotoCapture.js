import { useCallback, useEffect, useRef, useState } from 'react';

function cameraError(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
    return new Error('Camera permission was denied. Allow access and try again.');
  }
  if (error?.name === 'NotFoundError') {
    return new Error('No camera was found on this device.');
  }
  if (error?.name === 'NotReadableError') {
    return new Error('The camera is already in use by another application.');
  }
  return new Error(error?.message || 'Unable to open the camera.');
}

function photoFileFromVideo(video) {
  if (!video?.videoWidth || !video?.videoHeight) {
    throw new Error('The camera is still starting. Try taking the photo again.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to prepare the camera photo.');
  context.drawImage(video, 0, 0, canvas.width, canvas.height);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob?.size) {
        reject(new Error('The camera returned an empty photo. Try again.'));
        return;
      }
      resolve(new File(
        [blob],
        `photo-${Date.now()}.jpg`,
        { type: 'image/jpeg' },
      ));
    }, 'image/jpeg', 0.92);
  });
}

/** Opens an in-page camera and turns the current frame into an image draft. */
export default function usePhotoCapture({ onPhotoReady, onError }) {
  const [isStarting, setIsStarting] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [previewStream, setPreviewStream] = useState(null);
  const streamRef = useRef(null);
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const readyCallbackRef = useRef(onPhotoReady);
  const errorCallbackRef = useRef(onError);

  readyCallbackRef.current = onPhotoReady;
  errorCallbackRef.current = onError;

  const stopCapture = useCallback(() => {
    generationRef.current += 1;
    streamRef.current?.getTracks?.().forEach((track) => track.stop());
    streamRef.current = null;
    if (mountedRef.current) {
      setIsStarting(false);
      setIsCapturing(false);
      setPreviewStream(null);
    }
  }, []);

  const startCapture = useCallback(async () => {
    if (isStarting || isCapturing || previewStream) return false;
    if (!globalThis.isSecureContext) {
      throw new Error('Taking a photo requires an HTTPS connection.');
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Taking a photo is not supported by this browser.');
    }

    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setIsStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      if (!mountedRef.current || generationRef.current !== generation) {
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }
      streamRef.current = stream;
      setPreviewStream(stream);
      setIsStarting(false);
      return true;
    } catch (error) {
      if (generationRef.current !== generation) return false;
      generationRef.current += 1;
      setIsStarting(false);
      throw cameraError(error);
    }
  }, [isCapturing, isStarting, previewStream]);

  const capturePhoto = useCallback(async (video) => {
    if (!previewStream || isCapturing) return false;
    setIsCapturing(true);
    try {
      const file = await photoFileFromVideo(video);
      stopCapture();
      readyCallbackRef.current?.(file);
      return true;
    } catch (error) {
      if (mountedRef.current) setIsCapturing(false);
      errorCallbackRef.current?.(cameraError(error));
      return false;
    }
  }, [isCapturing, previewStream, stopCapture]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      streamRef.current?.getTracks?.().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  return {
    isStarting,
    isCapturing,
    previewStream,
    startCapture,
    capturePhoto,
    cancelCapture: stopCapture,
  };
}
