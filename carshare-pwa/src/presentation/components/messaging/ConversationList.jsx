import { useMemo, useState } from 'react';
import {
  IconMessage,
  IconSearch,
  IconUsers,
  IconX,
} from '../icons';
import { conversations } from '../../../data-access/mockMessageData';

function ConversationAvatar({ conversation }) {
  if (conversation.type === 'group') {
    const groupMembers = conversation.members
      .filter((member) => member.id !== 'me')
      .slice(0, 2);

    return (
      <div
        className="message-conversation-group-avatar"
        aria-label={`${conversation.title} group`}
      >
        {groupMembers.map((member, index) => (
          <img
            key={member.id}
            src={member.avatar}
            alt={member.name}
            className={`message-conversation-group-image message-conversation-group-image-${index + 1}`}
          />
        ))}
      </div>
    );
  }

  return (
    <img
      src={conversation.avatar}
      alt={conversation.title}
      className="message-conversation-avatar"
    />
  );
}

function ConversationRow({
  conversation,
  isSelected,
  onSelect,
}) {
  function handleSelectConversation() {
    onSelect(conversation.id);
  }

  return (
    <button
      type="button"
      className={`message-conversation-row ${
        isSelected ? 'message-conversation-row-selected' : ''
      }`}
      onClick={handleSelectConversation}
    >
      <ConversationAvatar conversation={conversation} />

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

        {conversation.tripBadge && (
          <span className="message-trip-badge">
            {conversation.tripBadge}
          </span>
        )}
      </div>
    </button>
  );
}

function EmptyConversationState({ hasSearchQuery, searchQuery }) {
  return (
    <div className="message-conversation-empty">
      <div className="message-conversation-empty-icon">
        {hasSearchQuery ? (
          <IconSearch size={28} />
        ) : (
          <IconUsers size={28} />
        )}
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
  selectedConversationId,
  onSelectConversation,
  isCompact = false,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isArchivedOpen, setIsArchivedOpen] = useState(false);

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();

  const activeConversations = useMemo(() => {
    return conversations.filter((conversation) => {
      if (conversation.isArchived) {
        return false;
      }

      if (!normalizedSearchQuery) {
        return true;
      }

      return (
        conversation.title
          .toLowerCase()
          .includes(normalizedSearchQuery) ||
        conversation.lastMessage
          .toLowerCase()
          .includes(normalizedSearchQuery)
      );
    });
  }, [normalizedSearchQuery]);

  const archivedConversations = useMemo(() => {
    return conversations.filter(
      (conversation) => conversation.isArchived,
    );
  }, []);

  function handleSearchChange(event) {
    setSearchQuery(event.target.value);
  }

  function handleClearSearch() {
    setSearchQuery('');
  }

  function handleToggleArchived() {
    setIsArchivedOpen((currentValue) => !currentValue);
  }

  return (
    <section
      className="message-conversation-list"
      aria-label="Conversations"
    >
      <header className="message-conversation-list-header">
        {!isCompact && (
          <div className="message-conversation-title-row">
            <div className="message-conversation-page-icon">
              <IconMessage size={18} />
            </div>

            <div>
              <h1 className="message-conversation-page-title">
                Messages
              </h1>

              <p className="message-conversation-page-subtitle">
                Your ride and trip conversations
              </p>
            </div>
          </div>
        )}

        <div className="message-conversation-search">
          <span className="message-conversation-search-icon">
            <IconSearch size={16} />
          </span>

          <input
            type="search"
            value={searchQuery}
            onChange={handleSearchChange}
            placeholder="Search conversations..."
            aria-label="Search conversations"
          />

          {searchQuery && (
            <button
              type="button"
              className="message-conversation-search-clear"
              onClick={handleClearSearch}
              aria-label="Clear conversation search"
            >
              <IconX size={14} />
            </button>
          )}
        </div>
      </header>

      <div className="message-conversation-scroll">
        {activeConversations.length > 0 ? (
          activeConversations.map((conversation) => (
            <ConversationRow
              key={conversation.id}
              conversation={conversation}
              isSelected={
                selectedConversationId === conversation.id
              }
              onSelect={onSelectConversation}
            />
          ))
        ) : (
          <EmptyConversationState
            hasSearchQuery={Boolean(normalizedSearchQuery)}
            searchQuery={searchQuery}
          />
        )}

        {archivedConversations.length > 0 &&
          !normalizedSearchQuery && (
            <div className="message-archived-section">
              <button
                type="button"
                className="message-archived-toggle"
                onClick={handleToggleArchived}
                aria-expanded={isArchivedOpen}
              >
                <span
                  className={`message-archived-chevron ${
                    isArchivedOpen
                      ? 'message-archived-chevron-open'
                      : ''
                  }`}
                  aria-hidden="true"
                >
                  ›
                </span>

                <span className="message-archived-label">
                  Archived conversations
                </span>

                <span className="message-archived-count">
                  {archivedConversations.length}
                </span>
              </button>

              {isArchivedOpen && (
                <div className="message-archived-list">
                  {archivedConversations.map((conversation) => (
                    <ConversationRow
                      key={conversation.id}
                      conversation={conversation}
                      isSelected={
                        selectedConversationId === conversation.id
                      }
                      onSelect={onSelectConversation}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
      </div>
    </section>
  );
}