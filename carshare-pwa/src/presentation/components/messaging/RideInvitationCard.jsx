import { Link } from 'react-router-dom';
import { IconCar, IconClock, IconRoute, IconUsers } from '../icons.jsx';

function formatDeparture(value) {
  if (!value) return 'Schedule unavailable';
  return new Intl.DateTimeFormat('en-MY', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kuala_Lumpur',
  }).format(new Date(value));
}

function availabilityLabel(invitation) {
  if (invitation.requestStatus === 'Accepted') return 'Already joined';
  if (invitation.requestStatus === 'Pending') return 'Request pending';
  if (invitation.requestStatus === 'Rejected') return 'Request rejected';
  if (invitation.rideStatus !== 'Published') return invitation.rideStatus || 'Unavailable';
  if (invitation.seatsAvailable < 1) return 'Full';
  return invitation.canRequest ? 'Open for requests' : 'Requests unavailable';
}

export default function RideInvitationCard({ invitation, draft = false }) {
  if (!invitation) return null;
  const route = [invitation.pickup, invitation.destination].filter(Boolean);
  return (
    <article className={`message-ride-invitation-card ${draft ? 'message-ride-invitation-card-draft' : ''}`}>
      <header>
        <span className="message-ride-invitation-icon"><IconCar size={18} /></span>
        <div><small>RIDE INVITATION</small><strong>{route.join(' → ') || 'Ride unavailable'}</strong></div>
        <span className={`message-ride-invitation-status ${invitation.canRequest ? 'is-open' : ''}`}>
          {availabilityLabel(invitation)}
        </span>
      </header>
      <div className="message-ride-invitation-meta">
        <span><IconClock size={14} /> {formatDeparture(invitation.departureAt)}</span>
        <span><IconUsers size={14} /> {invitation.seatsAvailable} seat{invitation.seatsAvailable === 1 ? '' : 's'} left</span>
        {invitation.contribution && <span><IconRoute size={14} /> {invitation.contribution}</span>}
      </div>
      {!draft && invitation.rideId && (
        <Link className="message-ride-invitation-action" to={`/ride/${invitation.rideId}`}>
          View Ride
        </Link>
      )}
    </article>
  );
}
