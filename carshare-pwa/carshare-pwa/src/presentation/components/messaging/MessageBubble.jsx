import { IconCheck } from '../icons';

function getInitials(name) {
  return name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function SenderAvatar({ message }) {
  if (message.senderAvatar) {
    return (
      <img
        src={message.senderAvatar}
        alt={message.senderName}
        className="message-bubble-avatar"
      />
    );
  }

  return (
    <span className="message-bubble-avatar message-avatar-fallback">
      {getInitials(message.senderName)}
    </span>
  );
}

export default function MessageBubble({ message, currentUserId }) {
  const isCurrentUser = message.senderId === currentUserId;

  return (
    <div
      className={`message-bubble-row ${
        isCurrentUser
          ? 'message-bubble-row-current-user'
          : 'message-bubble-row-other-user'
      }`}
    >
      {!isCurrentUser && <SenderAvatar message={message} />}

      <div
        className={`message-bubble-column ${
          isCurrentUser ? 'message-bubble-column-current-user' : ''
        }`}
      >
        {!isCurrentUser && (
          <span className="message-bubble-sender">
            {message.senderName}
          </span>
        )}

        <div
          className={`message-text-bubble ${
            isCurrentUser
              ? 'message-bubble-current-user'
              : 'message-bubble-other-user'
          }`}
        >
          <p>{message.text}</p>
        </div>

        <div
          className={`message-bubble-meta ${
            isCurrentUser ? 'message-bubble-meta-current-user' : ''
          }`}
        >
          <span>{message.timestamp}</span>

          {isCurrentUser && (
            <span className="message-read-status" aria-label="Sent">
              <IconCheck size={11} />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
