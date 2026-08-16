// ===== PRESENTATION LAYER (PlaceImage) =====
//
// The photograph slot. PlacePoster's header describes this moment: the fixture
// catalogue held references that could not be fetched, so the illustration
// filled every slot; now the live catalogue carries real Google references and
// the photograph renders here instead, with the illustration dropping back to
// the fallback it was always specified to be.
//
// Three tiers, in order: a real Google Photos reference; failing that, FR-6.15
// Street View for a place that has coordinates but no photograph of its own,
// served through supabase/functions/m6-streetview so no Google key ever
// reaches this bundle; failing that, the illustration. A slot is never empty.
//
// All three tiers are plain <img> elements with native `loading="lazy"`, so a
// card scrolled past never fires any of them - Street View needs no bespoke
// deferral logic because the Edge Function does its own metadata-first check
// server-side, collapsing what would otherwise be a client-side pre-check into
// the one request the <img> tag already makes.
//
// The Street View tier only ever fires for `variant === 0`. Google Photos
// references can hold up to five frames (MAX_PHOTOS_PER_PLACE) and the carousel
// pages through them; there is exactly one Street View image per coordinate, so
// asking for it as "frame 2 of a place with no photos" would either repeat the
// same request or draw nothing. One establishing image beats a five-frame
// carousel that cannot exist.

import { useState } from 'react';
import { buildPlacePhotoUrl } from '../../../business-logic/discovery/placePhotos.js';
import { buildStreetViewProxyUrl } from '../../../business-logic/discovery/StreetView.js';
import PlacePoster from './PlacePoster.jsx';

/**
 * @param place    the place record, carrying photoReferences and lat/lng
 * @param variant  which stored photo to show; also picks the poster variant
 * @param widthPx  requested width - keep near the rendered size, since Google
 *                 bills per request and a card does not need a 4800px image
 */
export default function PlaceImage({ place, variant = 0, widthPx = 800 }) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const [streetViewFailed, setStreetViewFailed] = useState(false);

  const reference = place?.photoReferences?.[variant]?.reference;
  const photoUrl = photoFailed ? null : buildPlacePhotoUrl(reference, { maxWidthPx: widthPx });

  const streetViewEligible = !photoUrl && !streetViewFailed && variant === 0
    && Number.isFinite(place?.lat) && Number.isFinite(place?.lng);
  const streetViewUrl = streetViewEligible
    ? buildStreetViewProxyUrl(place.lat, place.lng, { width: widthPx, height: Math.round(widthPx * 0.6) })
    : null;

  const url = photoUrl || streetViewUrl;

  if (!url) {
    return <PlacePoster seed={place?.id} category={place?.category} variant={variant} />;
  }

  return (
    <img
      className="dsc-photo"
      src={url}
      alt={place?.name || ''}
      // Every load is a billable request (Street View) or a proxied one that
      // still costs a round trip (photos), so a card scrolled past is not
      // paid for.
      loading="lazy"
      decoding="async"
      onError={() => {
        if (photoUrl) setPhotoFailed(true);
        else setStreetViewFailed(true);
      }}
    />
  );
}
