// ===== PRESENTATION LAYER (Tumpang Guide destination detail) =====
// This is intentionally owned by Module 6. It gives a Guide recommendation a
// safe return path without changing Discover's shared DestinationDetail page.
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import { DestinationDiscoveryService } from '../../../business-logic/discovery/DestinationDiscoveryService.js';
import { REVIEW_CONFIDENCE_SATURATION } from '../../../business-logic/discovery/constants.js';
import { buildPlaceDescription } from '../../../business-logic/discovery/PlaceDescription.js';
import { todayIso } from '../../../business-logic/discovery/localDate.js';
import { TumpangGuideService } from '../../../business-logic/guide/TumpangGuideService.js';
import {
  guideCategoryLabel, guideCopy, guideReasonText, guideRoleLabel, guideTradeoffLabel
} from '../../../business-logic/guide/GuideLanguage.js';
import { Button } from '../ui/Button.jsx';
import { AsyncState, PageShell } from '../ui/Primitives.jsx';
import { IconArrowLeft, IconArrowRight, IconCar, IconClock, IconMapPin, IconStar } from '../icons.jsx';
import GuidePlaceImage from './GuidePlaceImage.jsx';

const DEFAULT_ORIGIN = { lat: 3.1390, lng: 101.6869, label: 'Kuala Lumpur' };

function Stars({ rating }) {
  if (!Number.isFinite(rating) || rating < 1) return null;
  return <span className="guide-detail-stars" aria-label={`${rating} out of 5`}>{Array.from({ length: Math.round(rating) }, (_, index) => <IconStar key={index} size={13} />)}</span>;
}

function initialsOf(name) {
  return (name || '?').split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase();
}

export default function GuideDestinationDetail() {
  const { placeId } = useParams();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [photoIndex, setPhotoIndex] = useState(0);
  const travelDate = searchParams.get('date') || todayIso();
  const guideContext = useMemo(() => TumpangGuideService.getDetailReason(placeId), [placeId]);
  const language = guideContext?.planState?.language || 'en';
  const languagePack = guideContext?.languagePack || null;
  const copy = guideCopy(language, languagePack);
  const returnTo = location.state?.returnTo || guideContext?.returnTo || '/assistant';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    DestinationDiscoveryService.getDestination(placeId, {
      userId: user?.id,
      origin: DEFAULT_ORIGIN,
      travelDate
    }).then((result) => {
      if (!cancelled) { setData(result); setPhotoIndex(0); }
    }).catch(() => {
      if (!cancelled) setError(copy.actionFailed);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [copy.actionFailed, placeId, travelDate, user?.id]);

  if (loading) return <PageShell className="guide-page"><AsyncState title={copy.thinking} /></PageShell>;
  if (error || !data) return <PageShell className="guide-page"><Button variant="secondary" onClick={() => navigate(returnTo)}><IconArrowLeft size={16} /> {copy.backToGuide}</Button><AsyncState title={error || copy.noCandidates} /></PageShell>;

  const { place, candidate, rides = [], distanceKm } = data;
  const frames = Math.max(1, place.photoReferences?.length || 0);
  const described = buildPlaceDescription(place, { distanceKm });
  const seatsLeft = rides.reduce((best, ride) => Math.max(best, Number(ride.seatsAvailable) || 0), 0);
  const showRating = Number.isFinite(place.rating) && place.reviewCount >= REVIEW_CONFIDENCE_SATURATION;
  const guideReasons = (guideContext?.reasonCodes || [])
    .map((code) => guideReasonText(code, place, guideContext.planState, language, languagePack))
    .filter(Boolean);
  const openRideSearch = () => navigate(DestinationDiscoveryService.buildPrefillUrl('search', place, {
    origin: guideContext?.planState?.origin || DEFAULT_ORIGIN,
    travelDate
  }));

  return (
    <PageShell className="guide-page guide-detail-page">
      <button className="guide-detail-back" type="button" onClick={() => navigate(returnTo)}><IconArrowLeft size={16} /> {copy.backToGuide}</button>
      <div className="guide-detail-layout">
        <section className="guide-detail-main">
          <div className="guide-detail-gallery">
            <GuidePlaceImage key={`${place.id}-${photoIndex}`} place={place} variant={photoIndex} widthPx={960} revealable copy={copy} />
            {frames > 1 && <>
              <button type="button" className="guide-detail-gallery__nav guide-detail-gallery__prev" aria-label={copy.previousPhoto} onClick={() => setPhotoIndex((index) => (index - 1 + frames) % frames)}><IconArrowLeft size={18} /></button>
              <button type="button" className="guide-detail-gallery__nav guide-detail-gallery__next" aria-label={copy.nextPhoto} onClick={() => setPhotoIndex((index) => (index + 1) % frames)}><IconArrowRight size={18} /></button>
              <div className="guide-detail-gallery__dots">{Array.from({ length: frames }, (_, index) => <button key={index} type="button" className={index === photoIndex ? 'active' : ''} aria-label={`${index + 1} / ${frames}`} onClick={() => setPhotoIndex(index)} />)}</div>
            </>}
          </div>
          <p className="guide-eyebrow">{guideContext ? guideRoleLabel(guideContext.role, language, languagePack) : copy.smart}</p>
          <h1>{place.name}</h1>
          <p className="guide-detail-location"><IconMapPin size={15} /> {place.state} · {guideCategoryLabel(place.category, language, languagePack)}</p>
          <div className="guide-detail-facts">
            {showRating ? <span><Stars rating={place.rating} /> {place.rating.toFixed(1)} ({place.reviewCount.toLocaleString()})</span> : null}
            {Number.isFinite(distanceKm) && <span>{Math.round(distanceKm)} km</span>}
            {place.updatedAt && <span><IconClock size={14} /> {new Date(place.updatedAt).toLocaleDateString(language)}</span>}
          </div>
          <p className="guide-detail-description">{described?.text || place.description}</p>

          {guideContext && <section className="guide-detail-reason"><strong>{copy.whyGuide}</strong><p>{guideReasons.join(' ') || copy.verifiedRules}</p><small>{copy.tradeoff}: {guideTradeoffLabel(guideContext.tradeoffCode, language, languagePack)}</small></section>}
          {place.travelNote && <section className="guide-detail-section"><h2>{copy.gettingThere}</h2><p>{place.travelNote}</p></section>}
          {place.reviews?.length > 0 && <section className="guide-detail-section"><h2>{copy.reviewsHeading}</h2>{place.reviews.map((review) => <article className="guide-detail-review" key={`${review.author}-${review.text.slice(0, 16)}`}><span className="guide-detail-review__avatar" aria-hidden="true">{initialsOf(review.author)}</span><div><div className="guide-detail-review__head"><strong>{review.author}</strong><Stars rating={review.rating} /></div><p>{review.text}</p></div></article>)}</section>}
        </section>
        <aside className="guide-detail-aside">
          <section className="guide-detail-card"><p className="guide-eyebrow">{copy.smart}</p><h2>{place.name}</h2>{rides.length > 0 ? <p><IconCar size={15} /> {rides.length} · {seatsLeft} {copy.people}</p> : <p>{copy.tradeoffs?.no_ride_yet}</p>}<Button onClick={openRideSearch}><IconCar size={16} /> {copy.findRide}</Button></section>
        </aside>
      </div>
    </PageShell>
  );
}
