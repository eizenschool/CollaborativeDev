import { useEffect, useRef, useState } from 'react';
import {
  IconArchive,
  IconArrowLeft,
  IconCamera,
  IconMapPin,
  IconMessage,
  IconMoreVertical,
  IconPaperclip,
  IconSearch,
  IconSend,
  IconSmile,
  IconTrash,
  IconX,
} from '../icons';
import {
  CONVERSATION_TYPE,
  CURRENT_USER,
  CURRENT_USER_ID,
  MESSAGE_TYPE,
  fetchConversationById,
  fetchMessagesByConversationId,
} from '../../../data-access/mockMessageData';
import MessageBubble from './MessageBubble';

function ConversationAvatar({ conversation }) {
  if (conversation.type === CONVERSATION_TYPE.GROUP) {
    const visibleMembers = conversation.members
      .filter((member) => member.id !== CURRENT_USER_ID)
      .slice(0, 2);

    return (
      <div className="message-chat-group-avatar">
        {visibleMembers.map((member, index) => (
          <img
            key={member.id}
            src={member.avatar}
            alt={member.name}
            className={`message-chat-group-image message-chat-group-image-${index + 1}`}
          />
        ))}
      </div>
    );
  }

  return (
    <img
      src={conversation.avatar}
      alt={conversation.title}
      className="message-chat-avatar"
    />
  );
}

function ChatEmptyState() {
  return (
    <div className="message-chat-empty">
      <div className="message-chat-empty-icon">
        <IconMessage size={28} />
      </div>

      <h3>No messages yet</h3>

      <p>Send a message to start this conversation.</p>
    </div>
  );
}

function ConversationMenu({
  conversation,
  onClose,
}) {
  const destructiveLabel =
    conversation.type === CONVERSATION_TYPE.GROUP
      ? 'Leave group'
      : 'Delete conversation';

  return (
    <div className="message-chat-menu">
      <button type="button" onClick={onClose}>
        <IconArchive size={15} />
        <span>Archive conversation</span>
      </button>

      <button
        type="button"
        className="message-chat-menu-danger"
        onClick={onClose}
      >
        <IconTrash size={15} />
        <span>{destructiveLabel}</span>
      </button>
    </div>
  );
}

function AttachmentMenu({
  onSendImage,
  onSendLocation,
  onClose,
}) {
  function handleSendDemoImage() {
    onSendImage();
    onClose();
  }

  function handleSendDemoLocation() {
    onSendLocation();
    onClose();
  }

  return (
    <div className="message-attachment-menu">
      <button
        type="button"
        onClick={handleSendDemoImage}
      >
        <span className="message-attachment-menu-icon">
          <IconCamera size={18} />
        </span>

        <span>
          <strong>Photo</strong>
          <small>Send a dummy photo</small>
        </span>
      </button>

      <button
        type="button"
        onClick={handleSendDemoLocation}
      >
        <span className="message-attachment-menu-icon">
          <IconMapPin size={18} />
        </span>

        <span>
          <strong>Location</strong>
          <small>Share a dummy location</small>
        </span>
      </button>
    </div>
  );
}

function MessageOptionsModal({
  message,
  onClose,
  onDelete,
}) {
  const canDelete = message.senderId === CURRENT_USER_ID;

  return (
    <div
      className="message-options-backdrop"
      onClick={onClose}
    >
      <div
        className="message-options-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="message-options-handle" />

        <header className="message-options-header">
          <div>
            <span>Message options</span>
            <p>
              {message.text
                ? message.text.slice(0, 70)
                : 'Shared attachment'}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close message options"
          >
            <IconX size={18} />
          </button>
        </header>

        {canDelete ? (
          <button
            type="button"
            className="message-options-delete"
            onClick={() => onDelete(message.id)}
          >
            <IconTrash size={17} />
            <span>Delete message</span>
          </button>
        ) : (
          <p className="message-options-note">
            Additional message actions will be connected later.
          </p>
        )}
      </div>
    </div>
  );
}

export default function ChatWindow({
  conversationId,
  onBack,
  isDesktop = false,
}) {
  const conversation =
    fetchConversationById(conversationId);

  const [messageList, setMessageList] = useState(() =>
    fetchMessagesByConversationId(conversationId),
  );
  const [messageInput, setMessageInput] = useState('');
  const [isConversationMenuOpen, setIsConversationMenuOpen] =
    useState(false);
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] =
    useState(false);
  const [selectedMessage, setSelectedMessage] = useState(null);

  const messageBottomRef = useRef(null);
  const messageInputRef = useRef(null);

  useEffect(() => {
    setMessageList(
      fetchMessagesByConversationId(conversationId),
    );
    setMessageInput('');
    setSelectedMessage(null);
  }, [conversationId]);

  useEffect(() => {
    messageBottomRef.current?.scrollIntoView({
      behavior: 'smooth',
    });
  }, [messageList]);

  if (!conversation) {
    return null;
  }

  function handleInputChange(event) {
    setMessageInput(event.target.value);
  }

  function handleInputKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSendMessage();
    }
  }

  function handleSendMessage() {
    const trimmedMessage = messageInput.trim();

    if (!trimmedMessage) {
      return;
    }

    const newMessage = {
      id: `message-${Date.now()}`,
      type: MESSAGE_TYPE.TEXT,
      senderId: CURRENT_USER_ID,
      senderName: CURRENT_USER.name,
      senderAvatar: CURRENT_USER.avatar,
      text: trimmedMessage,
      timestamp: 'Just now',
      isRead: false,
      isEdited: false,
      isDeleted: false,
    };

    setMessageList((currentMessages) => [
      ...currentMessages,
      newMessage,
    ]);
    setMessageInput('');
    messageInputRef.current?.focus();
  }

  function handleSendImage() {
    const newMessage = {
      id: `message-${Date.now()}`,
      type: MESSAGE_TYPE.IMAGE,
      senderId: CURRENT_USER_ID,
      senderName: CURRENT_USER.name,
      senderAvatar: CURRENT_USER.avatar,
      imageUrl:
        'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=600&h=400&fit=crop&auto=format',
      text: 'Sharing this trip photo.',
      timestamp: 'Just now',
      isRead: false,
      isEdited: false,
      isDeleted: false,
    };

    setMessageList((currentMessages) => [
      ...currentMessages,
      newMessage,
    ]);
  }

  function handleSendLocation() {
    const newMessage = {
      id: `message-${Date.now()}`,
      type: MESSAGE_TYPE.LOCATION,
      senderId: CURRENT_USER_ID,
      senderName: CURRENT_USER.name,
      senderAvatar: CURRENT_USER.avatar,
      timestamp: 'Just now',
      isRead: false,
      isEdited: false,
      isDeleted: false,
      location: {
        name: 'KLCC Basement Carpark, Gate B',
        latitude: 3.1579,
        longitude: 101.7116,
      },
    };

    setMessageList((currentMessages) => [
      ...currentMessages,
      newMessage,
    ]);
  }

  function handleToggleConversationMenu(event) {
    event.stopPropagation();

    setIsConversationMenuOpen(
      (currentValue) => !currentValue,
    );
    setIsAttachmentMenuOpen(false);
  }

  function handleToggleAttachmentMenu() {
    setIsAttachmentMenuOpen(
      (currentValue) => !currentValue,
    );
    setIsConversationMenuOpen(false);
  }

  function handleCloseMenus() {
    setIsConversationMenuOpen(false);
    setIsAttachmentMenuOpen(false);
  }

  function handleOpenMessageOptions(message) {
    setSelectedMessage(message);
  }

  function handleCloseMessageOptions() {
    setSelectedMessage(null);
  }

  function handleDeleteMessage(messageId) {
    setMessageList((currentMessages) =>
      currentMessages.map((message) =>
        message.id === messageId
          ? {
              ...message,
              isDeleted: true,
            }
          : message,
      ),
    );

    setSelectedMessage(null);
  }

  const memberDescription =
    conversation.type === CONVERSATION_TYPE.GROUP
      ? `${conversation.members.length} members`
      : 'Active recently';

  return (
    <section
      className="message-chat-window"
      onClick={handleCloseMenus}
      aria-label={`Conversation with ${conversation.title}`}
    >
      <header className="message-chat-header">
        {!isDesktop && (
          <button
            type="button"
            className="message-chat-header-button message-chat-back-button"
            onClick={onBack}
            aria-label="Back to conversations"
          >
            <IconArrowLeft size={17} />
          </button>
        )}

        <ConversationAvatar conversation={conversation} />

        <div className="message-chat-header-content">
          <div className="message-chat-header-title-row">
            <h2>{conversation.title}</h2>

            {conversation.tripBadge && (
              <span className="message-chat-header-badge">
                {conversation.tripBadge}
              </span>
            )}
          </div>

          <p>{memberDescription}</p>
        </div>

        <div className="message-chat-header-actions">
          <button
            type="button"
            className="message-chat-header-button"
            aria-label="Search this conversation"
          >
            <IconSearch size={17} />
          </button>

          <div className="message-chat-menu-wrap">
            <button
              type="button"
              className="message-chat-header-button"
              onClick={handleToggleConversationMenu}
              aria-label="Conversation options"
              aria-expanded={isConversationMenuOpen}
            >
              <IconMoreVertical size={18} />
            </button>

            {isConversationMenuOpen && (
              <ConversationMenu
                conversation={conversation}
                onClose={handleCloseMenus}
              />
            )}
          </div>
        </div>
      </header>

      <div className="message-chat-scroll">
        {messageList.length > 0 ? (
          messageList.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              onOpenMessageOptions={
                handleOpenMessageOptions
              }
            />
          ))
        ) : (
          <ChatEmptyState />
        )}

        <div ref={messageBottomRef} />
      </div>

      <footer className="message-composer">
        <div className="message-composer-inner">
          <div className="message-attachment-wrap">
            <button
              type="button"
              className={`message-composer-icon-button ${
                isAttachmentMenuOpen
                  ? 'message-composer-icon-button-active'
                  : ''
              }`}
              onClick={(event) => {
                event.stopPropagation();
                handleToggleAttachmentMenu();
              }}
              aria-label="Add attachment"
              aria-expanded={isAttachmentMenuOpen}
            >
              <IconPaperclip size={19} />
            </button>

            {isAttachmentMenuOpen && (
              <AttachmentMenu
                onSendImage={handleSendImage}
                onSendLocation={handleSendLocation}
                onClose={handleCloseMenus}
              />
            )}
          </div>

          <div className="message-composer-input-wrap">
            <textarea
              ref={messageInputRef}
              value={messageInput}
              onChange={handleInputChange}
              onKeyDown={handleInputKeyDown}
              rows="1"
              placeholder="Type a message..."
              aria-label="Message"
            />
          </div>

          <button
            type="button"
            className="message-composer-icon-button message-composer-smile"
            aria-label="Choose emoji"
          >
            <IconSmile size={19} />
          </button>

          <button
            type="button"
            className={`message-send-button ${
              messageInput.trim()
                ? 'message-send-button-active'
                : ''
            }`}
            onClick={handleSendMessage}
            disabled={!messageInput.trim()}
            aria-label="Send message"
          >
            <IconSend size={17} />
          </button>
        </div>
      </footer>

      {selectedMessage && (
        <MessageOptionsModal
          message={selectedMessage}
          onClose={handleCloseMessageOptions}
          onDelete={handleDeleteMessage}
        />
      )}
    </section>
  );
}