import { useMemo, useState } from 'react';
import {
  IconMessage,
  IconSearch,
  IconUsers,
  IconX,
} from '../icons';

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
    return (
      <img src={member.avatarUrl} alt={member.name} className={className} />
    );
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
      <div
        className="message-conversation-group-avatar"
        aria-label={`${conversation.title} group`}
      >
        {visibleMembers.map((member, index) => (
          <MemberAvatar
            key={member.id}
            member={member}
            className={`message-conversation-group-image message-conversation-group-image-${index + 1}`}
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
      className="message-conversation-avatar"
    />
  );
}

function ConversationRow({
  conversation,
  currentUserId,
  isSelected,
  onSelect,
}) {
  return (
    <button
      type="button"
      className={`message-conversation-row ${
        isSelected ? 'message-conversation-row-selected' : ''
      }`}
      onClick={() => onSelect(conversation.id)}
    >
      <ConversationAvatar
        conversation={conversation}
        currentUserId={currentUserId}
      />

      <div className="message-conversation-content">
        <div className="message-conversation-heading">
          <span className="message-conversation-title">
            {conversation.title}
          </span>

          <span
            className={`message-conversation-time ${
              conversation.unreadCount > 0
                ? 'message-conversation-time-unread'
                : ''
            }`}
          >
            {conversation.lastTime}
          </span>
        </div>

        <div className="message-conversation-preview-row">
          <span className="message-conversation-preview">
            {conversation.lastMessage}
          </span>

          {conversation.unreadCount > 0 && (
            <span
              className="message-unread-badge"
              aria-label={`${conversation.unreadCount} unread messages`}
            >
              {conversation.unreadCount}
            </span>
          )}
        </div>

        {conversation.type === 'group' && (
          <span className="message-trip-badge">Group chat</span>
        )}
      </div>
    </button>
  );
}

function EmptyConversationState({ hasSearchQuery, searchQuery }) {
  return (
    <div className="message-conversation-empty">
      <div className="message-conversation-empty-icon">
        {hasSearchQuery ? <IconSearch size={28} /> : <IconUsers size={28} />}
      </div>

      <h3 className="message-conversation-empty-title">
        {hasSearchQuery
          ? `No results for "${searchQuery}"`
          : 'No conversations yet'}
      </h3>

      <p className="message-conversation-empty-text">
        {hasSearchQuery
          ? 'Try searching with another name or message.'
          : 'Join or accept a ride to start chatting.'}
      </p>
    </div>
  );
}

export default function ConversationList({
  conversations,
  currentUserId,
  selectedConversationId,
  onSelectConversation,
  isLoading,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();

  const filteredConversations = useMemo(() => {
    if (!normalizedSearchQuery) {
      return conversations;
    }

    return conversations.filter((conversation) => {
      return (
        conversation.title.toLowerCase().includes(normalizedSearchQuery) ||
        conversation.lastMessage
          .toLowerCase()
          .includes(normalizedSearchQuery)
      );
    });
  }, [conversations, normalizedSearchQuery]);

  return (
    <section className="message-conversation-list" aria-label="Conversations">
      <header className="message-conversation-list-header">
        <div className="message-conversation-title-row">
          <div className="message-conversation-page-icon">
            <IconMessage size={18} />
          </div>

          <div>
            <h1 className="message-conversation-page-title">Messages</h1>

            <p className="message-conversation-page-subtitle">
              Your ride and trip conversations
            </p>
          </div>
        </div>

        <div className="message-conversation-search">
          <span className="message-conversation-search-icon">
            <IconSearch size={16} />
          </span>

          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search conversations..."
            aria-label="Search conversations"
          />

          {searchQuery && (
            <button
              type="button"
              className="message-conversation-search-clear"
              onClick={() => setSearchQuery('')}
              aria-label="Clear conversation search"
            >
              <IconX size={14} />
            </button>
          )}
        </div>
      </header>

      <div className="message-conversation-scroll" aria-busy={isLoading}>
        {filteredConversations.length > 0 ? (
          filteredConversations.map((conversation) => (
            <ConversationRow
              key={conversation.id}
              conversation={conversation}
              currentUserId={currentUserId}
              isSelected={selectedConversationId === conversation.id}
              onSelect={onSelectConversation}
            />
          ))
        ) : !isLoading ? (
          <EmptyConversationState
            hasSearchQuery={Boolean(normalizedSearchQuery)}
            searchQuery={searchQuery}
          />
        ) : null}
      </div>
    </section>
  );
}
