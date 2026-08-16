// ===== PRESENTATION LAYER (StreetViewFrame) =====
// FR-6.15. An explicit Street View scene, offered alongside a place's real
// photographs rather than only in their absence - see Carousel in
// DestinationDetail.jsx, which appends this as the carousel's last frame for
// every place carrying a real coordinate.
//
// Falls to the category illustration (FR-6.17) when the coordinate has no
// Street View coverage (the proxy answers 404), when the place carries no
// usable coordinate at all, or when the request otherwise fails - the same
// "never render nothing" contract every image slot in this module keeps.

import { useState } from 'react';
import { buildStreetViewProxyUrl } from '../../../business-logic/discovery/StreetView.js';
import PlacePoster from './PlacePoster.jsx';

export default function StreetViewFrame({ place, widthPx = 1000 }) {
  const [failed, setFailed] = useState(false);

  const hasCoordinate = Number.isFinite(place?.lat) && Number.isFinite(place?.lng);
  const url = !failed && hasCoordinate
    ? buildStreetViewProxyUrl(place.lat, place.lng, {
        width: widthPx, height: Math.round(widthPx * 0.6)
      })
    : null;

  if (!url) {
    return <PlacePoster seed={place?.id} category={place?.category} variant="streetview" />;
  }

  return (
    <img
      className="dsc-photo"
      src={url}
      alt={`Street View near ${place?.name || 'this place'}`}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
