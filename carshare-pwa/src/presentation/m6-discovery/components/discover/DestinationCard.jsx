// ===== PRESENTATION LAYER (DestinationCard) =====
// One destination in the list. The whole card opens the detail screen - there is
// only one thing to do with a destination card, so splitting it into a media
// button plus a title button only added focus stops without adding choices.
//
// Presentation degrades through the defined tiers: a place under ten reviews
// shows a low-confidence indicator instead of a number (FR-6.16), and a place
// with no fetchable photograph falls to the category illustration (FR-6.17).
import { useState } from 'react';
import { IconStar, IconUsers, IconCar, IconAlertTriangle, IconMapPin, IconClock } from '../../../shared/components/icons.jsx';
import { REVIEW_CONFIDENCE_SATURATION } from '../../../../business-logic/m6-discovery/discovery/constants.js';
import { buildPlaceDescription } from '../../../../business-logic/m6-discovery/discovery/PlaceDescription.js';
import { photoAttributionName } from '../../../../business-logic/shared/PlacePhotoService.js';
import { PHOTO_WIDTH_CARD } from '../../../../business-logic/m6-discovery/discovery/placePhotos.js';
import PlaceImage from './PlaceImage.jsx';

export function Rating({ rating, reviewCount }) {
  if (!rating || reviewCount < REVIEW_CONFIDENCE_SATURATION) {
    return <span className="dsc-rating dsc-rating-low">Too few reviews</span>;
  }
  return (
    <span className="dsc-rating">
      <IconStar size={14} /> {rating.toFixed(1)}
      <span className="dsc-review-count">({reviewCount.toLocaleString()})</span>
    </span>
  );
}

// Shows the scheduled ingestion sweep is actually keeping the catalogue
// current (042_m6_scheduled_ingestion.sql), not serving stale data
// indefinitely. Hidden entirely rather than shown wrong when a place has no
// updatedAt yet, since that is silently true of any record predating this.
export function freshnessLabel(updatedAt) {
  if (!updatedAt) return null;
  const then = new Date(updatedAt).getTime();
  if (!Number.isFinite(then)) return null;
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days < 1) return 'Updated today';
  if (days < 30) return `Updated ${days}d ago`;
  return `Updated ${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(then)}`;
}

export default function DestinationCard({ candidate, onOpen, index }) {
  const place = candidate.place;
  const [photo, setPhoto] = useState(null);
  if (!place) return null;

  const seatsLeft = candidate.rides.reduce((best, r) => Math.max(best, r.seatsAvailable || 0), 0);
  const credit = photo ? photoAttributionName(photo.attribution) : '';
  // Falls back to the stored description when there are too few reviews to
  // describe the place from them (FR-6.10).
  const described = buildPlaceDescription(place, { distanceKm: candidate.distanceKm });
  const freshness = freshnessLabel(place.updatedAt);

  return (
    <article
      className={'dsc-card' + (candidate.rideStatus === 'available' && !candidate.servedByRide ? ' dsc-card-unserved' : '')}
      onClick={() => onOpen(place.id)}
      style={Number.isInteger(index) ? { '--motion-delay': `${Math.min(index, 5) * 40}ms` } : undefined}
    >
      <span className="dsc-card-media">
        <PlaceImage
          place={place}
          widthPx={PHOTO_WIDTH_CARD}
          revealable
          onShownChange={(shown, currentPhoto) => setPhoto(shown ? currentPhoto : null)}
        />
        {credit && <span className="dsc-photo-credit">Photo by {credit}</span>}
      </span>

      <div
        className="dsc-card-body"
        role="link"
        tabIndex={0}
        aria-label={`View ${place.name} details`}
        onClick={(event) => { event.stopPropagation(); onOpen(place.id); }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          onOpen(place.id);
        }}
      >
        <span className="dsc-card-head">
          <h3 className="dsc-card-title">{place.name}</h3>
          <span className="dsc-chip">{place.category}</span>
        </span>

        {/* Clamped in CSS rather than cut in JS: the whole description stays in
            the document for anyone reading it with assistive technology, and
            the card keeps a predictable height in the grid. */}
        <p className="dsc-card-desc">{described?.text || place.description}</p>

        <span className="dsc-card-meta">
          <Rating rating={place.rating} reviewCount={place.reviewCount} />
          <span className="dsc-meta-item"><IconMapPin size={14} /> {place.state}</span>
          {Number.isFinite(candidate.distanceKm) && (
            <span className="dsc-meta-item">{Math.round(candidate.distanceKm)} km straight line</span>
          )}
          {freshness && (
            <span className="dsc-meta-item"><IconClock size={14} /> {freshness}</span>
          )}
        </span>

        {candidate.weatherAdvisory && (
          <span className="dsc-weather">
            <IconAlertTriangle size={14} /> {candidate.weatherAdvisory}
          </span>
        )}

        {candidate.rideStatus !== 'available' ? (
          <span className="dsc-availability dsc-traffic-unknown">
            <IconAlertTriangle size={16} />
            <span>Ride information unavailable</span>
          </span>
        ) : candidate.rides.length > 0 ? (
          <span className="dsc-availability dsc-served">
            <IconCar size={16} />
            <span>
              <strong>{candidate.rides.length}</strong> listed ride{candidate.rides.length > 1 ? 's' : ''}
              {' · '}{seatsLeft > 0
                ? <>up to <strong>{seatsLeft}</strong> seat{seatsLeft === 1 ? '' : 's'} in one listed ride</>
                : <strong>No seats remaining</strong>}
              <small className="dsc-availability-note">Pickup point, time and seat fit still need checking.</small>
            </span>
          </span>
        ) : (
          <span className="dsc-availability dsc-unserved">
            <IconCar size={16} />
            <span>
              <strong>No listed ride for this date</strong>
            </span>
          </span>
        )}
        {candidate.interestedUsers > 0 && (
          <span className="dsc-interest-note">
            <IconUsers size={13} /> {candidate.interestedUsers} {candidate.interestedUsers === 1 ? 'traveller has' : 'travellers have'} viewed this as an option for this date.
          </span>
        )}
      </div>
    </article>
  );
}
