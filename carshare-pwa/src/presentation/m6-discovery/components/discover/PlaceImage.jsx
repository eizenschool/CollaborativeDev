import { useEffect, useRef, useState } from 'react';
import { useMediaEnabled } from './useMediaMode.js';
import PlacePoster from './PlacePoster.jsx';
import useFreshPlacePhoto from './useFreshPlacePhoto.js';

/** One lazy, current Google photo with an illustration that stays visible until it loads. */
export default function PlaceImage({
  place, variant = 0, widthPx = 800, revealable = false, onShownChange
}) {
  const mediaEnabled = useMediaEnabled();
  const [revealed, setRevealed] = useState(false);
  const [imageLoadedUrl, setImageLoadedUrl] = useState('');
  const [imageFailedUrl, setImageFailedUrl] = useState('');
  const enabled = mediaEnabled || revealed;
  const { slotRef, photo, loading, failed, retry } = useFreshPlacePhoto({
    placeId: place?.sourcePlaceId,
    label: place?.name,
    maxWidth: widthPx,
    photoIndex: variant,
    enabled,
  });
  const shown = enabled && Boolean(photo?.url) && imageLoadedUrl === photo.url && imageFailedUrl !== photo.url;
  const canReveal = revealable && Boolean(place?.sourcePlaceId);
  const onShownChangeRef = useRef(onShownChange);

  useEffect(() => { onShownChangeRef.current = onShownChange; }, [onShownChange]);

  useEffect(() => {
    onShownChangeRef.current?.(shown, shown ? photo : null);
  }, [shown, photo]);

  return (
    <span className="dsc-photo-slot" ref={slotRef}>
      <span className="dsc-poster-fallback" aria-hidden={shown}>
        <PlacePoster seed={place?.id} category={place?.category} variant={variant} />
      </span>
      {photo?.url && (
        <img
          className={`dsc-photo${shown ? ' is-loaded' : ''}`}
          src={photo.url}
          alt={place?.name || ''}
          aria-hidden={!shown}
          loading="eager"
          decoding="async"
          onLoad={() => { setImageLoadedUrl(photo.url); setImageFailedUrl(''); }}
          onError={() => { setImageFailedUrl(photo.url); }}
        />
      )}
      {canReveal && !mediaEnabled && !revealed && (
        <button
          type="button"
          className="dsc-reveal"
          aria-label={`View real photo of ${place?.name || 'this destination'}`}
          onClick={(event) => { event.stopPropagation(); setRevealed(true); }}
        >
          View real photo
        </button>
      )}
      {loading && <span className="dsc-photo-status" role="status">Loading photo…</span>}
      {(failed || imageFailedUrl === photo?.url) && enabled && (
        <button
          type="button"
          className="dsc-reveal dsc-retry-photo"
          aria-label={`Retry photo of ${place?.name || 'this destination'}`}
          onClick={(event) => {
            event.stopPropagation();
            setImageFailedUrl('');
            setImageLoadedUrl('');
            retry();
          }}
        >
          Photo unavailable · retry
        </button>
      )}
    </span>
  );
}
