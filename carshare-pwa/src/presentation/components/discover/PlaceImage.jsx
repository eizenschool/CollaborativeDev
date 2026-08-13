// ===== PRESENTATION LAYER (PlaceImage) =====
//
// The photograph slot. PlacePoster's header describes this moment: the fixture
// catalogue held references that could not be fetched, so the illustration
// filled every slot; now the live catalogue carries real Google references and
// the photograph renders here instead, with the illustration dropping back to
// the fallback it was always specified to be.
//
// It falls back to the illustration in three cases, so a slot is never empty:
// no reference, no configured API key, or the image failing to load (an expired
// reference, a key without Places Photo authorised, or simply being offline).

import { useState } from 'react';
import { buildPlacePhotoUrl } from '../../../business-logic/discovery/placePhotos.js';
import PlacePoster from './PlacePoster.jsx';

/**
 * @param place    the place record, carrying photoReferences
 * @param variant  which stored photo to show; also picks the poster variant
 * @param widthPx  requested width - keep near the rendered size, since Google
 *                 bills per request and a card does not need a 4800px image
 */
export default function PlaceImage({ place, variant = 0, widthPx = 800 }) {
  const [failed, setFailed] = useState(false);

  const reference = place?.photoReferences?.[variant]?.reference;
  const url = failed ? null : buildPlacePhotoUrl(reference, { maxWidthPx: widthPx });

  if (!url) {
    return <PlacePoster seed={place?.id} category={place?.category} variant={variant} />;
  }

  return (
    <img
      className="dsc-photo"
      src={url}
      alt={place?.name || ''}
      // Every load is a billable request, so a card scrolled past is not paid for.
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
