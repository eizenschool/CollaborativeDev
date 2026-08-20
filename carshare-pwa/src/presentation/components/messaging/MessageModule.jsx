import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import {
  MessagingService,
} from '../../../business-logic/MessagingService.js';
import { useMessagingSession } from '../../../context/MessagingSessionContext.jsx';
import { IconArchive, IconMessage, IconTrash, IconX } from '../icons.jsx';
import ConversationList from './ConversationList.jsx';
import ChatWindow from './ChatWindow.jsx';
import MessageHistory from './MessageHistory.jsx';
import TripInfoSidebar from './TripInfoSidebar.jsx';
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

function ManageConversationDialog({ conversation, currentUserId, pending, error, onClose, onConfirm }) {
  const closeButtonRef = useRef(null);
  const modalRef = useRef(null);

  useEffect(() => {
    if (!conversation) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !pending) onClose();
      if (event.key !== 'Tab') return;
      const focusable = [...(modalRef.current?.querySelectorAll('button:not(:disabled)') || [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    closeButtonRef.current?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [conversation, onClose, pending]);

  if (!conversation) return null;
  const membership = conversation.members.find((member) => member.id === currentUserId);
  const isCompleted = conversation.rideStatus === 'Completed';
  const canArchive = isCompleted && conversation.type === 'direct' && !conversation.isArchived;
  const canLeave = isCompleted && conversation.type === 'group' && membership?.role === 'traveller';
  let note = 'Conversation management becomes available after the trip is Completed.';
  if (conversation.isArchived) note = 'This private chat is archived and read-only. It cannot be unarchived and will expire with the trip retention period.';
  else if (canArchive) note = 'Archive this completed private chat? It will become read-only and remain searchable until expiry.';
  else if (canLeave) note = 'Leave this completed group? You will immediately lose access and the remaining members will be notified.';
  else if (isCompleted && conversation.type === 'group') note = 'The Host cannot leave a trip group.';

  return (
    <div className="message-options-backdrop" onMouseDown={() => !pending && onClose()}>
      <section ref={modalRef} className="message-options-modal" role="dialog" aria-modal="true" aria-labelledby="manage-conversation-title" onMouseDown={(event) => event.stopPropagation()}>
        <span className="message-options-handle" />
        <div className="message-options-header">
          <div><span id="manage-conversation-title">Manage {conversation.title}</span><p>{conversation.tripRoute}</p></div>
          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Close conversation management"><IconX size={18} /></button>
        </div>
        <p className="message-options-note">{note}</p>
        {!isCompleted && <p className="message-composer-error" role="alert">This conversation cannot be managed until the trip is completed.</p>}
        {error && <p className="message-composer-error" role="alert">{error}</p>}
        {canArchive && <button type="button" className="message-manage-action" onClick={() => onConfirm('archive')} disabled={pending}><IconArchive size={16} /> {pending ? 'Archiving…' : 'Archive conversation'}</button>}
        {canLeave && <button type="button" className="message-options-delete" onClick={() => onConfirm('leave')} disabled={pending}><IconTrash size={16} /> {pending ? 'Leaving…' : 'Leave group'}</button>}
      </section>
    </div>
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
    getConversation,
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

  const closeManage = useCallback(() => {
    setManageConversation(null);
    window.setTimeout(() => manageReturnFocusRef.current?.focus(), 0);
  }, []);

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
          <section className="message-desktop-info-column"><TripInfoSidebar conversation={getConversation(conversationId)} currentUserId={user?.id} /></section>
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
      />
    </>
  );
}
