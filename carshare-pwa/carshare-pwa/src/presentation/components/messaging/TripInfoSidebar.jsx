import {
  IconCalendar,
  IconMapPin,
  IconUsers,
} from '../icons';

function getInitials(name) {
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
    <span className="message-trip-member-avatar message-avatar-fallback">
      {getInitials(member.name)}
    </span>
  );
}

function TripSummaryCard({ conversation }) {
  if (!conversation.tripRoute) {
    return null;
  }

  return (
    <section className="message-trip-summary-card">
      <div className="message-trip-summary-icon">
        <IconMapPin size={18} />
      </div>

      <div className="message-trip-summary-content">
        <span className="message-trip-summary-label">Trip route</span>

        <h4 className="message-trip-summary-route">
          {conversation.tripRoute}
        </h4>
      </div>

      <div className="message-trip-summary-details">
        {conversation.tripDate && (
          <div className="message-trip-summary-detail">
            <IconCalendar size={15} />

            <div>
              <span className="message-trip-summary-detail-label">Date</span>

              <span className="message-trip-summary-detail-value">
                {conversation.tripDate}
              </span>
            </div>
          </div>
        )}

        {conversation.tripTime && (
          <div className="message-trip-summary-time-row">
            <span className="message-trip-summary-time-label">Departure</span>

            <span className="message-trip-summary-time-value">
              {conversation.tripTime}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

function ParticipantList({ conversation, currentUserId }) {
  const participantHeading =
    conversation.type === 'group'
      ? `Members (${conversation.members.length})`
      : 'Participant';

  return (
    <section className="message-trip-members-card">
      <header className="message-trip-card-heading">
        <span className="message-trip-card-heading-icon">
          <IconUsers size={16} />
        </span>

        <h4>{participantHeading}</h4>
      </header>

      <div className="message-trip-member-list">
        {conversation.members.map((member) => {
          const isCurrentUser = member.id === currentUserId;

          return (
            <div key={member.id} className="message-trip-member-row">
              <ParticipantAvatar member={member} />

              <div className="message-trip-member-content">
                <span className="message-trip-member-name">{member.name}</span>

                <span className="message-trip-member-role">
                  {isCurrentUser
                    ? 'You'
                    : conversation.type === 'group'
                      ? 'Trip member'
                      : 'Ride contact'}
                </span>
              </div>

              {isCurrentUser && (
                <span className="message-trip-member-you-badge">You</span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function EmptyTripInfo() {
  return (
    <div className="message-trip-sidebar-empty">
      <div className="message-trip-sidebar-empty-icon">
        <IconMapPin size={24} />
      </div>

      <h3>No conversation selected</h3>

      <p>Select a conversation to view trip and participant information.</p>
    </div>
  );
}

export default function TripInfoSidebar({ conversation, currentUserId }) {
  if (!conversation) {
    return <EmptyTripInfo />;
  }

  const sidebarTitle =
    conversation.type === 'group'
      ? 'Trip Information'
      : 'Contact Information';

  return (
    <aside className="message-trip-sidebar" aria-label={sidebarTitle}>
      <header className="message-trip-sidebar-header">
        <span className="message-trip-sidebar-eyebrow">
          Conversation details
        </span>

        <h2>{sidebarTitle}</h2>
      </header>

      <div className="message-trip-sidebar-scroll">
        <TripSummaryCard conversation={conversation} />

        <ParticipantList
          conversation={conversation}
          currentUserId={currentUserId}
        />
      </div>
    </aside>
  );
}
