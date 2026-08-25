import { useEffect, useRef, useState } from 'react';
import { PlacePhotoService } from '../../../business-logic/PlacePhotoService.js';
import '../../styles/ride-photo.css';

function attributionParts(attribution) {
  if (!attribution) return { name: '', uri: '' };
  if (typeof attribution === 'string') return { name: attribution, uri: '' };
  return { name: attribution.displayName || '', uri: attribution.uri || '' };
}

export default function DestinationRidePhoto({ placeId, label, maxWidth = 900, onReadyChange, variant = 'background' }) {
  const rootRef = useRef(null);
  const readyRef = useRef(onReadyChange);
  const [inView, setInView] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [failed, setFailed] = useState(false);
  readyRef.current = onReadyChange;

  useEffect(() => {
    if (!placeId) return undefined;
    if (!rootRef.current || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return undefined;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setInView(true);
        observer.disconnect();
      }
    }, { rootMargin: '120px' });
    observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, [placeId]);

  useEffect(() => {
    let active = true;
    setPhoto(null);
    setFailed(false);
    readyRef.current?.(false);
    if (!placeId || !inView) return () => { active = false; };
    PlacePhotoService.resolve(placeId, { label, maxWidth })
      .then((next) => {
        if (!active) return;
        if (!next?.url) { setFailed(true); return; }
        setPhoto(next);
      })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [inView, label, maxWidth, placeId]);

  const detail = variant === 'detail';
  if (!placeId || failed) return detail ? null : <span ref={rootRef} className="destination-photo-sentinel" aria-hidden="true" />;
  if (!photo?.url) return detail
    ? <div ref={rootRef} className="ride-destination-photo-loading" role="status">Loading destination photo…</div>
    : <span ref={rootRef} className="destination-photo-sentinel" aria-hidden="true" />;
  const attribution = attributionParts(photo.attribution);
  const handleError = () => {
    if (!photo.cached) {
      setFailed(true);
      readyRef.current?.(false);
      return;
    }
    setPhoto(null);
    PlacePhotoService.resolveFresh(placeId, { label, maxWidth })
      .then((next) => {
        if (next?.url) setPhoto(next);
        else setFailed(true);
      })
      .catch(() => setFailed(true));
  };
  const credit = <small className={detail ? 'ride-destination-photo-credit' : 'destination-photo-credit'}>
    {attribution.name && <span>Photo by {attribution.uri ? <a href={attribution.uri} target="_blank" rel="noreferrer">{attribution.name}</a> : attribution.name}</span>}
    <a href={photo.sourceUrl} target="_blank" rel="noreferrer">Google Maps</a>
  </small>;
  if (detail) {
    return (
      <figure className="ride-destination-photo" ref={rootRef}>
        <img src={photo.url} alt={`${label || 'Ride'} destination`} loading="lazy" onLoad={() => readyRef.current?.(true)} onError={handleError} />
        <figcaption><span><strong>Destination</strong>{label}</span>{credit}</figcaption>
      </figure>
    );
  }
  return (
    <div className="destination-ride-photo" ref={rootRef}>
      <img
        src={photo.url}
        alt=""
        aria-hidden="true"
        loading="lazy"
        onLoad={() => readyRef.current?.(true)}
        onError={handleError}
      />
      <span className="destination-photo-scrim" aria-hidden="true" />
      {credit}
    </div>
  );
}
