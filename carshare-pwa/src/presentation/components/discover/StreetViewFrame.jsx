// ===== PRESENTATION LAYER (StreetViewFrame) =====
// FR-6.15. An interactive Street View scene, offered alongside a place's real
// photographs rather than only in their absence - see Carousel in
// DestinationDetail.jsx.
//
// Coverage is checked once, through the free metadata check
// (checkStreetViewCoverage), rather than assumed from having a coordinate
// alone. An embedded iframe has no clean "this failed" signal the way an
// `<img onError>` does: an uncovered coordinate still loads as a normal
// response, showing Google's own "no imagery here" UI inside the frame rather
// than anything this component could intercept afterward. Checking first, and
// falling to the illustration before the iframe is ever created, is what
// keeps this module's "never show a third party's own broken state"
// guarantee intact for a component type that cannot self-report failure.
//
// The check itself is deferred behind the same media setting that gates
// photos (useMediaEnabled), plus a per-frame reveal button. Street View costs
// nothing billable - the metadata check is free and the embed is a no-charge
// Maps Embed API SKU - so this is not about quota; it is that reloading
// Google's embed bootstrap on every visit to this carousel frame is slow, and
// deferring it until asked for is the fix, the same shape as the photo gate.

import { useEffect, useState } from 'react';
import {
  buildStreetViewEmbedUrl, checkStreetViewCoverage, hasStreetViewEmbedKey
} from '../../../business-logic/discovery/StreetView.js';
import { useMediaEnabled } from './useMediaMode.js';
import PlacePoster from './PlacePoster.jsx';

const NOT_CHECKED = { covered: false, heading: null, capturedAt: null };

/**
 * @param place       the place record, carrying lat/lng
 * @param onResult    reports the actual coverage result upward (or the
 *                    not-checked placeholder while gated), so the carousel's
 *                    "Street View" vs "Illustration" tag reflects what is
 *                    truly on screen rather than assuming this frame always
 *                    shows real imagery
 * @param revealable  shows a "Load Street View" button over the illustration
 *                    when the global setting is off, instead of only waiting
 *                    for it
 */
export default function StreetViewFrame({ place, onResult, revealable = false }) {
  const mediaEnabled = useMediaEnabled();
  const [revealed, setRevealed] = useState(false);
  const show = mediaEnabled || revealed;

  const hasCoordinate = Number.isFinite(place?.lat) && Number.isFinite(place?.lng);
  const canCheck = show && hasCoordinate && hasStreetViewEmbedKey();

  // Lazy initial value so a gated frame never flashes "Checking Street View…"
  // for a frame that was never going to check anything - the effect below
  // only needs to run, and only needs to show that placeholder, once `show`
  // actually becomes true.
  const [coverage, setCoverage] = useState(() => (canCheck ? null : NOT_CHECKED));

  useEffect(() => {
    let cancelled = false;
    if (!canCheck) {
      setCoverage(NOT_CHECKED);
      return undefined;
    }
    setCoverage(null);
    checkStreetViewCoverage(place.lat, place.lng).then((result) => {
      if (!cancelled) setCoverage(result);
    });
    return () => { cancelled = true; };
  }, [canCheck, place?.lat, place?.lng]);

  // The parent renders the "Street View" tag and credit, or the
  // "Illustration" one, based on this - it must not assume from being asked
  // to render this frame at all that real imagery is what came back, and a
  // frame nobody has revealed yet is honestly reported the same way a
  // genuinely uncovered coordinate is: no real imagery is on screen.
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
    return (
      <>
        <PlacePoster seed={place?.id} category={place?.category} variant="streetview" />
        {revealable && !show && hasCoordinate && hasStreetViewEmbedKey() && (
          // See PlaceImage.jsx for why this is a span with role="button" and
          // not a literal <button>: this frame sits inside DestinationDetail's
          // plain <div> carousel today, but the same reasoning applies to any
          // future caller that wraps it in a clickable card.
          <span
            role="button"
            tabIndex={0}
            className="dsc-reveal"
            onClick={(event) => { event.stopPropagation(); setRevealed(true); }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              event.stopPropagation();
              setRevealed(true);
            }}
          >
            Load Street View
          </span>
        )}
      </>
    );
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
