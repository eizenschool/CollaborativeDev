import { useEffect, useRef, useState } from 'react';
import { PHOTO_WIDTH_CARD } from '../../../../business-logic/m6-discovery/discovery/placePhotos.js';
import { useMediaEnabled } from '../discover/useMediaMode.js';
import PlacePoster from '../discover/PlacePoster.jsx';
import useFreshPlacePhoto from '../discover/useFreshPlacePhoto.js';

export default function GuidePlaceImage({
  place, variant = 0, widthPx = PHOTO_WIDTH_CARD, revealable = false, copy = {}, onShownChange
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
  const showPhotoLabel = String(copy.showPhoto || 'View real photo').trim();
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
      {revealable && place?.sourcePlaceId && !mediaEnabled && !revealed && (
        <button
          type="button"
          className="dsc-reveal guide-reveal"
          aria-label={`${showPhotoLabel}: ${place?.name || ''}`}
          onClick={(event) => { event.stopPropagation(); setRevealed(true); }}
        >
          {showPhotoLabel}
        </button>
      )}
      {loading && <span className="dsc-photo-status" role="status">{copy.loadingPhoto || 'Loading photo…'}</span>}
      {(failed || imageFailedUrl === photo?.url) && enabled && (
        <button
          type="button"
          className="dsc-reveal dsc-retry-photo"
          aria-label={`${copy.retryPhoto || 'Retry photo'}: ${place?.name || ''}`}
          onClick={(event) => {
            event.stopPropagation();
            setImageFailedUrl('');
            setImageLoadedUrl('');
            retry();
          }}
        >
          {copy.retryPhoto || 'Retry photo'}
        </button>
      )}
    </span>
  );
}
