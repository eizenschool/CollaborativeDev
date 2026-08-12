import { useMemo, useState } from 'react';
import {
  IconArchive,
  IconMessage,
  IconMoreVertical,
  IconRoute,
  IconSearch,
  IconUsers,
  IconX,
} from '../icons.jsx';

function getInitials(name = 'Member') {
  return name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase();
}

function MemberAvatar({ member, className }) {
  if (member?.avatarUrl) {
    return <img src={member.avatarUrl} alt={member.name} className={className} />;
  }
  return <span className={`${className} message-avatar-fallback`}>{getInitials(member?.name)}</span>;
}

function ConversationAvatar({ conversation, currentUserId }) {
  const others = conversation.members.filter((member) => member.id !== currentUserId);
  if (conversation.type === 'group') {
    return (
      <div className="message-conversation-group-avatar" aria-label={`${conversation.title} group`}>
        {others.slice(0, 2).map((member, index) => (
          <MemberAvatar
            key={member.id}
            member={member}
            className={`message-conversation-group-image message-conversation-group-image-${index + 1}`}
          />
        ))}
      </div>
    );
  }
  return (
    <MemberAvatar
      member={others[0] || { name: conversation.title }}
      className="message-conversation-avatar"
    />
  );
}

function ConversationRow({ conversation, currentUserId, isSelected, onSelect, onManage }) {
  return (
    <article className={`message-conversation-row ${isSelected ? 'message-conversation-row-selected' : ''}`}>
      <button
        type="button"
        className="message-conversation-open"
        onClick={() => onSelect(conversation.id)}
        aria-current={isSelected ? 'page' : undefined}
        aria-label={`Open conversation with ${conversation.title}`}
      >
        <ConversationAvatar conversation={conversation} currentUserId={currentUserId} />
        <div className="message-conversation-content">
          <div className="message-conversation-heading">
            <span className="message-conversation-title">{conversation.title}</span>
            <span className={conversation.unreadCount ? 'message-conversation-time message-conversation-time-unread' : 'message-conversation-time'}>
              {conversation.lastTime}
            </span>
          </div>
          <div className="message-conversation-preview-row">
            <span className="message-conversation-preview">{conversation.lastMessage}</span>
            {conversation.unreadCount > 0 && (
              <span className="message-unread-badge" aria-label={`${conversation.unreadCount} unread messages`}>
                {conversation.unreadCount}
              </span>
            )}
          </div>
          {conversation.tripRoute && (
            <span className="message-conversation-route">
              <IconRoute size={12} />
              <span>{conversation.tripRoute}</span>
            </span>
          )}
          <div className="message-conversation-badges">
            <span className="message-trip-badge message-trip-badge-status">
              <span className="message-status-dot" aria-hidden="true" />
              {conversation.rideStatus || 'Ride chat'}
            </span>
            {conversation.type === 'group' && <span className="message-trip-badge">Group</span>}
            {conversation.isArchived && <span className="message-trip-badge"><IconArchive size={10} /> Archived</span>}
          </div>
        </div>
      </button>
      <button
        type="button"
        className="message-conversation-manage"
        onClick={() => onManage(conversation)}
        aria-label={`Manage ${conversation.title}`}
      >
        <IconMoreVertical size={19} />
      </button>
    </article>
  );
}

function EmptyConversationState({ folder, hasSearchQuery, searchQuery, onBrowseRides }) {
  return (
    <div className="message-conversation-empty">
      <div className="message-conversation-empty-icon">
        {hasSearchQuery ? <IconSearch size={28} /> : folder === 'archived' ? <IconArchive size={28} /> : <IconUsers size={28} />}
      </div>
      <h3 className="message-conversation-empty-title">
        {hasSearchQuery ? `No results for "${searchQuery}"` : folder === 'archived' ? 'No archived conversations' : 'No conversations yet'}
      </h3>
      <p className="message-conversation-empty-text">
        {hasSearchQuery ? 'Try searching with another name, route or message.' : folder === 'archived' ? 'Completed private chats you archive will appear here.' : 'Open a published ride to message its Host.'}
      </p>
      {!hasSearchQuery && folder === 'active' && (
        <button type="button" className="message-empty-primary-action" onClick={onBrowseRides}>
          Browse available rides
        </button>
      )}
    </div>
  );
}

function ConversationSkeleton() {
  return (
    <div className="message-conversation-skeleton" role="status" aria-label="Loading conversations">
      {[0, 1, 2, 3].map((item) => (
        <div className="message-conversation-skeleton-row" key={item} aria-hidden="true">
          <span className="message-skeleton-avatar" />
          <span className="message-skeleton-lines"><i /><i /><i /></span>
        </div>
      ))}
      <span className="message-sr-only">Loading conversations</span>
    </div>
  );
}

export default function ConversationList({
  conversations,
  currentUserId,
  selectedConversationId,
  onSelectConversation,
  onManageConversation,
  folder,
  onFolderChange,
  isLoading,
  error,
  onRetry,
  onBrowseRides,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredConversations = useMemo(() => {
    if (!normalizedSearchQuery) return conversations;
    return conversations.filter((conversation) =>
      conversation.title.toLowerCase().includes(normalizedSearchQuery)
      || conversation.lastMessage.toLowerCase().includes(normalizedSearchQuery)
      || conversation.tripRoute?.toLowerCase().includes(normalizedSearchQuery),
    );
  }, [conversations, normalizedSearchQuery]);

  return (
    <section className="message-conversation-list" aria-label="Conversations">
      <header className="message-conversation-list-header">
        <div className="message-conversation-title-row">
          <div className="message-conversation-page-icon"><IconMessage size={20} /></div>
          <div>
            <h1 className="message-conversation-page-title">Messages</h1>
            <p className="message-conversation-page-subtitle">
              {isLoading ? 'Syncing your ride conversations' : `${conversations.length} ${folder} conversation${conversations.length === 1 ? '' : 's'}`}
            </p>
          </div>
        </div>

        <div className="message-folder-tabs" role="tablist" aria-label="Conversation folders">
          {['active', 'archived'].map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={folder === item}
              className={folder === item ? 'message-folder-tab-active' : ''}
              onClick={() => onFolderChange(item)}
            >
              {item === 'active' ? 'Active' : 'Archived'}
            </button>
          ))}
        </div>

        <div className="message-conversation-search">
          <label className="message-sr-only" htmlFor="conversation-search">Search conversations</label>
          <span className="message-conversation-search-icon"><IconSearch size={17} /></span>
          <input
            id="conversation-search"
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search people, routes or messages"
          />
          {searchQuery && (
            <button type="button" className="message-conversation-search-clear" onClick={() => setSearchQuery('')} aria-label="Clear conversation search">
              <IconX size={15} />
            </button>
          )}
        </div>
      </header>

      <div className="message-conversation-scroll" aria-busy={isLoading}>
        {error ? (
          <div className="message-inline-error" role="alert">
            <p>{error}</p>
            <button type="button" onClick={onRetry}>Try again</button>
          </div>
        ) : isLoading ? (
          <ConversationSkeleton />
        ) : filteredConversations.length > 0 ? (
          filteredConversations.map((conversation) => (
            <ConversationRow
              key={conversation.id}
              conversation={conversation}
              currentUserId={currentUserId}
              isSelected={selectedConversationId === conversation.id}
              onSelect={onSelectConversation}
              onManage={onManageConversation}
            />
          ))
        ) : (
          <EmptyConversationState
            folder={folder}
            hasSearchQuery={Boolean(normalizedSearchQuery)}
            searchQuery={searchQuery}
            onBrowseRides={onBrowseRides}
          />
        )}
      </div>
    </section>
  );
}
