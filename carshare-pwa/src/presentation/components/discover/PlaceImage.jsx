// ===== PRESENTATION LAYER (PlaceImage) =====
//
// The photograph slot. PlacePoster's header describes this moment: the fixture
// catalogue held references that could not be fetched, so the illustration
// filled every slot; now the live catalogue carries real Google references and
// the photograph renders here instead, with the illustration dropping back to
// the fallback it was always specified to be.
//
// It falls back to the illustration in four cases now, so a slot is never
// empty: no reference, no configured API key, the image failing to load (an
// expired reference, a key without Places Photo authorised, or simply being
// offline), or - new - the media setting being off and this slot not yet
// individually revealed. Every load is a billable Places Photo request
// (docs/MODULE6-API-SETUP.md §3.3), so nothing here fetches until the reader
// has actually asked to see it, either globally (useMediaEnabled) or one slot
// at a time (`revealable`).
//
// Street View (FR-6.15) is not a tier of this component. It used to be - a
// place with no photo of its own fell here to a Street View frame before the
// illustration - but that made it indistinguishable from a real photo on the
// cards that render this component directly, with no tag to say what it
// actually was. It is now StreetViewFrame.jsx, an explicit, labelled scene the
// carousel offers alongside a place's real photographs rather than only in
// their absence - see DestinationDetail.jsx's Carousel.

import { useEffect, useState } from 'react';
import { buildPlacePhotoUrl } from '../../../business-logic/discovery/placePhotos.js';
import { useMediaEnabled } from './useMediaMode.js';
import PlacePoster from './PlacePoster.jsx';

/**
 * @param place          the place record, carrying photoReferences
 * @param variant        which stored photo to show; also picks the poster variant
 * @param widthPx        requested width - keep near the rendered size, since Google
 *                       bills per request and a card does not need a 4800px image
 * @param revealable     when true and the global setting is off, shows a "Show
 *                       photo" button over the illustration instead of just
 *                       waiting for the global setting. Reserved for large,
 *                       one-at-a-time surfaces (a hero, a detail carousel) -
 *                       a grid of list cards gets no button, only the global
 *                       toggle, or twenty buttons would compete with twenty
 *                       cards for attention.
 * @param onShownChange  called with `true`/`false` whenever what is actually
 *                       rendered switches between the real photo and the
 *                       illustration. A caller that draws its own credit or
 *                       "Illustration" tag over this slot (DestinationCard,
 *                       the detail Carousel) must key that markup off this,
 *                       not off whether a reference merely exists - otherwise
 *                       a gated-but-real photo is captioned with a
 *                       photographer's credit over artwork, or an unrevealed
 *                       slot carries no "Illustration" tag despite showing one.
 */
export default function PlaceImage({
  place, variant = 0, widthPx = 800, revealable = false, onShownChange
}) {
  const mediaEnabled = useMediaEnabled();
  const [revealed, setRevealed] = useState(false);
  const [failed, setFailed] = useState(false);

  const reference = place?.photoReferences?.[variant]?.reference;
  const candidateUrl = failed ? null : buildPlacePhotoUrl(reference, { maxWidthPx: widthPx });
  const shown = candidateUrl !== null && (mediaEnabled || revealed);

  useEffect(() => {
    onShownChange?.(shown);
  }, [shown, onShownChange]);

  if (!shown) {
    return (
      <>
        <PlacePoster seed={place?.id} category={place?.category} variant={variant} />
        {revealable && candidateUrl && !mediaEnabled && (
          // Not a <button>: revealable slots (the hero, the carousel frame)
          // can themselves sit inside a card-sized <button> that opens the
          // detail page, and a <button> may not legally contain another
          // interactive element - the nesting silently breaks HTML parsing
          // and would fire both handlers on one click. A span carrying
          // role="button" is a real widget for assistive tech without being
          // "interactive content" under the nesting restriction, so it is
          // safe in both a <button>-wrapped card and a plain <div> frame.
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
            Show photo
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
      // Every load is a billable request, so a card scrolled past is not paid
      // for, and - now - neither is a card nobody asked to see a photo of.
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
