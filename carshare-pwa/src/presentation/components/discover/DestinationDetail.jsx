// ===== PRESENTATION LAYER (DestinationDetail) =====
// UC6.2 - one destination examined closely, and the only place a destination is
// explained. The list card deliberately carries no expandable "why" panel: a
// place has one page, and this is it.
//
// Depth comes from reviews and structured facts rather than from editorial copy
// nobody wrote. The description is composed from what several reviewers
// independently mention (PlaceDescription.js); the individual reviews follow
// below, attributed, as reviews.
import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import { getAuthNavigation } from '../../../business-logic/authAccess.js';
import { DestinationDiscoveryService } from '../../../business-logic/discovery/DestinationDiscoveryService.js';
import { REVIEW_CONFIDENCE_SATURATION } from '../../../business-logic/discovery/constants.js';
import { todayIso } from '../../../business-logic/discovery/localDate.js';
import {
  IconArrowLeft, IconArrowRight, IconStar, IconMapPin, IconCar,
  IconUsers, IconAlertTriangle, IconBell, IconRoute, IconClock
} from '../icons.jsx';
import PlaceImage from './PlaceImage.jsx';
import { freshnessLabel } from './DestinationCard.jsx';
import StreetViewFrame from './StreetViewFrame.jsx';
import { PHOTO_WIDTH_LARGE } from '../../../business-logic/discovery/placePhotos.js';
import { hasStreetViewEmbedKey } from '../../../business-logic/discovery/StreetView.js';
import { buildPlaceDescription } from '../../../business-logic/discovery/PlaceDescription.js';
import ScoreBreakdown from './ScoreBreakdown.jsx';
import { TumpangGuideService } from '../../../business-logic/guide/TumpangGuideService.js';
import { guideReasonText, guideRoleLabel, guideTradeoffLabel } from '../../../business-logic/guide/GuideLanguage.js';

// A sentinel, not a photoReferences record - Carousel below tells it apart
// from a real frame by identity, not by shape.
const STREET_VIEW_FRAME = { streetView: true };

const DEFAULT_ORIGIN = { lat: 3.1390, lng: 101.6869, label: 'Kuala Lumpur' };
const today = todayIso;

const initialsOf = (name) =>
  (name || '?').split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase();

function Stars({ rating }) {
  // Place Details can return a review with no rating attached, so the stars are
  // omitted rather than announced as "null out of 5" to a screen reader.
  if (!Number.isFinite(rating) || rating < 1) return null;
  return (
    <span className="dsc-review-stars" aria-label={`${rating} out of 5`}>
      {Array.from({ length: Math.round(rating) }, (_, i) => <IconStar key={i} size={12} />)}
    </span>
  );
}

/**
 * Renders `photoReferences`, plus - FR-6.15 - an explicit Street View scene
 * appended after them for any place carrying a real coordinate. This is not a
 * scarcity fallback: it appears whether or not the place already has photos,
 * because it shows something a photo cannot - the approach on foot, not just
 * the place itself. A place with no photos and no coordinate falls to the
 * illustration tier (FR-6.17), which labels itself rather than passing
 * artwork off as a photograph.
 *
 * Only the current frame's <img> ever exists in the DOM, so stepping through
 * to the Street View frame is what spends that request - opening the page
 * does not, and never did for the photo frames either.
 */
function Carousel({ place }) {
  const [index, setIndex] = useState(0);
  // The result StreetViewFrame's own coverage check actually produced - not
  // assumed from being asked to render the frame. Being on the Street View
  // slot and having real Street View imagery are different facts; the tag and
  // credit below must follow the second one, or a not-yet-revealed or failed
  // frame would caption our own illustration as "Imagery: Google Street View".
  const [streetViewResult, setStreetViewResult] = useState(null);
  // Same idea for photos: whether PlaceImage is actually showing the photo it
  // was given, not merely whether a fetchable reference exists - a real photo
  // gated behind the media setting is still, right now, showing the
  // illustration, and must not be captioned with its photographer's credit.
  const [photoShown, setPhotoShown] = useState(false);
  const photoFrames = place.photoReferences?.length ? place.photoReferences : [];
  const hasCoordinate = Number.isFinite(place?.lat) && Number.isFinite(place?.lng);
  const frames = hasCoordinate && hasStreetViewEmbedKey()
    ? [...photoFrames, STREET_VIEW_FRAME]
    : (photoFrames.length ? photoFrames : [null]);
  const current = frames[index];
  const isStreetViewFrame = current === STREET_VIEW_FRAME;
  const move = (step) => setIndex((i) => (i + step + frames.length) % frames.length);
  const streetViewCovered = isStreetViewFrame && streetViewResult?.covered === true;
  const streetViewFellBack = isStreetViewFrame
    && streetViewResult !== null && streetViewResult.covered !== true;
  // The tag would otherwise call a real photograph, or real Street View
  // imagery that turned out uncovered (or not yet revealed), an illustration
  // mislabelled the other way - or vice versa.
  const isIllustration = streetViewFellBack || (!isStreetViewFrame && !photoShown);

  return (
    <div className="dsc-carousel">
      <div className="dsc-carousel-frame">
        {isStreetViewFrame
          ? (
            <StreetViewFrame
              key={`${place.id}-streetview`}
              place={place}
              onResult={setStreetViewResult}
              revealable
            />
          )
          : (
            <PlaceImage
              key={`${place.id}-${index}`}
              place={place}
              variant={index}
              widthPx={PHOTO_WIDTH_LARGE}
              revealable
              onShownChange={setPhotoShown}
            />
          )}
        {streetViewCovered && <span className="dsc-illustration-tag">Street View</span>}
        {isIllustration && <span className="dsc-illustration-tag">Illustration</span>}
        {streetViewCovered && (
          <span className="dsc-photo-credit">
            Imagery: Google Street View
            {/* Google does not guarantee every panorama carries a capture
                date - unknown is shown as unknown, never assumed recent or
                silently omitted, so a viewer can judge freshness themselves
                rather than trust an illustration-free frame that might still
                be years old. */}
            {streetViewResult.capturedAt ? ` · Captured ${streetViewResult.capturedAt}` : ''}
          </span>
        )}
        {!isStreetViewFrame && photoShown && current?.attribution && (
          <span className="dsc-photo-credit">Photo: {current.attribution}</span>
        )}

        {frames.length > 1 && (
          <>
            <button
              type="button" className="dsc-carousel-nav dsc-carousel-prev"
              onClick={() => move(-1)} aria-label="Previous image"
            >
              <IconArrowLeft size={18} />
            </button>
            <button
              type="button" className="dsc-carousel-nav dsc-carousel-next"
              onClick={() => move(1)} aria-label="Next image"
            >
              <IconArrowRight size={18} />
            </button>
            <div className="dsc-carousel-dots">
              {frames.map((frame, i) => (
                <button
                  key={frame === STREET_VIEW_FRAME ? 'streetview' : (frame?.reference || i)}
                  type="button"
                  className={'dsc-dot' + (i === index ? ' active' : '')}
                  onClick={() => setIndex(i)}
                  aria-label={frame === STREET_VIEW_FRAME ? 'Street View' : `Image ${i + 1} of ${frames.length}`}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function DestinationDetail() {
  const { placeId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const travelDate = searchParams.get('date') || today();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const returnToGuide = () => {
    const returnTo = typeof location.state?.returnTo === 'string' && location.state.returnTo.startsWith('/assistant')
      ? location.state.returnTo : null;
    if (returnTo) {
      navigate(returnTo, { state: { guideRestoreScrollTop: Number(location.state?.guideRestoreScrollTop) || 0 } });
      return;
    }
    navigate('/home');
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const detail = await DestinationDiscoveryService.getDestination(placeId, {
        userId: user?.id, origin: DEFAULT_ORIGIN, travelDate
      });
      if (!cancelled) { setData(detail); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [placeId, travelDate, user?.id]);

  if (loading) {
    return <div className="dsc-page"><p className="dsc-empty">Loading…</p></div>;
  }

  if (!data) {
    return (
      <div className="dsc-page">
        <p className="dsc-empty">That destination is no longer available.</p>
        <button className="dsc-btn" onClick={returnToGuide} type="button">
          {location.state?.fromGuide ? 'Back to Tumpang Guide' : 'Back to destinations'}
        </button>
      </div>
    );
  }

  const { place, candidate, rides, interestedUsers, distanceKm } = data;
  const seatsLeft = rides.reduce((best, r) => Math.max(best, r.seatsAvailable || 0), 0);
  const showRating = place.rating && place.reviewCount >= REVIEW_CONFIDENCE_SATURATION;
  const described = buildPlaceDescription(place, { distanceKm });
  const freshness = freshnessLabel(place.updatedAt);
  const guideContext = TumpangGuideService.getDetailReason(place.id);
  const guideLanguage = guideContext?.planState?.language || 'en';
  const guideReasons = (guideContext?.reasonCodes || [])
    .map((code) => guideReasonText(code, place, guideContext.planState, guideLanguage))
    .filter(Boolean);

  const notifyMe = async () => {
    if (!user) {
      const target = getAuthNavigation(
        null, `/discover/${place.id}`, 'Sign in to be notified when a ride is published.'
      );
      navigate(target.to, { state: target.state });
      return;
    }
    try {
      const { alreadyExisted } = await DestinationDiscoveryService
        .registerForNotification(user.id, place.id, travelDate);
      setNotice(alreadyExisted
        ? 'You are already registered for this destination.'
        : 'We will tell you when a ride to this destination is published.');
    } catch {
      setNotice('Could not register right now. Please try again.');
    }
  };

  return (
    <div className="dsc-page dsc-detail">
      <button className="dsc-back" onClick={returnToGuide} type="button">
        <IconArrowLeft size={16} /> {location.state?.fromGuide ? 'Back to Tumpang Guide' : 'Back to destinations'}
      </button>

      {guideContext && (
        <section className="dsc-guide-context" aria-labelledby="dsc-guide-context-title">
          <strong id="dsc-guide-context-title">Tumpang Guide · {guideRoleLabel(guideContext.role, guideLanguage)}</strong>
          <p>
            Recommended for {guideContext.planState?.startDate || 'your selected date'} from {guideContext.planState?.origin?.label || 'your starting point'}.
            {' '}Trade-off: {guideTradeoffLabel(guideContext.tradeoffCode, guideLanguage)}.
          </p>
          {guideReasons.length > 0 && <p>{guideReasons.slice(0, 2).join(' · ')}</p>}
        </section>
      )}

      <div className="dsc-detail-layout">
        <div className="dsc-detail-main">
          <Carousel place={place} />

          <h1>{place.name}</h1>
          <div className="dsc-card-meta">
            <span className="dsc-chip">{place.category}</span>
            <span className="dsc-meta-item"><IconMapPin size={14} /> {place.state}</span>
            {Number.isFinite(distanceKm) && (
              <span className="dsc-meta-item">{Math.round(distanceKm)} km away</span>
            )}
            {showRating ? (
              <span className="dsc-rating">
                <IconStar size={14} /> {place.rating.toFixed(1)}
                <span className="dsc-review-count">({place.reviewCount.toLocaleString()})</span>
              </span>
            ) : (
              <span className="dsc-rating dsc-rating-low">Too few reviews to rate</span>
            )}
            {freshness && (
              <span className="dsc-meta-item"><IconClock size={14} /> {freshness}</span>
            )}
          </div>

          {/* Shown in full here - the card clamps it, this screen is where a
              reader came to know more. */}
          <p className="dsc-detail-desc">{described?.text || place.description}</p>

          {data.weatherWithheld && (
            <p className="dsc-weather">
              <IconAlertTriangle size={14} />
              {data.weatherReason} — this destination is withheld from
              recommendations for {travelDate}.
            </p>
          )}

          {place.reviews?.length > 0 && (
            <section className="dsc-panel">
              <h2>What travellers say</h2>
              {place.reviews.map((review) => (
                <div className="dsc-review" key={`${review.author}-${review.text.slice(0, 12)}`}>
                  <div className="dsc-review-head">
                    <span className="dsc-review-avatar" aria-hidden="true">
                      {initialsOf(review.author)}
                    </span>
                    <span className="dsc-review-author">{review.author}</span>
                    <Stars rating={review.rating} />
                  </div>
                  <p className="dsc-review-text">{review.text}</p>
                </div>
              ))}
            </section>
          )}

          {place.travelNote && (
            <section className="dsc-panel">
              <h2>Getting there</h2>
              <p>{place.travelNote}</p>
            </section>
          )}

          {candidate && (
            <section className="dsc-panel">
              <h2>Why we are suggesting this</h2>
              <ScoreBreakdown candidate={candidate} />
            </section>
          )}
        </div>

        <aside className="dsc-detail-aside">
          <section className="dsc-panel">
            {rides.length > 0 ? (
              <>
                <div className="dsc-availability dsc-served">
                  <IconCar size={16} />
                  <span>
                    <strong>{rides.length}</strong> ride{rides.length > 1 ? 's' : ''} going
                    {' · '}<strong>{seatsLeft}</strong> seat{seatsLeft === 1 ? '' : 's'} left
                  </span>
                </div>
                <div className="dsc-actions">
                  <button
                    className="dsc-btn dsc-btn-primary"
                    type="button"
                    onClick={() => navigate(DestinationDiscoveryService.buildPrefillUrl(
                      'search', place, { origin: DEFAULT_ORIGIN, travelDate }
                    ))}
                  >
                    <IconCar size={16} /> Find a ride
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="dsc-availability dsc-unserved">
                  <IconUsers size={16} />
                  <span>
                    {interestedUsers > 0
                      ? <><strong>{interestedUsers}</strong> {interestedUsers === 1 ? 'person wants' : 'people want'} to go — nobody is driving yet</>
                      : 'Nobody is driving here yet'}
                  </span>
                </div>
                <div className="dsc-actions">
                  <button
                    className="dsc-btn dsc-btn-primary"
                    type="button"
                    onClick={() => navigate(DestinationDiscoveryService.buildPrefillUrl(
                      'publish', place, { origin: DEFAULT_ORIGIN, travelDate }
                    ))}
                  >
                    <IconRoute size={16} /> I will drive
                  </button>
                  <button className="dsc-btn" onClick={notifyMe} type="button">
                    <IconBell size={16} /> Tell me when there is a ride
                  </button>
                </div>
              </>
            )}

            {notice && <p className="dsc-notice">{notice}</p>}
          </section>
        </aside>
      </div>
    </div>
  );
}
