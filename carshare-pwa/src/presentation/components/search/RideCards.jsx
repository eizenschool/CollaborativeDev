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
  IconClock,
  IconHeart,
  IconMapPin,
  IconMedal,
  IconRoute,
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

function formatWait(minutes) {
  const hours = Math.floor(Number(minutes) / 60);
  const remainder = Number(minutes) % 60;
  if (!hours) return `${remainder} min`;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
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

export function MultiLegJourneyCard({ journey, proximityLabel = '', onView }) {
  return (
    <article className="search-ride-card search-multileg-card">
      <div className="search-ride-card-body">
        <div className="search-multileg-heading">
          <span><IconRoute size={16} aria-hidden="true" />Two-leg alternative</span>
          <small>{journey.legs.length} rides</small>
        </div>
        <div className="search-route" aria-label={`${journey.pickup} to ${journey.destination}`}>
          <span><IconMapPin size={15} aria-hidden="true" /><strong>{journey.pickup}</strong></span>
          <i aria-hidden="true" />
          <span className="destination"><IconMapPin size={15} aria-hidden="true" /><strong>{journey.destination}</strong></span>
        </div>

        <div className="search-ride-facts">
          <span><IconCalendar size={14} aria-hidden="true" />{formatDeparture(journey)}</span>
          <span><IconUsers size={14} aria-hidden="true" />{journey.seatsAvailable} seat{journey.seatsAvailable === 1 ? '' : 's'} across both</span>
          <span className={`search-scale ${journey.journeyScale?.toLowerCase()}`}>{journey.journeyScale}</span>
        </div>

        <div className="search-transfer-summary">
          <IconClock size={16} aria-hidden="true" />
          <span><small>Transfer at</small><strong>{journey.transferPoint.name}</strong></span>
          <b>{formatWait(journey.waitMinutes)} wait</b>
        </div>

        <p className="search-arrival"><span>Final estimated arrival</span><strong>{formatArrival(journey.estimatedArrivalAt)}</strong></p>
        {proximityLabel && Number.isFinite(Number(journey.proximityDistanceKm)) && (
          <p className="search-proximity-match">
            <IconMapPin size={14} aria-hidden="true" />
            Final destination {Number(journey.proximityDistanceKm).toFixed(1)} km from {proximityLabel}.
          </p>
        )}
      </div>
      <footer className="search-ride-card-footer">
        <span>Book each leg separately</span>
        <button type="button" onClick={onView}>View itinerary <IconArrowRight size={14} aria-hidden="true" /></button>
      </footer>
    </article>
  );
}

export function MultiLegItinerary({ journey, onViewLeg }) {
  if (!journey) return null;
  return (
    <div className="search-itinerary">
      <div className="search-itinerary-summary">
        <span><IconMapPin size={16} aria-hidden="true" />{journey.pickup}</span>
        <i aria-hidden="true" />
        <span><IconMapPin size={16} aria-hidden="true" />{journey.destination}</span>
      </div>

      {journey.legs.map((leg, index) => (
        <div key={leg.id}>
          <article className="search-itinerary-leg">
            <header><span>Leg {index + 1}</span><strong>{leg.pickup} → {leg.destination}</strong></header>
            <dl>
              <div><dt>Departure</dt><dd>{formatDeparture(leg)}</dd></div>
              <div><dt>Estimated arrival</dt><dd>{formatArrival(leg.estimatedArrivalAt)}</dd></div>
              <div><dt>Host</dt><dd>{leg.host?.fullName || 'Host'}{leg.host?.rating != null ? ` · ${Number(leg.host.rating).toFixed(1)}★` : ''}</dd></div>
              <div><dt>Seats</dt><dd>{leg.seatsAvailable} available</dd></div>
              <div><dt>Contribution</dt><dd>{leg.contribution || 'None requested'}</dd></div>
              <div><dt>Requirements</dt><dd>{leg.restrictionTags?.join(', ') || 'None listed'}</dd></div>
            </dl>
            <button type="button" onClick={() => onViewLeg(leg)}>View leg {index + 1} details <IconArrowRight size={14} aria-hidden="true" /></button>
          </article>
          {index === 0 && (
            <div className="search-itinerary-transfer" role="note">
              <IconClock size={18} aria-hidden="true" />
              <span><strong>Transfer at {journey.transferPoint.name}</strong><small>Change rides here. You have {formatWait(journey.waitMinutes)} between the first ETA and the next departure.</small></span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
