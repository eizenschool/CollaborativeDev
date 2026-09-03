import { useEffect, useMemo, useState } from 'react';
import {
  IconArchive,
  IconArrowLeft,
  IconBell,
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
  const isFriendChat = conversation.scope === 'friend';
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
            {isFriendChat ? (
              <span className={`message-trip-badge ${conversation.isReadOnly ? 'message-trip-badge-read-only' : 'message-trip-badge-friend'}`}>
                <IconUsers size={10} aria-hidden="true" />
                {conversation.isReadOnly
                  ? conversation.friendshipStatus === 'accepted'
                    ? 'Friend unavailable · Read-only'
                    : 'Not friends · Read-only'
                  : 'Friend'}
              </span>
            ) : (
              <>
                <span className="message-trip-badge message-trip-badge-status">
                  <span className="message-status-dot" aria-hidden="true" />
                  {conversation.rideStatus || 'Ride chat'}
                </span>
                {conversation.type === 'group' && <span className="message-trip-badge">Group</span>}
                {conversation.isFormerMember && <span className="message-trip-badge">Left group · Read-only</span>}
              </>
            )}
            {conversation.isMuted && <span className="message-trip-badge"><IconBell size={10} /> Muted</span>}
            {conversation.isArchived && <span className="message-trip-badge"><IconArchive size={10} /> Archived</span>}
          </div>
        </div>
      </button>
      <button
        type="button"
        className="message-conversation-manage"
        onClick={() => onManage(conversation)}
        aria-label={`Conversation details and management for ${conversation.title}`}
        title="Conversation details and management"
      >
        <IconMoreVertical size={19} />
      </button>
    </article>
  );
}

function EmptyConversationState({ folder, messageScope, hasSearchQuery, searchQuery, onBrowseRides }) {
  const emptyTitle = messageScope === 'friend' ? 'No friend messages yet' : 'No ride messages yet';
  const emptyText = messageScope === 'friend'
    ? 'Accept a friend request to start a permanent conversation.'
    : 'Open a published ride to message its host or accepted trip group.';

  return (
    <div className="message-conversation-empty">
      <div className="message-conversation-empty-icon">
        {hasSearchQuery ? <IconSearch size={28} /> : messageScope === 'friend' ? <IconUsers size={28} /> : <IconRoute size={28} />}
      </div>
      <h3 className="message-conversation-empty-title">
        {hasSearchQuery ? `No results for "${searchQuery}"` : folder === 'archived' ? `No archived ${messageScope === 'friend' ? 'friend' : 'ride'} messages` : emptyTitle}
      </h3>
      <p className="message-conversation-empty-text">
        {hasSearchQuery ? 'Try searching with another name, route or message.' : folder === 'archived' ? 'Conversations you archive will appear here.' : emptyText}
      </p>
      {!hasSearchQuery && folder === 'active' && messageScope === 'ride' && (
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
  incomingFriendCount = 0,
  onOpenFriends,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [messageScope, setMessageScope] = useState('ride');
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();

  useEffect(() => {
    if (!selectedConversationId) return;
    const selectedConversation = conversations.find((conversation) => conversation.id === selectedConversationId);
    if (selectedConversation) setMessageScope(selectedConversation.scope === 'friend' ? 'friend' : 'ride');
  }, [conversations, selectedConversationId]);

  const scopedConversations = useMemo(
    () => conversations.filter((conversation) => (messageScope === 'friend') === (conversation.scope === 'friend')),
    [conversations, messageScope],
  );

  const messageCounts = useMemo(() => ({
    ride: conversations.filter((conversation) => conversation.scope !== 'friend').length,
    friend: conversations.filter((conversation) => conversation.scope === 'friend').length,
  }), [conversations]);

  const filteredConversations = useMemo(() => {
    if (!normalizedSearchQuery) return scopedConversations;
    return scopedConversations.filter((conversation) =>
      conversation.title.toLowerCase().includes(normalizedSearchQuery)
      || conversation.lastMessage.toLowerCase().includes(normalizedSearchQuery)
      || conversation.tripRoute?.toLowerCase().includes(normalizedSearchQuery),
    );
  }, [normalizedSearchQuery, scopedConversations]);

  return (
    <section className="message-conversation-list" aria-label="Conversations">
      <header className="message-conversation-list-header">
        <div className="message-conversation-title-row">
          <div className="message-conversation-page-icon">
            {folder === 'archived' ? <IconArchive size={20} /> : <IconMessage size={20} />}
          </div>
          <div className="message-conversation-heading-copy">
            <h1 className="message-conversation-page-title">{folder === 'archived' ? 'Archived' : 'Messages'}</h1>
            <p className="message-conversation-page-subtitle">
              {isLoading ? 'Syncing your conversations' : `${conversations.length} ${folder} conversation${conversations.length === 1 ? '' : 's'}`}
            </p>
          </div>
          <button
            type="button"
            className="message-friends-button"
            onClick={onOpenFriends}
            aria-label={incomingFriendCount ? `Friends, ${incomingFriendCount} incoming requests` : 'Friends'}
          >
            <IconUsers size={17} aria-hidden="true" />
            <span>Friends</span>
            {incomingFriendCount > 0 && <span className="message-friends-count">{incomingFriendCount}</span>}
          </button>
          <button
            type="button"
            className="message-folder-icon-button"
            onClick={() => onFolderChange(folder === 'archived' ? 'active' : 'archived')}
            aria-label={folder === 'archived' ? 'Back to active conversations' : 'Open archived conversations'}
            title={folder === 'archived' ? 'Back to messages' : 'Archived conversations'}
          >
            {folder === 'archived' ? <IconArrowLeft size={20} /> : <IconArchive size={20} />}
          </button>
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

        <div className="message-scope-tabs" role="tablist" aria-label="Message type">
          {[
            { id: 'ride', label: 'Ride messages', icon: IconRoute },
            { id: 'friend', label: 'Friend messages', icon: IconUsers },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={messageScope === id}
              className={messageScope === id ? 'message-scope-tab-active' : ''}
              onClick={() => setMessageScope(id)}
            >
              <Icon size={14} aria-hidden="true" />
              <span>{label}</span>
              <strong>{messageCounts[id]}</strong>
            </button>
          ))}
        </div>
      </header>

      <div className="message-conversation-scroll" aria-busy={isLoading}>
        {error && (
          <div className="message-inline-error" role="alert">
            <p>{error}</p>
            <button type="button" onClick={onRetry}>Try again</button>
          </div>
        )}
        {isLoading ? (
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
        ) : !error && (
          <EmptyConversationState
            folder={folder}
            messageScope={messageScope}
            hasSearchQuery={Boolean(normalizedSearchQuery)}
            searchQuery={searchQuery}
            onBrowseRides={onBrowseRides}
          />
        )}
      </div>
    </section>
  );
}
