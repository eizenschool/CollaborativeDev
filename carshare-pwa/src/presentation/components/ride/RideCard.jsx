// ===== PRESENTATION LAYER (RideCard) =====
import { IconMapPin, IconCalendar, IconUsers, IconStar, IconMedal } from '../icons.jsx';
import { getBadgeForStats } from '../../../business-logic/HostImpactEngine.js';
import { formatJourneyCountdown } from '../../../business-logic/rideJourneyState.js';

// Bronze/Silver/Gold/Platinum pill colours - same tier names/thresholds as
// HostImpactEngine.badgeTiers, just a display-only colour map for this module.
const TIER_COLORS = {
  Bronze: { color: '#92400e', bg: '#fef3c7' },
  Silver: { color: '#6b7280', bg: '#f3f4f6' },
  Gold: { color: '#ca8a04', bg: '#fef9c3' },
  Platinum: { color: '#0f766e', bg: '#ccfbf1' }
};

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short' });
}

function initialsOf(name) {
  return (name || '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

function formatEta(value) {
  if (!value) return null;
  return new Date(value).toLocaleString(undefined, {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Kuala_Lumpur'
  });
}

export default function RideCard({ ride, statusChip, roleLabel, journeyState, compact = false, now = new Date(), onClick }) {
  const badge = ride.host ? getBadgeForStats(ride.host) : null;
  const tier = badge ? badge.name.replace(' Host', '') : null;
  const tierStyle = tier ? TIER_COLORS[tier] : null;

  const CardElement = onClick ? 'button' : 'article';

  return (
    <CardElement type={onClick ? 'button' : undefined} className={'ride-card' + (onClick ? ' ride-card-clickable' : '') + (compact ? ' ride-card-compact' : '')} onClick={onClick}>
      <div className="ride-card-top">
        <div className="ride-route">
          <div className="ride-route-line">
            <span className="pin pin-pickup"><IconMapPin size={13} /></span>
            <span className="ride-route-text">{ride.pickup}</span>
          </div>
          <div className="ride-route-line">
            <span className="ride-route-connector" />
            <span className="ride-route-text muted">{ride.destination}</span>
          </div>
        </div>
        <div className="ride-card-badges">
          {roleLabel && <span className="ride-role-badge">{roleLabel}</span>}
          <span className={'scale-badge ' + (ride.journeyScale === 'Intercity' ? 'scale-intercity' : 'scale-urban')}>{ride.journeyScale}</span>
        </div>
      </div>

      <div className="ride-meta-row">
        <span className="ride-meta"><IconCalendar size={13} /> {formatDate(ride.date)} · {ride.time}</span>
        {!['Completed', 'Cancelled', 'Expired'].includes(ride.status) && <span className="ride-seats"><IconUsers size={13} /> {ride.seatsAvailable} seat{ride.seatsAvailable === 1 ? '' : 's'} left</span>}
      </div>

      {journeyState && <div className={`ride-card-next urgency-${journeyState.urgency}`}><span>{compact ? journeyState.nextAction.label : journeyState.title}</span>{journeyState.countdownAt && <strong>{formatJourneyCountdown(journeyState.countdownAt, now, journeyState.countdownKind)}</strong>}</div>}

      {!compact && ride.estimatedArrivalAt && <p className="ride-card-eta"><span>Estimated arrival</span><strong>{formatEta(ride.estimatedArrivalAt)}</strong></p>}

      {!compact && ride.restrictionTags?.length > 0 && (
        <div className="chip-row">
          {ride.restrictionTags.map((tag) => (
            <span className="chip" key={tag}>{tag}</span>
          ))}
        </div>
      )}

      {compact ? <div className="ride-card-bottom ride-card-compact-bottom">{statusChip && <span className={'status-chip status-' + ride.status.toLowerCase().replace(' ', '-')}>{ride.status}</span>}</div> : <div className="ride-card-bottom">
        {ride.host && (
          <div className="ride-host">
            <div className="ride-host-avatar" style={ride.host.profilePhotoUrl ? { backgroundImage: `url(${ride.host.profilePhotoUrl})` } : undefined}>
              {!ride.host.profilePhotoUrl && initialsOf(ride.host.fullName)}
            </div>
            <span className="ride-host-name">{ride.host.fullName}</span>
            {ride.host.rating != null && (
              <span className="ride-host-rating"><IconStar size={11} /> {ride.host.rating.toFixed(1)}</span>
            )}
            {tier && (
              <span className="tier-pill" style={{ color: tierStyle.color, background: tierStyle.bg }}>
                <IconMedal size={10} /> {tier}
              </span>
            )}
          </div>
        )}
        {statusChip ? (
          <span className={'status-chip status-' + ride.status.toLowerCase().replace(' ', '-')}>{ride.status}</span>
        ) : (
          <span className="contribution-tag">{ride.contribution || 'No contribution needed'}</span>
        )}
      </div>}
    </CardElement>
  );
}
