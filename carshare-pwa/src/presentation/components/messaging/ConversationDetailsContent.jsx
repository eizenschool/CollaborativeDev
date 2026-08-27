import {
  IconCalendar,
  IconMapPin,
  IconUsers,
} from '../icons.jsx';

function getInitials(name = 'Member') {
  return name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function ParticipantAvatar({ member }) {
  if (member.avatarUrl) {
    return (
      <img
        src={member.avatarUrl}
        alt={member.name}
        className="message-trip-member-avatar"
      />
    );
  }

  return (
    <span className="message-trip-member-avatar message-avatar-fallback" aria-hidden="true">
      {getInitials(member.name)}
    </span>
  );
}

function routePoints(conversation) {
  if (conversation.pickup || conversation.destination) {
    return [conversation.pickup, conversation.destination].filter(Boolean);
  }
  return (conversation.tripRoute || '').split(/\s+(?:to|→)\s+/i).filter(Boolean);
}

function TripSummaryCard({ conversation }) {
  const points = routePoints(conversation);

  return (
    <section className="message-trip-summary-card" aria-label="Trip summary">
      <div className="message-trip-summary-topline">
        <div className="message-trip-summary-icon">
          <IconMapPin size={18} aria-hidden="true" />
        </div>
        <span className="message-trip-status-badge">
          <span className="message-status-dot" aria-hidden="true" />
          {conversation.rideStatus || 'Ride chat'}{conversation.isArchived ? ' · Archived' : ''}
        </span>
      </div>

      <div className="message-trip-summary-content">
        <span className="message-trip-summary-label">Trip route</span>
        {points.length === 2 ? (
          <div className="message-trip-route-points">
            <div><span className="message-route-marker message-route-marker-start" /><strong>{points[0]}</strong></div>
            <span className="message-route-line" aria-hidden="true" />
            <div><span className="message-route-marker message-route-marker-end" /><strong>{points[1]}</strong></div>
          </div>
        ) : (
          <h4 className="message-trip-summary-route">{points[0] || 'Route information unavailable'}</h4>
        )}
      </div>

      {(conversation.tripDate || conversation.tripTime) && (
        <div className="message-trip-summary-details">
          {conversation.tripDate && (
            <div className="message-trip-summary-detail">
              <IconCalendar size={15} aria-hidden="true" />
              <div>
                <span className="message-trip-summary-detail-label">Date</span>
                <span className="message-trip-summary-detail-value">{conversation.tripDate}</span>
              </div>
            </div>
          )}
          {conversation.tripTime && (
            <div className="message-trip-summary-time-row">
              <span className="message-trip-summary-time-label">Departure</span>
              <span className="message-trip-summary-time-value">{conversation.tripTime}</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function ParticipantList({ conversation, currentUserId }) {
  const heading = conversation.type === 'group'
    ? `Members (${conversation.members.length})`
    : 'Participant';

  return (
    <section className="message-trip-members-card">
      <header className="message-trip-card-heading">
        <span className="message-trip-card-heading-icon"><IconUsers size={16} aria-hidden="true" /></span>
        <h4>{heading}</h4>
      </header>
      <div className="message-trip-member-list">
        {conversation.members.map((member) => (
          <div key={member.id} className="message-trip-member-row">
            <ParticipantAvatar member={member} />
            <div className="message-trip-member-content">
              <span className="message-trip-member-name">{member.name}</span>
              <span className="message-trip-member-role">
                {member.role === 'host' ? 'Host' : member.role === 'traveller' ? 'Traveller' : 'Ride contact'}
              </span>
            </div>
            {member.id === currentUserId && <span className="message-trip-member-you-badge">You</span>}
          </div>
        ))}
      </div>
    </section>
  );
}

export default function ConversationDetailsContent({ conversation, currentUserId }) {
  const title = conversation.type === 'group' ? 'Trip Information' : 'Contact Information';

  return (
    <div className="message-conversation-details">
      <div className="message-conversation-details-heading">
        <span>Conversation details</span>
        <h3>{title}</h3>
      </div>
      <TripSummaryCard conversation={conversation} />
      <ParticipantList conversation={conversation} currentUserId={currentUserId} />
    </div>
  );
}
