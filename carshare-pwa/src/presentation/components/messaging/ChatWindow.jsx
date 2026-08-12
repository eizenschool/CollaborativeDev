import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IconArrowLeft,
  IconMessage,
  IconSend,
} from '../icons';
import { MessagingService } from '../../../business-logic/MessagingService.js';
import MessageBubble from './MessageBubble';

function getInitials(name) {
  return name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function MemberAvatar({ member, className }) {
  if (member.avatarUrl) {
    return <img src={member.avatarUrl} alt={member.name} className={className} />;
  }

  return (
    <span className={`${className} message-avatar-fallback`}>
      {getInitials(member.name)}
    </span>
  );
}

function ConversationAvatar({ conversation, currentUserId }) {
  if (conversation.type === 'group') {
    const visibleMembers = conversation.members
      .filter((member) => member.id !== currentUserId)
      .slice(0, 2);

    return (
      <div className="message-chat-group-avatar">
        {visibleMembers.map((member, index) => (
          <MemberAvatar
            key={member.id}
            member={member}
            className={`message-chat-group-image message-chat-group-image-${index + 1}`}
          />
        ))}
      </div>
    );
  }

  const contact = conversation.members.find(
    (member) => member.id !== currentUserId,
  );

  return (
    <MemberAvatar
      member={contact || { name: conversation.title, avatarUrl: null }}
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

export default function ChatWindow({
  conversationId,
  currentUser,
  dataVersion,
  onBack,
  isDesktop = false,
}) {
  const [conversation, setConversation] = useState(null);
  const [messageList, setMessageList] = useState([]);
  const [messageInput, setMessageInput] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messageBottomRef = useRef(null);
  const messageInputRef = useRef(null);

  const loadConversation = useCallback(async () => {
    if (!currentUser || !conversationId) {
      setConversation(null);
      setMessageList([]);
      return;
    }

    try {
      const [nextConversation, nextMessages] = await Promise.all([
        MessagingService.getConversation({
          conversationId,
          user: currentUser,
        }),
        MessagingService.listMessages({
          conversationId,
          user: currentUser,
        }),
      ]);

      setConversation(nextConversation);
      setMessageList(nextMessages);
      await MessagingService.markConversationRead({
        conversationId,
        user: currentUser,
      });
    } catch (error) {
      setConversation(null);
      setMessageList([]);
      setErrorMessage(
        error.message || 'Unable to load this conversation.',
      );
    }
  }, [conversationId, currentUser]);

  useEffect(() => {
    setMessageInput('');
    setErrorMessage('');
    loadConversation();
  }, [loadConversation, dataVersion]);

  useEffect(() => {
    messageBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messageList]);

  function handleInputKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSendMessage();
    }
  }

  async function handleSendMessage() {
    if (isSending) {
      return;
    }

    setErrorMessage('');
    setIsSending(true);

    try {
      await MessagingService.sendTextMessage({
        conversationId,
        sender: currentUser,
        text: messageInput,
      });
      setMessageInput('');
      messageInputRef.current?.focus();
      await loadConversation();
    } catch (error) {
      setErrorMessage(error.message || 'Unable to send message.');
    } finally {
      setIsSending(false);
    }
  }

  if (!conversation) {
    return (
      <section className="message-chat-window" aria-label="Conversation">
        <ChatEmptyState />
      </section>
    );
  }

  const memberDescription =
    conversation.type === 'group'
      ? `${conversation.members.length} members`
      : 'Private ride chat';

  return (
    <section
      className="message-chat-window"
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

        <ConversationAvatar
          conversation={conversation}
          currentUserId={currentUser.id}
        />

        <div className="message-chat-header-content">
          <div className="message-chat-header-title-row">
            <h2>{conversation.title}</h2>

            {conversation.type === 'group' && (
              <span className="message-chat-header-badge">Group chat</span>
            )}
          </div>

          <p>{memberDescription}</p>
        </div>
      </header>

      <div className="message-chat-scroll">
        {messageList.length > 0 ? (
          messageList.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              currentUserId={currentUser.id}
            />
          ))
        ) : (
          <ChatEmptyState />
        )}

        <div ref={messageBottomRef} />
      </div>

      <footer className="message-composer">
        <div className="message-composer-inner">
          <div className="message-composer-input-wrap">
            <textarea
              ref={messageInputRef}
              value={messageInput}
              onChange={(event) => setMessageInput(event.target.value)}
              onKeyDown={handleInputKeyDown}
              rows="1"
              maxLength="1000"
              placeholder="Type a message..."
              aria-label="Message"
              disabled={isSending}
            />
          </div>

          <button
            type="button"
            className={`message-send-button ${
              messageInput.trim() && !isSending
                ? 'message-send-button-active'
                : ''
            }`}
            onClick={handleSendMessage}
            disabled={!messageInput.trim() || isSending}
            aria-label="Send message"
          >
            <IconSend size={17} />
          </button>
        </div>

        {errorMessage && (
          <p className="message-composer-error" role="alert">
            {errorMessage}
          </p>
        )}
      </footer>
    </section>
  );
}
