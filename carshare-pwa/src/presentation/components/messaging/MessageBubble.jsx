import { IconCheck, IconEdit, IconMoreVertical, IconTrash } from '../icons.jsx';
import GoogleLocationMap from '../maps/GoogleLocationMap.jsx';

function getInitials(name = 'Member') {
  return name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase();
}

function SenderAvatar({ message }) {
  if (message.senderAvatar) {
    return <img src={message.senderAvatar} alt={message.senderName} className="message-bubble-avatar" />;
  }
  return (
    <span className="message-bubble-avatar message-avatar-fallback">
      {getInitials(message.senderName)}
    </span>
  );
}

function MediaAttachment({ attachment }) {
  if (attachment.kind === 'image') {
    return (
      <a href={attachment.url || undefined} target="_blank" rel="noreferrer" className="message-media-item">
        <img src={attachment.url || ''} alt={attachment.fileName || 'Shared photo'} loading="lazy" />
      </a>
    );
  }
  return (
    <div className="message-media-item message-media-video">
      {attachment.url ? (
        <video controls preload="metadata">
          <source src={attachment.url} type={attachment.mimeType} />
        </video>
      ) : null}
      <a href={attachment.url || undefined} target="_blank" rel="noreferrer" download={attachment.fileName || undefined}>
        Open or download {attachment.fileName || 'video'}
      </a>
    </div>
  );
}

function MessageActions({ message, onEdit, onDelete }) {
  if (!message.canEdit && !message.canDelete) return null;
  return (
    <details className="message-bubble-actions">
      <summary aria-label="Message actions"><IconMoreVertical size={16} /></summary>
      <div>
        {message.canEdit && <button type="button" onClick={() => onEdit(message)}><IconEdit size={14} /> Edit</button>}
        {message.canDelete && <button type="button" className="danger" onClick={() => onDelete(message)}><IconTrash size={14} /> Delete</button>}
      </div>
    </details>
  );
}

export default function MessageBubble({
  message,
  currentUserId,
  onEdit = () => {},
  onDelete = () => {},
  highlighted = false,
}) {
  if (message.kind === 'system') {
    return (
      <div id={`message-${message.id}`} className={`message-system-row ${highlighted ? 'message-highlighted' : ''}`}>
        <span className="message-system-text">{message.text}</span>
      </div>
    );
  }

  const isCurrentUser = message.senderId === currentUserId;
  if (message.deletedAt) {
    return (
      <div id={`message-${message.id}`} className={`message-deleted-row ${isCurrentUser ? 'message-deleted-row-current-user' : ''} ${highlighted ? 'message-highlighted' : ''}`}>
        <span className="message-deleted-text">message deleted</span>
      </div>
    );
  }

  const media = message.attachments.filter((attachment) => ['image', 'video'].includes(attachment.kind));
  const location = message.attachments.find((attachment) => attachment.kind === 'location');

  return (
    <div
      id={`message-${message.id}`}
      className={`message-bubble-row ${isCurrentUser ? 'message-bubble-row-current-user' : 'message-bubble-row-other-user'} ${highlighted ? 'message-highlighted' : ''}`}
    >
      {!isCurrentUser && <SenderAvatar message={message} />}
      <div className={`message-bubble-column ${isCurrentUser ? 'message-bubble-column-current-user' : ''}`}>
        {!isCurrentUser && <span className="message-bubble-sender">{message.senderName}</span>}
        <div className="message-composite-bubble-wrap">
          {message.text && (
            <div className={`message-text-bubble ${isCurrentUser ? 'message-bubble-current-user' : 'message-bubble-other-user'}`}>
              <p>{message.text}</p>
            </div>
          )}
          {media.length > 0 && (
            <div className={`message-media-grid message-media-count-${Math.min(media.length, 4)}`}>
              {media.map((attachment) => <MediaAttachment key={attachment.id} attachment={attachment} />)}
            </div>
          )}
          {location && <GoogleLocationMap latitude={location.latitude} longitude={location.longitude} compact />}
        </div>
        <div className={`message-bubble-meta ${isCurrentUser ? 'message-bubble-meta-current-user' : ''}`}>
          <span>{message.timestamp}</span>
          {message.editedAt && <span className="message-edited-label">edited</span>}
          {isCurrentUser && (
            <span className={message.isRead ? 'message-read-status message-read-status-read' : 'message-read-status'} aria-label={message.isRead ? 'Read' : 'Sent'}>
              <IconCheck size={11} />
              {message.isRead && <span className="message-read-status-second-check"><IconCheck size={11} /></span>}
            </span>
          )}
          <MessageActions message={message} onEdit={onEdit} onDelete={onDelete} />
        </div>
      </div>
    </div>
  );
}
