import { useState } from 'react';
import { Link } from 'react-router-dom';
import { calculateCompositeHostImpact, getBadgeForStats } from '../../../business-logic/HostImpactEngine.js';
import {
  spokenLanguageLabel,
  vehicleTypeLabel
} from '../../../business-logic/CompatibilityOptions.js';
import {
  IconAlertTriangle,
  IconArrowRight,
  IconCalendar,
  IconHeart,
  IconMapPin,
  IconMedal,
  IconStar,
  IconUsers
} from '../icons.jsx';
import DestinationRidePhoto from '../ride/DestinationRidePhoto.jsx';

function formatDeparture(ride) {
  if (!ride?.departureAt && !ride?.date) return 'Schedule unavailable';
  const instant = ride.departureAt || `${ride.date}T${ride.time}:00+08:00`;
  return new Intl.DateTimeFormat('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(instant));
}

function formatArrival(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(value));
}

function initials(name) {
  return (name || '?').split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase();
}

export function FavouriteButton({ saved, pending, onToggle, rideLabel }) {
  return (
    <button
      className={`search-favourite-button${saved ? ' saved' : ''}`}
      type="button"
      disabled={pending}
      onClick={onToggle}
      aria-pressed={saved}
      aria-label={saved ? `Remove ${rideLabel} from favourites` : `Save ${rideLabel} to favourites`}
      title={saved ? 'Remove from favourites' : 'Save to favourites'}
    >
      <IconHeart size={18} aria-hidden="true" />
    </button>
  );
}

export function SearchRideCard({
  ride,
  proximityLabel = '',
  saved = false,
  favouritePending = false,
  onToggleFavourite,
  onView,
  onFindSimilar,
  unavailable = false
}) {
  const routeLabel = `${ride.pickup} to ${ride.destination}`;
  const impact = Math.round(calculateCompositeHostImpact(ride.host) * 10) / 10;
  const tier = ride.host ? getBadgeForStats(ride.host).name : null;
  const vehicleLabel = vehicleTypeLabel(ride.vehicleType);
  const languageLabels = (ride.host?.spokenLanguages || []).map(spokenLanguageLabel).filter(Boolean);
  const [hasDestinationPhoto, setHasDestinationPhoto] = useState(false);
  const destinationPhotoPlaceId = ride.destinationPhotoPlaceId || ride.destinationLocation?.placeId;

  return (
    <article className={`search-ride-card${unavailable ? ' unavailable' : ''}${hasDestinationPhoto ? ' has-destination-photo' : ''}`}>
      <DestinationRidePhoto placeId={destinationPhotoPlaceId} label={ride.destination} onReadyChange={setHasDestinationPhoto} />
      {unavailable && (
        <div className="search-unavailable-banner" role="status">
          <IconAlertTriangle size={16} aria-hidden="true" />
          This saved ride is no longer available.
        </div>
      )}

      <div className="search-ride-card-body">
        <div className="search-ride-card-head">
          <div className="search-route" aria-label={routeLabel}>
            <span><IconMapPin size={15} aria-hidden="true" /><strong>{ride.pickup}</strong></span>
            <i aria-hidden="true" />
            <span className="destination"><IconMapPin size={15} aria-hidden="true" /><strong>{ride.destination}</strong></span>
          </div>
          <FavouriteButton
            saved={saved}
            pending={favouritePending}
            onToggle={onToggleFavourite}
            rideLabel={routeLabel}
          />
        </div>

        <div className="search-ride-facts">
          <span><IconCalendar size={14} aria-hidden="true" />{formatDeparture(ride)}</span>
          <span><IconUsers size={14} aria-hidden="true" />{ride.seatsAvailable} seat{ride.seatsAvailable === 1 ? '' : 's'} left</span>
          <span className={`search-scale ${ride.journeyScale?.toLowerCase()}`}>{ride.journeyScale}</span>
        </div>

        {ride.estimatedArrivalAt && (
          <p className="search-arrival"><span>Estimated arrival</span><strong>{formatArrival(ride.estimatedArrivalAt)}</strong></p>
        )}

        {proximityLabel && Number.isFinite(Number(ride.proximityDistanceKm)) && (
          <p className="search-proximity-match">
            <IconMapPin size={14} aria-hidden="true" />
            Destination {Number(ride.proximityDistanceKm).toFixed(1)} km from {proximityLabel}.
          </p>
        )}

        {(vehicleLabel || languageLabels.length > 0) && (
          <div className="search-compatibility-row" aria-label="Vehicle and spoken languages">
            {vehicleLabel && <span>{vehicleLabel}</span>}
            {languageLabels.map((language) => <span key={language}>{language}</span>)}
          </div>
        )}

        {ride.restrictionTags?.length > 0 && (
          <div className="search-tag-row" aria-label="Ride preferences">
            {ride.restrictionTags.map((tag) => <span key={tag}>{tag}</span>)}
          </div>
        )}

        <Link className="search-host-row search-host-profile-link" to={`/users/${ride.host?.id || ride.hostId}`}>
          <span className="search-host-avatar" style={ride.host?.profilePhotoUrl ? { backgroundImage: `url(${ride.host.profilePhotoUrl})` } : undefined}>
            {!ride.host?.profilePhotoUrl && initials(ride.host?.fullName)}
          </span>
          <span className="search-host-copy">
            <strong>{ride.host?.fullName || 'Host'}</strong>
            <small>
              {ride.host?.rating != null && <><IconStar size={11} aria-hidden="true" /> {Number(ride.host.rating).toFixed(1)} · </>}
              Impact {impact}
            </small>
          </span>
          {tier && <span className="search-tier"><IconMedal size={12} aria-hidden="true" />{tier.replace(' Host', '')}</span>}
        </Link>
      </div>

      <footer className="search-ride-card-footer">
        <span>{ride.contribution || 'No contribution needed'}</span>
        {unavailable ? (
          <button type="button" onClick={onFindSimilar}>Find similar <IconArrowRight size={14} aria-hidden="true" /></button>
        ) : (
          <button type="button" onClick={onView}>View details <IconArrowRight size={14} aria-hidden="true" /></button>
        )}
      </footer>
    </article>
  );
}
