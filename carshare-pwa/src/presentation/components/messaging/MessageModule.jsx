import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import {
  isTerminalRideStatus,
  MessagingService,
} from '../../../business-logic/MessagingService.js';
import { useMessagingSession } from '../../../context/MessagingSessionContext.jsx';
import { IconArchive, IconMessage, IconTrash } from '../icons.jsx';
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
      <p>Choose a private ride chat or accepted-trip group from the list.</p>
    </div>
  );
}

function ManageConversationDialog({ conversation, currentUserId, pending, error, onClose, onConfirm, triggerRef }) {
  if (!conversation) return null;
  const membership = conversation.members.find((member) => member.id === currentUserId);
  const isTerminal = isTerminalRideStatus(conversation.rideStatus);
  const canArchive = isTerminal && conversation.type === 'direct' && !conversation.isArchived;
  const canLeave = isTerminal && conversation.type === 'group' && membership?.role === 'traveller';
  let note = 'Conversation details remain available while this ride chat is active.';
  if (conversation.isArchived) note = 'This private chat is archived and read-only. It cannot be unarchived and will expire with the trip retention period.';
  else if (canArchive) note = `Archive this ${conversation.rideStatus.toLowerCase()} private chat? It will become read-only and remain searchable until expiry.`;
  else if (canLeave) note = `Leave this ${conversation.rideStatus.toLowerCase()} group? You will immediately lose access and the remaining members will be notified.`;
  else if (isTerminal && conversation.type === 'group') note = 'The Host cannot leave or archive a trip group.';

  return (
    <AdaptiveDialog
      open={Boolean(conversation)}
      onClose={() => { if (!pending) onClose(); }}
      title="Conversation details"
      description={conversation.title}
      triggerRef={triggerRef}
      footer={(
        <>
          <Button variant="secondary" disabled={pending} onClick={onClose}>Close</Button>
          {canArchive && <Button loading={pending} loadingLabel="Archiving" onClick={() => onConfirm('archive')}><IconArchive size={16} aria-hidden="true" /> Archive conversation</Button>}
          {canLeave && <Button variant="danger" loading={pending} loadingLabel="Leaving" onClick={() => onConfirm('leave')}><IconTrash size={16} aria-hidden="true" /> Leave group</Button>}
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
  const manageReturnFocusRef = useRef(null);
  const isHistory = Boolean(conversationId && location.pathname.endsWith('/history'));

  useEffect(() => {
    if (isHistory) return;
    refreshConversations();
    if (!conversationId) return;
    refreshConversation(conversationId, { markRead: true }).then((conversation) => {
      if (conversation?.isArchived && folder !== 'archived') setFolder('archived');
    });
  }, [conversationId, folder, isHistory, refreshConversation, refreshConversations, setFolder]);

  useEffect(() => {
    const mediaQuery = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT + 1}px)`);
    const update = (event) => setIsDesktop(event.matches);
    setIsDesktop(mediaQuery.matches);
    mediaQuery.addEventListener('change', update);
    return () => mediaQuery.removeEventListener('change', update);
  }, []);

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
    setManageError('');
    setIsManaging(true);
    try {
      if (action === 'archive') {
        await MessagingService.archiveConversation(manageConversation.id);
        setFolder('archived');
        navigate(`/message/${manageConversation.id}`);
        refreshConversation(manageConversation.id);
        refreshConversations('active');
        refreshConversations('archived');
      } else {
        await MessagingService.leaveGroup(manageConversation.id);
        setFolder('active');
        navigate('/message');
        refreshConversations('active');
      }
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
    </>
  );
}
