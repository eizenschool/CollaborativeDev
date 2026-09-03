import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import {
  isTerminalRideStatus,
  MessagingService,
} from '../../../business-logic/MessagingService.js';
import {
  FRIENDSHIP_STATUS,
  FriendshipService,
} from '../../../business-logic/FriendshipService.js';
import { useMessagingSession } from '../../../context/MessagingSessionContext.jsx';
import { IconArchive, IconBell, IconMessage, IconTrash } from '../icons.jsx';
import ConversationList from './ConversationList.jsx';
import ChatWindow from './ChatWindow.jsx';
import MessageHistory from './MessageHistory.jsx';
import ConversationDetailsContent from './ConversationDetailsContent.jsx';
import AdaptiveDialog from '../ui/AdaptiveDialog.jsx';
import { Button } from '../ui/Button.jsx';
import '../../styles/message.css';

const DESKTOP_BREAKPOINT = 900;

function getIsDesktop() {
  return typeof window === 'undefined' || window.innerWidth > DESKTOP_BREAKPOINT;
}

function EmptyChatSelection() {
  return (
    <div className="message-empty-selection">
      <div className="message-empty-selection-icon"><IconMessage size={34} /></div>
      <h2>Select a conversation</h2>
      <p>Choose a friend chat, private ride chat or accepted-trip group from the list.</p>
    </div>
  );
}

function ManageConversationDialog({ conversation, currentUserId, pending, error, onClose, onConfirm, triggerRef }) {
  if (!conversation) return null;
  const isFriend = conversation.scope === 'friend';
  const isTerminal = isTerminalRideStatus(conversation.rideStatus);
  const canManage = isFriend || isTerminal;
  const note = isFriend
    ? 'Friend chats do not expire. You can archive, mute or delete your visible history at any time.'
    : isTerminal
      ? `Personal controls are available until this ${conversation.rideStatus.toLowerCase()} ride conversation expires.`
    : 'Archive, delete, mute and unmute become available after the ride is completed, cancelled or expired.';

  return (
    <AdaptiveDialog
      open={Boolean(conversation)}
      onClose={() => { if (!pending) onClose(); }}
      title={conversation.type === 'group' ? 'Group members' : 'Conversation details'}
      description={conversation.title}
      triggerRef={triggerRef}
      footer={(
        <>
          <Button variant="secondary" disabled={pending} onClick={onClose}>Close</Button>
          {canManage && (
            <Button loading={pending} onClick={() => onConfirm(conversation.isArchived ? 'unarchive' : 'archive')}>
              <IconArchive size={16} aria-hidden="true" /> {conversation.isArchived ? 'Unarchive' : 'Archive'}
            </Button>
          )}
          {canManage && (
            <Button variant="secondary" loading={pending} onClick={() => onConfirm(conversation.isMuted ? 'unmute' : 'mute')}>
              <IconBell size={16} aria-hidden="true" /> {conversation.isMuted ? 'Unmute' : 'Mute'}
            </Button>
          )}
          {canManage && (
            <Button variant="danger" loading={pending} loadingLabel="Deleting" onClick={() => onConfirm('delete')}>
              <IconTrash size={16} aria-hidden="true" /> Delete for me
            </Button>
          )}
          {isFriend && conversation.friendshipStatus === FRIENDSHIP_STATUS.ACCEPTED && (
            <Button variant="danger" loading={pending} onClick={() => onConfirm('remove-friend')}>
              Remove friend
            </Button>
          )}
        </>
      )}
    >
      <ConversationDetailsContent conversation={conversation} currentUserId={currentUserId} />
      <p className="message-options-note">{note}</p>
      {error && <p className="message-composer-error" role="alert">{error}</p>}
    </AdaptiveDialog>
  );
}

export default function MessageModule() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const {
    folder,
    folderState,
    setFolder,
    refreshConversations,
    refreshConversation,
  } = useMessagingSession();
  const [isDesktop, setIsDesktop] = useState(getIsDesktop);
  const [manageConversation, setManageConversation] = useState(null);
  const [manageError, setManageError] = useState('');
  const [isManaging, setIsManaging] = useState(false);
  const [incomingFriendCount, setIncomingFriendCount] = useState(0);
  const [removeFriendTarget, setRemoveFriendTarget] = useState(null);
  const [removeFriendError, setRemoveFriendError] = useState('');
  const [isRemovingFriend, setIsRemovingFriend] = useState(false);
  const manageReturnFocusRef = useRef(null);
  const removeFriendReturnFocusRef = useRef(null);
  const isHistory = Boolean(conversationId && location.pathname.endsWith('/history'));

  const refreshFriendCount = useCallback(async () => {
    if (!user?.id) return;
    try {
      const connections = await FriendshipService.listConnections();
      setIncomingFriendCount(connections.filter((item) => item.status === FRIENDSHIP_STATUS.INCOMING_PENDING).length);
    } catch {
      // Friends can be deployed independently; ride messaging remains usable.
      setIncomingFriendCount(0);
    }
  }, [user?.id]);

  useEffect(() => {
    if (isHistory) return;
    refreshConversations();
    if (!conversationId) return;
    refreshConversation(conversationId, { markRead: true }).then((conversation) => {
      if (!conversation) navigate('/message', { replace: true });
      else if (conversation.isArchived && folder !== 'archived') setFolder('archived');
    });
  }, [conversationId, folder, isHistory, navigate, refreshConversation, refreshConversations, setFolder]);

  useEffect(() => {
    const mediaQuery = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT + 1}px)`);
    const update = (event) => setIsDesktop(event.matches);
    setIsDesktop(mediaQuery.matches);
    mediaQuery.addEventListener('change', update);
    return () => mediaQuery.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!user?.id) return undefined;
    let timerId = null;
    void refreshFriendCount();
    const unsubscribe = FriendshipService.subscribe(() => {
      window.clearTimeout(timerId);
      timerId = window.setTimeout(() => { void refreshFriendCount(); }, 80);
    });
    return () => {
      window.clearTimeout(timerId);
      unsubscribe();
    };
  }, [refreshFriendCount, user?.id]);

  function selectConversation(id) {
    navigate(`/message/${id}`);
  }

  function changeFolder(nextFolder) {
    setFolder(nextFolder);
    navigate('/message');
  }

  function openManage(conversation) {
    manageReturnFocusRef.current = document.activeElement;
    setManageError('');
    setManageConversation(conversation);
  }

  function closeManage() {
    setManageConversation(null);
  }

  async function confirmManage(action) {
    if (action === 'remove-friend') {
      removeFriendReturnFocusRef.current = manageReturnFocusRef.current;
      setRemoveFriendError('');
      setRemoveFriendTarget(manageConversation);
      setManageConversation(null);
      return;
    }
    setManageError('');
    setIsManaging(true);
    try {
      if (action === 'archive') {
        await MessagingService.archiveConversation(manageConversation.id);
        setFolder('archived');
        navigate(`/message/${manageConversation.id}`);
      } else if (action === 'unarchive') {
        await MessagingService.unarchiveConversation(manageConversation.id);
        setFolder('active');
        navigate(`/message/${manageConversation.id}`);
      } else if (action === 'delete') {
        await MessagingService.deleteConversationForMe(manageConversation.id);
        navigate('/message');
      } else if (action === 'mute' || action === 'unmute') {
        await MessagingService.setConversationMuted(manageConversation.id, action === 'mute');
      }
      await Promise.all([refreshConversations('active'), refreshConversations('archived')]);
      if (action !== 'delete') await refreshConversation(manageConversation.id);
      setManageConversation(null);
    } catch (error) {
      setManageError(error.message || 'Unable to manage this conversation.');
    } finally {
      setIsManaging(false);
    }
  }

  if (isHistory) {
    return (
      <MessageHistory
        conversationId={conversationId}
        onBack={() => navigate(`/message/${conversationId}`)}
        onOpenMessage={(messageId) => navigate(`/message/${conversationId}`, { state: { highlightMessageId: messageId } })}
      />
    );
  }

  async function confirmRemoveFriend() {
    if (!removeFriendTarget?.otherUserId) return;
    setRemoveFriendError('');
    setIsRemovingFriend(true);
    try {
      await FriendshipService.removeFriend(removeFriendTarget.otherUserId);
      await Promise.all([
        refreshFriendCount(),
        refreshConversations('active'),
        refreshConversations('archived'),
      ]);
      await refreshConversation(removeFriendTarget.id);
      setRemoveFriendTarget(null);
    } catch (error) {
      setRemoveFriendError(error.message || 'Unable to remove this friend.');
    } finally {
      setIsRemovingFriend(false);
    }
  }

  const conversationList = (
    <ConversationList
      conversations={folderState.items}
      currentUserId={user?.id}
      selectedConversationId={conversationId}
      onSelectConversation={selectConversation}
      onManageConversation={openManage}
      folder={folder}
      onFolderChange={changeFolder}
      isLoading={folderState.loading}
      error={folderState.error}
      onRetry={() => refreshConversations(folder)}
      onBrowseRides={() => navigate('/search')}
      incomingFriendCount={incomingFriendCount}
      onOpenFriends={() => navigate('/message/friends')}
    />
  );

  const chat = conversationId ? (
    <ChatWindow
      conversationId={conversationId}
      currentUser={user}
      onBack={() => navigate('/message')}
      onManage={openManage}
      onOpenHistory={(id) => navigate(`/message/${id}/history`)}
      highlightedMessageId={location.state?.highlightMessageId}
      isDesktop={isDesktop}
    />
  ) : <EmptyChatSelection />;

  return (
    <>
      {isDesktop ? (
        <main className="message-module message-module-desktop">
          <section className="message-desktop-conversation-column">{conversationList}</section>
          <section className="message-desktop-chat-column">{chat}</section>
        </main>
      ) : (
        <main className="message-module message-module-mobile">{conversationId ? chat : conversationList}</main>
      )}
      <ManageConversationDialog
        conversation={manageConversation}
        currentUserId={user?.id}
        pending={isManaging}
        error={manageError}
        onClose={closeManage}
        onConfirm={confirmManage}
        triggerRef={manageReturnFocusRef}
      />
      <AdaptiveDialog
        open={Boolean(removeFriendTarget)}
        onClose={() => { if (!isRemovingFriend) setRemoveFriendTarget(null); }}
        title="Remove friend?"
        description={removeFriendTarget ? `Your chat with ${removeFriendTarget.title} will remain in Messages as read-only.` : ''}
        triggerRef={removeFriendReturnFocusRef}
        footer={(
          <>
            <Button variant="secondary" disabled={isRemovingFriend} onClick={() => setRemoveFriendTarget(null)}>Keep friend</Button>
            <Button variant="danger" loading={isRemovingFriend} loadingLabel="Removing" onClick={() => { void confirmRemoveFriend(); }}>
              Remove friend
            </Button>
          </>
        )}
      >
        <p>You will both lose messaging and calling access until a new friend request is accepted. Existing history is not deleted.</p>
        {removeFriendError && <p className="message-composer-error" role="alert">{removeFriendError}</p>}
      </AdaptiveDialog>
    </>
  );
}
