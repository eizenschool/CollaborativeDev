import { useEffect, useState } from 'react';
import { IconCheck, IconEdit, IconMoreVertical, IconTrash } from '../icons.jsx';
import GoogleLocationMap from '../maps/GoogleLocationMap.jsx';
import MessageTranslation from './MessageTranslation.jsx';

function getInitials(name = 'Member') {
  return name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase();
}

function SenderAvatar({ message }) {
  const [failedUrl, setFailedUrl] = useState(null);
  if (message.senderAvatar && failedUrl !== message.senderAvatar) {
    return (
      <img
        src={message.senderAvatar}
        alt={message.senderName}
        className="message-bubble-avatar"
        referrerPolicy="no-referrer"
        onError={() => setFailedUrl(message.senderAvatar)}
      />
    );
  }
  return (
    <span className="message-bubble-avatar message-avatar-fallback">
      {getInitials(message.senderName)}
    </span>
  );
}

function formatDuration(totalSeconds = 0) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function MediaAttachment({ attachment }) {
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    setLoadFailed(false);
  }, [attachment.url]);

  if (!attachment.url) {
    const mediaLabel = attachment.kind === 'image'
      ? 'Photo'
      : attachment.kind === 'audio'
        ? 'Voice message'
        : 'Video';
    return (
      <div
        className="message-media-item message-media-unavailable"
        role="img"
        aria-label={`${mediaLabel} unavailable${attachment.fileName ? `: ${attachment.fileName}` : ''}`}
        title={attachment.loadError || `${mediaLabel} could not be loaded.`}
      >
        <span>{mediaLabel} unavailable</span>
        {attachment.fileName && <small>{attachment.fileName}</small>}
      </div>
    );
  }

  if (attachment.kind === 'audio' && loadFailed) {
    return (
      <div className="message-audio-attachment message-audio-unavailable" role="status">
        <span>Voice message cannot play in this browser.</span>
        <a href={attachment.url} target="_blank" rel="noreferrer" download={attachment.fileName || undefined}>
          Open or download voice message
        </a>
      </div>
    );
  }

  if (loadFailed) {
    const mediaLabel = attachment.kind === 'image' ? 'Photo' : 'Video';
    return (
      <div
        className="message-media-item message-media-unavailable"
        role="img"
        aria-label={`${mediaLabel} unavailable${attachment.fileName ? `: ${attachment.fileName}` : ''}`}
        title={attachment.loadError || `${mediaLabel} could not be loaded.`}
      >
        <span>{mediaLabel} unavailable</span>
        {attachment.fileName && <small>{attachment.fileName}</small>}
      </div>
    );
  }

  if (attachment.kind === 'image') {
    return (
      <a href={attachment.url} target="_blank" rel="noreferrer" className="message-media-item">
        <img
          src={attachment.url}
          alt={attachment.fileName || 'Shared photo'}
          loading="lazy"
          onError={() => setLoadFailed(true)}
        />
      </a>
    );
  }
  if (attachment.kind === 'audio') {
    return (
      <div className="message-audio-attachment">
        <audio
          controls
          preload="metadata"
          src={attachment.url}
          onError={() => setLoadFailed(true)}
          aria-label="Voice message"
        />
        <span>{formatDuration(attachment.durationSeconds)}</span>
      </div>
    );
  }
  return (
    <div className="message-media-item message-media-video">
      <video
        controls
        playsInline
        preload="metadata"
        src={attachment.url}
        onError={() => setLoadFailed(true)}
      />
      <a href={attachment.url} target="_blank" rel="noreferrer" download={attachment.fileName || undefined}>
        Open or download {attachment.fileName || 'video'}
      </a>
    </div>
  );
}

function MessageActions({ message, onEdit, onDelete }) {
  if (!message.canEdit && !message.canDelete) return null;
  return (
    <details className="message-bubble-actions">
      <summary aria-label="Message actions" title="Message actions"><IconMoreVertical size={18} /></summary>
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
  onTranslate = () => Promise.reject(new Error('Translation is unavailable.')),
  translationLanguage = '',
  onTranslationLanguageChange = () => {},
  highlighted = false,
}) {
  if (message.kind === 'system') {
    return (
      <div id={`message-${message.id}`} className={`message-system-row ${highlighted ? 'message-highlighted' : ''}`} role="status">
        <span className="message-system-text">{message.text}</span>
      </div>
    );
  }

  const isCurrentUser = message.senderId === currentUserId;
  if (message.deletedAt) {
    return (
      <div id={`message-${message.id}`} className={`message-deleted-row ${isCurrentUser ? 'message-deleted-row-current-user' : ''} ${highlighted ? 'message-highlighted' : ''}`}>
        <span className="message-deleted-text">Message deleted</span>
      </div>
    );
  }

  const media = message.attachments.filter((attachment) => ['image', 'video'].includes(attachment.kind));
  const audio = message.attachments.find((attachment) => attachment.kind === 'audio');
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
          {audio && <MediaAttachment attachment={audio} />}
          {location && <GoogleLocationMap latitude={location.latitude} longitude={location.longitude} compact />}
        </div>
        {(audio || message.text) && (
          <MessageTranslation
            message={message}
            targetLanguage={translationLanguage}
            onTargetLanguageChange={onTranslationLanguageChange}
            onTranslate={onTranslate}
            isVoiceMessage={Boolean(audio)}
          />
        )}
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
