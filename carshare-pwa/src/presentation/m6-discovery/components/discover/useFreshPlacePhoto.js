import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveFreshPlacePhoto } from '../../../../business-logic/shared/PlacePhotoService.js';

/** Resolve a photo only when media is enabled and its slot is near the viewport. */
export default function useFreshPlacePhoto({
  placeId, label, maxWidth, photoIndex = 0, enabled = false
}) {
  const slotRef = useRef(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);
  const [photo, setPhoto] = useState(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setNearViewport(false);
    if (!enabled || !placeId) {
      setPhoto(null);
      setLoading(false);
      setFailed(false);
      return undefined;
    }

    const slot = slotRef.current;
    if (!slot || typeof IntersectionObserver === 'undefined') {
      setNearViewport(true);
      return undefined;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        setNearViewport(true);
        observer.disconnect();
      }
    }, { rootMargin: '160px' });
    observer.observe(slot);
    return () => observer.disconnect();
  }, [enabled, placeId]);

  useEffect(() => {
    if (!enabled || !placeId || !nearViewport) return undefined;
    let current = true;
    setPhoto(null);
    setFailed(false);
    setLoading(true);
    resolveFreshPlacePhoto(placeId, { label, maxWidth, photoIndex })
      .then((result) => {
        if (!current) return;
        setPhoto(result?.url ? result : null);
        setFailed(!result?.url);
      })
      .catch(() => {
        if (!current) return;
        setPhoto(null);
        setFailed(true);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => { current = false; };
  }, [enabled, placeId, label, maxWidth, photoIndex, nearViewport, retryVersion]);

  const retry = useCallback(() => {
    setNearViewport(true);
    setRetryVersion((version) => version + 1);
  }, []);

  return { slotRef, photo, loading, failed, retry };
}
