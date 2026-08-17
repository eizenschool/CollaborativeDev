// ===== PRESENTATION LAYER (StreetViewFrame) =====
// FR-6.15. An interactive Street View scene, offered alongside a place's real
// photographs rather than only in their absence - see Carousel in
// DestinationDetail.jsx.
//
// Coverage is checked once, on mount, through the free metadata check
// (checkStreetViewCoverage) rather than assumed from having a coordinate
// alone. An embedded iframe has no clean "this failed" signal the way an
// `<img onError>` does: an uncovered coordinate still loads as a normal
// response, showing Google's own "no imagery here" UI inside the frame rather
// than anything this component could intercept afterward. Checking first, and
// falling to the illustration before the iframe is ever created, is what
// keeps this module's "never show a third party's own broken state"
// guarantee intact for a component type that cannot self-report failure.

import { useEffect, useState } from 'react';
import {
  buildStreetViewEmbedUrl, checkStreetViewCoverage, hasStreetViewEmbedKey
} from '../../../business-logic/discovery/StreetView.js';
import PlacePoster from './PlacePoster.jsx';

export default function StreetViewFrame({ place, onResult }) {
  const [coverage, setCoverage] = useState(null); // null while the check is in flight

  const hasCoordinate = Number.isFinite(place?.lat) && Number.isFinite(place?.lng);

  useEffect(() => {
    let cancelled = false;
    if (!hasCoordinate || !hasStreetViewEmbedKey()) {
      setCoverage({ covered: false, heading: null, capturedAt: null });
      return undefined;
    }
    setCoverage(null);
    checkStreetViewCoverage(place.lat, place.lng).then((result) => {
      if (!cancelled) setCoverage(result);
    });
    return () => { cancelled = true; };
  }, [hasCoordinate, place?.lat, place?.lng]);

  // The parent renders the "Street View" tag and credit, or the
  // "Illustration" one, based on this - it must not assume from being asked
  // to render this frame at all that real imagery is what came back.
  useEffect(() => {
    onResult?.(coverage);
  }, [coverage, onResult]);

  if (coverage === null) {
    return (
      <div className="dsc-streetview-checking" role="status">
        Checking Street View…
      </div>
    );
  }

  const url = coverage.covered
    ? buildStreetViewEmbedUrl(place.lat, place.lng, { heading: coverage.heading })
    : null;

  if (!url) {
    return <PlacePoster seed={place?.id} category={place?.category} variant="streetview" />;
  }

  return (
    <iframe
      className="dsc-streetview-embed"
      src={url}
      title={`Street View near ${place?.name || 'this place'}`}
      loading="lazy"
      allowFullScreen
      referrerPolicy="no-referrer-when-downgrade"
    />
  );
}
