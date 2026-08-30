// ===== PRESENTATION LAYER (Tumpang Guide place image) =====
// This deliberately mirrors the shared image behaviour without changing the
// shared Discover component. The Guide owns its copy so a language switch also
// translates the photo affordance.
import { useEffect, useState } from 'react';
import { buildPlacePhotoUrl, PHOTO_WIDTH_CARD } from '../../../business-logic/discovery/placePhotos.js';
import { useMediaEnabled } from '../discover/useMediaMode.js';
import PlacePoster from '../discover/PlacePoster.jsx';

export default function GuidePlaceImage({
  place, variant = 0, widthPx = PHOTO_WIDTH_CARD, revealable = false, copy = {}, onShownChange
}) {
  const mediaEnabled = useMediaEnabled();
  const [revealed, setRevealed] = useState(false);
  const [failed, setFailed] = useState(false);
  const showPhotoLabel = String(copy.showPhoto || '').trim();
  const reference = place?.photoReferences?.[variant]?.reference;
  const candidateUrl = failed ? null : buildPlacePhotoUrl(reference, { maxWidthPx: widthPx });
  const shown = candidateUrl !== null && (mediaEnabled || revealed);

  useEffect(() => { onShownChange?.(shown); }, [shown, onShownChange]);

  if (!shown) {
    return (
      <>
        <PlacePoster seed={place?.id} category={place?.category} variant={variant} />
        {revealable && candidateUrl && !mediaEnabled && showPhotoLabel && (
          <span
            role="button"
            tabIndex={0}
            className="dsc-reveal guide-reveal"
            aria-label={`${showPhotoLabel}: ${place?.name || ''}`}
            onClick={(event) => { event.stopPropagation(); setRevealed(true); }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              event.stopPropagation();
              setRevealed(true);
            }}
          >
            {showPhotoLabel}
          </span>
        )}
      </>
    );
  }

  return (
    <img
      className="dsc-photo"
      src={candidateUrl}
      alt={place?.name || ''}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
