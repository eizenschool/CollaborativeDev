// ===== PRESENTATION LAYER (DestinationCard) =====
// One destination in the list. The whole card opens the detail screen - there is
// only one thing to do with a destination card, so splitting it into a media
// button plus a title button only added focus stops without adding choices.
//
// Presentation degrades through the defined tiers: a place under ten reviews
// shows a low-confidence indicator instead of a number (FR-6.16), and a place
// with no fetchable photograph falls to the category illustration (FR-6.17).
import { IconStar, IconUsers, IconCar, IconAlertTriangle, IconMapPin } from '../icons.jsx';
import { REVIEW_CONFIDENCE_SATURATION } from '../../../business-logic/discovery/constants.js';
import { buildPlaceDescription } from '../../../business-logic/discovery/PlaceDescription.js';
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

export default function DestinationCard({ candidate, onOpen }) {
  const place = candidate.place;
  if (!place) return null;

  const seatsLeft = candidate.rides.reduce((best, r) => Math.max(best, r.seatsAvailable || 0), 0);
  const credit = place.photoReferences?.[0]?.attribution;
  // Falls back to the stored description when there are too few reviews to
  // describe the place from them (FR-6.10).
  const described = buildPlaceDescription(place, { distanceKm: candidate.distanceKm });

  return (
    <button
      type="button"
      className={'dsc-card' + (candidate.servedByRide ? '' : ' dsc-card-unserved')}
      onClick={() => onOpen(place.id)}
    >
      <span className="dsc-card-media">
        <PlaceImage place={place} widthPx={600} />
        {credit && <span className="dsc-photo-credit">{credit}</span>}
      </span>

      <span className="dsc-card-body">
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
            <span className="dsc-meta-item">{Math.round(candidate.distanceKm)} km</span>
          )}
        </span>

        {candidate.weatherAdvisory && (
          <span className="dsc-weather">
            <IconAlertTriangle size={14} /> {candidate.weatherAdvisory}
          </span>
        )}

        {candidate.servedByRide ? (
          <span className="dsc-availability dsc-served">
            <IconCar size={16} />
            <span>
              <strong>{candidate.rides.length}</strong> ride{candidate.rides.length > 1 ? 's' : ''} going
              {' · '}<strong>{seatsLeft}</strong> seat{seatsLeft === 1 ? '' : 's'} left
            </span>
          </span>
        ) : (
          <span className="dsc-availability dsc-unserved">
            <IconUsers size={16} />
            <span>
              {candidate.interestedUsers > 0
                ? <><strong>{candidate.interestedUsers}</strong> {candidate.interestedUsers === 1 ? 'person wants' : 'people want'} to go</>
                : 'Nobody is driving here yet'}
            </span>
          </span>
        )}
      </span>
    </button>
  );
}
