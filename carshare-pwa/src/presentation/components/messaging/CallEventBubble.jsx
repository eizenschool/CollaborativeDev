import { useState } from 'react';
import { IconPhone } from '../icons.jsx';

function getInitials(name = 'Member') {
  return name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase();
}

function CallSenderAvatar({ participant }) {
  const [failedUrl, setFailedUrl] = useState(null);
  if (participant?.avatarUrl && failedUrl !== participant.avatarUrl) {
    return (
      <img
        className="message-bubble-avatar message-call-event-avatar"
        src={participant.avatarUrl}
        alt={participant.name}
        referrerPolicy="no-referrer"
        onError={() => setFailedUrl(participant.avatarUrl)}
      />
    );
  }
  return (
    <span className="message-bubble-avatar message-call-event-avatar message-avatar-fallback" aria-label={`${participant?.name || 'Member'} avatar`}>
      {getInitials(participant?.name)}
    </span>
  );
}

function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds)) return null;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatTime(timestamp) {
  if (!timestamp) return '';
  return new Intl.DateTimeFormat('en-MY', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kuala_Lumpur',
  }).format(new Date(timestamp));
}

function callResult(status) {
  return {
    ringing: 'Ringing',
    accepted: 'Ongoing',
    ended: 'Ended',
    missed: 'Missed',
    declined: 'Declined',
    cancelled: 'Cancelled',
    failed: 'Failed',
    left: 'Left',
  }[status] || 'Call';
}

export default function CallEventBubble({ call }) {
  const duration = formatDuration(call.durationSeconds);
  const failed = ['missed', 'failed', 'declined'].includes(call.status);
  const isOutgoing = call.direction === 'outgoing';
  const directionLabel = call.isGroup
    ? (isOutgoing ? 'Started group call' : 'Group call')
    : (call.direction === 'incoming' ? 'Incoming' : 'Outgoing');
  const sender = call.caller || (isOutgoing
    ? { id: call.callerId, name: 'You', avatarUrl: null }
    : call.otherParticipant);

  return (
    <div
      id={`call-${call.id}`}
      className={`message-call-event-row ${isOutgoing ? 'message-call-event-row-current-user' : 'message-call-event-row-other-user'} ${failed ? 'message-call-event-alert' : ''}`}
      aria-label={`${call.label}. ${directionLabel}, ${callResult(call.status)}, ${formatTime(call.createdAt)}${duration ? `, duration ${duration}` : ''}`}
    >
      <CallSenderAvatar participant={sender} />
      <div className={`message-call-event-column ${isOutgoing ? 'message-call-event-column-current-user' : ''}`}>
        {!isOutgoing && <span className="message-bubble-sender">{sender?.name || 'Member'}</span>}
        <article className="message-call-event">
          <div className="message-call-event-icon"><IconPhone size={17} aria-hidden="true" /></div>
          <div className="message-call-event-copy">
            <strong>{call.label}</strong>
            <small>{directionLabel} · {callResult(call.status)}</small>
          </div>
          {duration && <span className="message-call-event-duration">{duration}</span>}
        </article>
        <div className={`message-bubble-meta ${isOutgoing ? 'message-bubble-meta-current-user' : ''}`}>
          <span>{formatTime(call.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}
