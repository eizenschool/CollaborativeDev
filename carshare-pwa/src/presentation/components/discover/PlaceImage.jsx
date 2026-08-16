// ===== PRESENTATION LAYER (PlaceImage) =====
//
// The photograph slot. PlacePoster's header describes this moment: the fixture
// catalogue held references that could not be fetched, so the illustration
// filled every slot; now the live catalogue carries real Google references and
// the photograph renders here instead, with the illustration dropping back to
// the fallback it was always specified to be.
//
// Three tiers, in order: a real Google Photos reference; failing that, FR-6.15
// Street View for a place that has coordinates but no photograph of its own;
// failing that, the illustration. A slot is never empty.
//
// The Street View tier only ever fires for `variant === 0`. Google Photos
// references can hold up to five frames (MAX_PHOTOS_PER_PLACE) and the carousel
// pages through them; there is exactly one Street View image per coordinate, so
// asking for it as "frame 2 of a place with no photos" would either repeat the
// same request or draw nothing. One establishing image beats a five-frame
// carousel that cannot exist.

import { useEffect, useRef, useState } from 'react';
import { buildPlacePhotoUrl } from '../../../business-logic/discovery/placePhotos.js';
import {
  buildStreetViewImageUrl, hasStreetViewCoverage, hasStreetViewKey
} from '../../../business-logic/discovery/StreetView.js';
import PlacePoster from './PlacePoster.jsx';

/**
 * @param place    the place record, carrying photoReferences and lat/lng
 * @param variant  which stored photo to show; also picks the poster variant
 * @param widthPx  requested width - keep near the rendered size, since Google
 *                 bills per request and a card does not need a 4800px image
 */
export default function PlaceImage({ place, variant = 0, widthPx = 800 }) {
  const [failed, setFailed] = useState(false);
  const [streetViewOk, setStreetViewOk] = useState(false);
  const containerRef = useRef(null);

  const reference = place?.photoReferences?.[variant]?.reference;
  const photoUrl = failed ? null : buildPlacePhotoUrl(reference, { maxWidthPx: widthPx });

  const eligibleForStreetView = !photoUrl && variant === 0
    && hasStreetViewKey() && Number.isFinite(place?.lat) && Number.isFinite(place?.lng);

  // The metadata check is a real network request, so it is deferred behind the
  // same "only when scrolled into view" discipline the <img loading="lazy">
  // below gets natively - a list of twenty cards must not fire twenty metadata
  // checks the moment the page mounts. IntersectionObserver is the manual
  // equivalent for a check that happens in JS rather than as an <img> load.
  useEffect(() => {
    if (!eligibleForStreetView || !containerRef.current) return undefined;

    let cancelled = false;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      hasStreetViewCoverage(place.lat, place.lng).then((covered) => {
        if (!cancelled && covered) setStreetViewOk(true);
      });
    });
    observer.observe(containerRef.current);

    return () => { cancelled = true; observer.disconnect(); };
  }, [eligibleForStreetView, place?.id, place?.lat, place?.lng]);

  const streetViewUrl = eligibleForStreetView && streetViewOk
    ? buildStreetViewImageUrl(place.lat, place.lng, { width: widthPx, height: Math.round(widthPx * 0.6) })
    : null;

  const url = photoUrl || streetViewUrl;

  if (!url) {
    // A ref anchor for the IntersectionObserver above. It must carry its own
    // box - `display: contents` would leave it with none, and this codebase
    // has already hit that exact failure once with a plain <span> silently
    // taking no height (see MODULE6-HANDOVER.md §10). block + 100%/100%
    // fills the same space PlacePoster's own `.dsc-poster` class already
    // claims, so nothing about the rendered size changes.
    return (
      <span ref={containerRef} style={{ display: 'block', width: '100%', height: '100%' }}>
        <PlacePoster seed={place?.id} category={place?.category} variant={variant} />
      </span>
    );
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
