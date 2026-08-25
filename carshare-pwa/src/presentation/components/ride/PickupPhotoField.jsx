import { useEffect, useRef, useState } from 'react';
import { RidePickupPhotoService } from '../../../business-logic/RidePickupPhotoService.js';
import usePhotoCapture from '../../hooks/usePhotoCapture.js';
import { IconCamera, IconTrash, IconX } from '../icons.jsx';

function useObjectUrl(file) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!file) { setUrl(''); return undefined; }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

export function PickupPhotoPreview({ file, rideId, hasExisting = false, removed = false }) {
  const localUrl = useObjectUrl(file);
  const [remoteUrl, setRemoteUrl] = useState('');
  useEffect(() => {
    let active = true;
    setRemoteUrl('');
    if (localUrl || removed || !hasExisting || !rideId) return () => { active = false; };
    RidePickupPhotoService.getDisplayUrl(rideId).then((url) => {
      if (active) setRemoteUrl(url || '');
    }).catch(() => {});
    return () => { active = false; };
  }, [hasExisting, localUrl, removed, rideId]);
  const url = localUrl || remoteUrl;
  if (!url) return null;
  return <img className="pickup-photo-preview-image" src={url} alt="Pickup meeting point preview" />;
}

export default function PickupPhotoField({ rideId, file, hasExisting = false, removed = false, disabled = false, onFileChange, onRemove }) {
  const fileInputRef = useRef(null);
  const videoRef = useRef(null);
  const [error, setError] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const {
    isStarting, isCapturing, previewStream, startCapture, capturePhoto, cancelCapture,
  } = usePhotoCapture({
    onPhotoReady: (next) => {
      try {
        RidePickupPhotoService.validate(next);
        onFileChange(next);
        setError('');
        setCameraOpen(false);
      } catch (captureError) { setError(captureError.message); }
    },
    onError: (captureError) => setError(captureError.message),
  });

  useEffect(() => {
    if (videoRef.current && previewStream) videoRef.current.srcObject = previewStream;
  }, [previewStream]);

  useEffect(() => () => cancelCapture(), [cancelCapture]);

  useEffect(() => {
    if (!cameraOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return;
      cancelCapture();
      setCameraOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [cameraOpen, cancelCapture]);

  async function openCamera() {
    setError('');
    setCameraOpen(true);
    try { await startCapture(); }
    catch (cameraError) { setCameraOpen(false); setError(cameraError.message); }
  }

  function chooseFile(next) {
    if (!next) return;
    try {
      RidePickupPhotoService.validate(next);
      onFileChange(next);
      setError('');
    } catch (fileError) { setError(fileError.message); }
  }

  const visible = Boolean(file || (hasExisting && !removed));
  return (
    <div className="pickup-photo-field">
      <div className="pickup-photo-heading">
        <div><strong>Pickup meeting photo</strong><span>Optional · one photo</span></div>
        <small>This photo is visible to anyone viewing a Published Ride. Avoid faces, number plates, or private information.</small>
      </div>
      <input
        ref={fileInputRef}
        className="pickup-photo-file-input"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        disabled={disabled}
        onChange={(event) => { chooseFile(event.target.files?.[0]); event.currentTarget.value = ''; }}
      />
      {visible && <div className="pickup-photo-preview"><PickupPhotoPreview file={file} rideId={rideId} hasExisting={hasExisting} removed={removed} /></div>}
      <div className="pickup-photo-actions">
        <button type="button" className="btn-secondary" disabled={disabled} onClick={openCamera}><IconCamera size={17} aria-hidden="true" /> Take photo</button>
        <button type="button" className="btn-secondary" disabled={disabled} onClick={() => fileInputRef.current?.click()}>{visible ? 'Replace from files' : 'Upload photo'}</button>
        {visible && <button type="button" className="pickup-photo-remove" disabled={disabled} onClick={onRemove}><IconTrash size={16} aria-hidden="true" /> Remove</button>}
      </div>
      {error && <p className="location-field-message error" role="alert">{error} You can still upload a photo from your files.</p>}

      {cameraOpen && (
        <div className="pickup-camera-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { cancelCapture(); setCameraOpen(false); } }}>
          <section className="pickup-camera-dialog" role="dialog" aria-modal="true" aria-labelledby="pickup-camera-title">
            <header><div><strong id="pickup-camera-title">Take pickup photo</strong><span>Frame the place where passengers should meet you.</span></div><button type="button" onClick={() => { cancelCapture(); setCameraOpen(false); }} aria-label="Close camera"><IconX size={19} /></button></header>
            <div className="pickup-camera-preview">
              <video ref={videoRef} autoPlay muted playsInline aria-label="Live camera preview" />
              {(isStarting || isCapturing) && <span role="status">{isStarting ? 'Opening camera…' : 'Preparing photo…'}</span>}
            </div>
            <footer><button type="button" className="btn-secondary" onClick={() => { cancelCapture(); setCameraOpen(false); }}>Cancel</button><button type="button" className="btn-primary" disabled={!previewStream || isCapturing} onClick={() => capturePhoto(videoRef.current)}>Capture photo</button></footer>
          </section>
        </div>
      )}
    </div>
  );
}
