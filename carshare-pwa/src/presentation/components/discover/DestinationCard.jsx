// ===== PRESENTATION LAYER (DestinationCard) =====
// One destination candidate in the list.
//
// Presentation degrades in the defined tiers rather than failing: a place with
// no photograph shows a category illustration, and a place under ten reviews
// shows a low-confidence indicator instead of a numeric rating (FR-6.16) - the
// same threshold the quality signal uses, so display and ranking never disagree.
import { useState } from 'react';
import { IconStar, IconUsers, IconCar, IconAlertTriangle, IconMapPin } from '../icons.jsx';
import { REVIEW_CONFIDENCE_SATURATION, CATEGORY } from '../../../business-logic/discovery/constants.js';
import ScoreBreakdown from './ScoreBreakdown.jsx';

const CATEGORY_ART = {
  [CATEGORY.CULINARY]: { emoji: '🍜', tint: 'culinary' },
  [CATEGORY.HERITAGE]: { emoji: '🏛️', tint: 'heritage' },
  [CATEGORY.NATURE]: { emoji: '🌿', tint: 'nature' },
  [CATEGORY.EVENT]: { emoji: '🎪', tint: 'event' }
};

function Rating({ rating, reviewCount }) {
  // FR-6.16: below ten reviews the number is suppressed, not rounded or hidden
  // silently - the user is told the sample is too thin to trust.
  if (!rating || reviewCount < REVIEW_CONFIDENCE_SATURATION) {
    return (
      <span className="dsc-rating dsc-rating-low" title={`Only ${reviewCount} review(s)`}>
        Too few reviews
      </span>
    );
  }
  return (
    <span className="dsc-rating">
      <IconStar size={13} /> {rating.toFixed(1)}
      <span className="dsc-review-count">({reviewCount.toLocaleString()})</span>
    </span>
  );
}

export default function DestinationCard({ candidate, onOpen, onFindRide, onOfferDrive, onNotify }) {
  const [showWhy, setShowWhy] = useState(false);
  const place = candidate.place;
  if (!place) return null;

  const art = CATEGORY_ART[place.category] || CATEGORY_ART[CATEGORY.NATURE];
  const hasPhoto = place.photoReferences?.length > 0;
  const seatsLeft = candidate.rides.reduce((best, r) => Math.max(best, r.seatsAvailable || 0), 0);

  return (
    <article className={`dsc-card dsc-tint-${art.tint}`}>
      <button className="dsc-card-media" onClick={() => onOpen(place.id)} type="button">
        {/* Photo references are stored, never image bytes - the real carousel
            fetches through a proxy at display time. The fixture has no live
            reference, so it falls to the category illustration tier (FR-6.17). */}
        <span className="dsc-card-art" aria-hidden="true">{art.emoji}</span>
        {hasPhoto && (
          <span className="dsc-photo-credit">
            Photo: {place.photoReferences[0].attribution}
          </span>
        )}
      </button>

      <div className="dsc-card-body">
        <header className="dsc-card-head">
          <button className="dsc-card-title" onClick={() => onOpen(place.id)} type="button">
            {place.name}
          </button>
          <span className={`dsc-chip dsc-chip-${art.tint}`}>{place.category}</span>
        </header>

        <p className="dsc-card-desc">{place.description}</p>

        <div className="dsc-card-meta">
          <Rating rating={place.rating} reviewCount={place.reviewCount} />
          <span className="dsc-meta-item"><IconMapPin size={13} /> {place.state}</span>
          {Number.isFinite(candidate.distanceKm) && (
            <span className="dsc-meta-item">{Math.round(candidate.distanceKm)} km</span>
          )}
        </div>

        {candidate.weatherAdvisory && (
          <p className="dsc-weather"><IconAlertTriangle size={13} /> {candidate.weatherAdvisory}</p>
        )}

        {candidate.servedByRide ? (
          <div className="dsc-availability dsc-served">
            <IconCar size={14} />
            <span>
              <strong>{candidate.rides.length}</strong> ride{candidate.rides.length > 1 ? 's' : ''} going,
              {' '}<strong>{seatsLeft}</strong> seat{seatsLeft === 1 ? '' : 's'} left
            </span>
          </div>
        ) : (
          <div className="dsc-availability dsc-unserved">
            <IconUsers size={14} />
            <span>
              {candidate.interestedUsers > 0
                ? <><strong>{candidate.interestedUsers}</strong> {candidate.interestedUsers === 1 ? 'person wants' : 'people want'} to go — nobody is driving yet</>
                : 'No ride goes here yet'}
            </span>
          </div>
        )}

        <div className="dsc-card-actions">
          {candidate.servedByRide ? (
            <button className="dsc-btn dsc-btn-primary" onClick={() => onFindRide(place)} type="button">
              Find a ride
            </button>
          ) : (
            <>
              <button className="dsc-btn dsc-btn-primary" onClick={() => onOfferDrive(place)} type="button">
                I will drive
              </button>
              <button className="dsc-btn" onClick={() => onNotify(place)} type="button">
                Tell me when there is a ride
              </button>
            </>
          )}
          <button
            className="dsc-btn dsc-btn-ghost"
            onClick={() => setShowWhy((open) => !open)}
            type="button"
            aria-expanded={showWhy}
          >
            {showWhy ? 'Hide' : 'Why this?'}
          </button>
        </div>

        {showWhy && <ScoreBreakdown candidate={candidate} />}
      </div>
    </article>
  );
}
