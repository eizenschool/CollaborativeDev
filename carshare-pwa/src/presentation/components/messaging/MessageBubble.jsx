import { useState } from 'react';
import {
  IconAlertTriangle,
  IconCheck,
  IconMapPin,
  IconPlay,
} from '../icons';
import {
  CURRENT_USER_ID,
  MESSAGE_TYPE,
} from '../../../data-access/mockMessageData';

function MessageStatus({ message }) {
  if (message.senderId !== CURRENT_USER_ID) {
    return null;
  }

  return (
    <span
      className={`message-read-status ${
        message.isRead ? 'message-read-status-read' : ''
      }`}
      aria-label={message.isRead ? 'Read' : 'Sent'}
    >
      <IconCheck size={11} />

      {message.isRead && (
        <span className="message-read-status-second-check">
          <IconCheck size={11} />
        </span>
      )}
    </span>
  );
}

function SystemMessage({ message }) {
  return (
    <div className="message-system-row">
      <span className="message-system-text">{message.text}</span>
    </div>
  );
}

function DeletedMessage({ isCurrentUser }) {
  return (
    <div
      className={`message-deleted-row ${
        isCurrentUser ? 'message-deleted-row-current-user' : ''
      }`}
    >
      <span className="message-deleted-text">
        This message was deleted
      </span>
    </div>
  );
}

function HazardMessage({ message }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const severityClass = message.hazard.severity
    .toLowerCase()
    .replaceAll(' ', '-');

  function handleToggleDetails() {
    setIsExpanded((currentValue) => !currentValue);
  }

  return (
    <div className="message-hazard-row">
      <article className="message-hazard-card">
        <header className="message-hazard-header">
          <span className="message-hazard-icon">
            <IconAlertTriangle size={17} />
          </span>

          <span className="message-hazard-heading">
            Road Hazard Advisory
          </span>

          <span
            className={`message-hazard-severity message-hazard-severity-${severityClass}`}
          >
            {message.hazard.severity}
          </span>
        </header>

        <div className="message-hazard-content">
          <h4 className="message-hazard-title">
            {message.hazard.title}
          </h4>

          <div className="message-hazard-location">
            <IconMapPin size={13} />
            <span>{message.hazard.location}</span>
          </div>

          <p className="message-hazard-time">
            Reported at {message.hazard.reportedTime}
          </p>

          {isExpanded && (
            <p className="message-hazard-detail">
              {message.hazard.detail}
            </p>
          )}

          <button
            type="button"
            className="message-hazard-toggle"
            onClick={handleToggleDetails}
          >
            {isExpanded ? 'Show less' : 'View details'}
          </button>
        </div>
      </article>
    </div>
  );
}

function TextMessage({ message, isCurrentUser }) {
  return (
    <div
      className={`message-text-bubble ${
        isCurrentUser
          ? 'message-bubble-current-user'
          : 'message-bubble-other-user'
      }`}
    >
      <p>{message.text}</p>
    </div>
  );
}

function ImageMessage({ message, isCurrentUser }) {
  return (
    <div
      className={`message-media-bubble ${
        isCurrentUser
          ? 'message-media-current-user'
          : 'message-media-other-user'
      }`}
    >
      <img
        src={message.imageUrl}
        alt={message.text || 'Shared attachment'}
        className="message-media-image"
      />

      {message.text && (
        <p className="message-media-caption">{message.text}</p>
      )}
    </div>
  );
}

function VideoMessage({ message, isCurrentUser }) {
  return (
    <div
      className={`message-media-bubble ${
        isCurrentUser
          ? 'message-media-current-user'
          : 'message-media-other-user'
      }`}
    >
      <div className="message-video-preview">
        <img
          src={message.videoThumbnail}
          alt={message.text || 'Shared video'}
          className="message-media-image"
        />

        <button
          type="button"
          className="message-video-play"
          aria-label="Play video"
        >
          <IconPlay size={20} />
        </button>
      </div>

      {message.text && (
        <p className="message-media-caption">{message.text}</p>
      )}
    </div>
  );
}

function LocationMessage({ message }) {
  return (
    <button
      type="button"
      className="message-location-card"
      aria-label={`Open ${message.location.name} in maps`}
    >
      <div className="message-location-map">
        <span className="message-location-map-line message-location-map-line-one" />
        <span className="message-location-map-line message-location-map-line-two" />
        <span className="message-location-map-line message-location-map-line-three" />

        <span className="message-location-pin">
          <IconMapPin size={17} />
        </span>
      </div>

      <div className="message-location-content">
        <span className="message-location-name">
          {message.location.name}
        </span>

        <span className="message-location-action">
          Open location
        </span>
      </div>
    </button>
  );
}

function MessageContent({ message, isCurrentUser }) {
  switch (message.type) {
    case MESSAGE_TYPE.TEXT:
      return (
        <TextMessage
          message={message}
          isCurrentUser={isCurrentUser}
        />
      );

    case MESSAGE_TYPE.IMAGE:
      return (
        <ImageMessage
          message={message}
          isCurrentUser={isCurrentUser}
        />
      );

    case MESSAGE_TYPE.VIDEO:
      return (
        <VideoMessage
          message={message}
          isCurrentUser={isCurrentUser}
        />
      );

    case MESSAGE_TYPE.LOCATION:
      return <LocationMessage message={message} />;

    default:
      return null;
  }
}

export default function MessageBubble({
  message,
  onOpenMessageOptions,
}) {
  const isCurrentUser = message.senderId === CURRENT_USER_ID;

  if (message.type === MESSAGE_TYPE.SYSTEM) {
    return <SystemMessage message={message} />;
  }

  if (
    message.type === MESSAGE_TYPE.HAZARD &&
    message.hazard
  ) {
    return <HazardMessage message={message} />;
  }

  if (message.isDeleted) {
    return (
      <DeletedMessage isCurrentUser={isCurrentUser} />
    );
  }

  function handleContextMenu(event) {
    event.preventDefault();

    if (onOpenMessageOptions) {
      onOpenMessageOptions(message);
    }
  }

  function handleOpenOptions() {
    if (onOpenMessageOptions) {
      onOpenMessageOptions(message);
    }
  }

  return (
    <div
      className={`message-bubble-row ${
        isCurrentUser
          ? 'message-bubble-row-current-user'
          : 'message-bubble-row-other-user'
      }`}
    >
      {!isCurrentUser && (
        <img
          src={message.senderAvatar}
          alt={message.senderName}
          className="message-bubble-avatar"
        />
      )}

      <div
        className={`message-bubble-column ${
          isCurrentUser
            ? 'message-bubble-column-current-user'
            : ''
        }`}
      >
        {!isCurrentUser && (
          <span className="message-bubble-sender">
            {message.senderName}
          </span>
        )}

        <button
          type="button"
          className="message-bubble-button"
          onClick={handleOpenOptions}
          onContextMenu={handleContextMenu}
          aria-label="Open message options"
        >
          <MessageContent
            message={message}
            isCurrentUser={isCurrentUser}
          />
        </button>

        <div
          className={`message-bubble-meta ${
            isCurrentUser
              ? 'message-bubble-meta-current-user'
              : ''
          }`}
        >
          <span>{message.timestamp}</span>

          {message.isEdited && (
            <span className="message-edited-label">edited</span>
          )}

          <MessageStatus message={message} />
        </div>
      </div>
    </div>
  );
}