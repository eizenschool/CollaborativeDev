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
    if (revealable && candidateUrl && !mediaEnabled && showPhotoLabel) {
      return (
        <button
          type="button"
          className="guide-place-image-button"
          aria-label={`${showPhotoLabel}: ${place?.name || ''}`}
          onClick={(event) => { event.stopPropagation(); setRevealed(true); }}
        >
          <PlacePoster seed={place?.id} category={place?.category} variant={variant} />
          <span className="dsc-reveal guide-reveal">{showPhotoLabel}</span>
        </button>
      );
    }
    return (
      <PlacePoster seed={place?.id} category={place?.category} variant={variant} />
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
