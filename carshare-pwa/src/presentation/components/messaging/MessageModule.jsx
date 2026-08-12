import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import { MessagingService } from '../../../business-logic/MessagingService.js';
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
      <section className="message-options-modal" role="dialog" aria-modal="true" aria-labelledby="manage-conversation-title" onMouseDown={(event) => event.stopPropagation()}>
        <span className="message-options-handle" />
        <div className="message-options-header">
          <div><span id="manage-conversation-title">Manage {conversation.title}</span><p>{conversation.tripRoute}</p></div>
          <button type="button" onClick={onClose} aria-label="Close"><IconX size={15} /></button>
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
  const [isDesktop, setIsDesktop] = useState(getIsDesktop);
  const [folder, setFolder] = useState('active');
  const [conversations, setConversations] = useState([]);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [manageConversation, setManageConversation] = useState(null);
  const [manageError, setManageError] = useState('');
  const [isManaging, setIsManaging] = useState(false);
  const [dataVersion, setDataVersion] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [listError, setListError] = useState('');
  const isHistory = Boolean(conversationId && location.pathname.endsWith('/history'));

  const refreshConversations = useCallback(async () => {
    if (!user) return;
    setListError('');
    setIsLoading(true);
    try {
      const nextConversations = await MessagingService.listConversations(folder);
      setConversations(nextConversations);
      if (conversationId) {
        const selected = nextConversations.find((item) => item.id === conversationId)
          || await MessagingService.getConversation(conversationId);
        setSelectedConversation(selected);
        if (selected?.isArchived && folder !== 'archived') setFolder('archived');
      } else {
        setSelectedConversation(null);
      }
    } catch (error) {
      setListError(error.message || 'Unable to load conversations.');
    } finally {
      setIsLoading(false);
    }
  }, [conversationId, folder, user]);

  useEffect(() => { refreshConversations(); }, [refreshConversations, dataVersion]);

  useEffect(() => MessagingService.subscribeToMessaging(() => {
    setDataVersion((current) => current + 1);
  }), []);

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
    setManageError('');
    setManageConversation(conversation);
  }

  async function confirmManage(action) {
    setManageError('');
    setIsManaging(true);
    try {
      if (action === 'archive') {
        await MessagingService.archiveConversation(manageConversation.id);
        setFolder('archived');
        navigate(`/message/${manageConversation.id}`);
      } else {
        await MessagingService.leaveGroup(manageConversation.id);
        setFolder('active');
        navigate('/message');
      }
      setManageConversation(null);
      setDataVersion((current) => current + 1);
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
      conversations={conversations}
      currentUserId={user?.id}
      selectedConversationId={conversationId}
      onSelectConversation={selectConversation}
      onManageConversation={openManage}
      folder={folder}
      onFolderChange={changeFolder}
      isLoading={isLoading}
      error={listError}
      onRetry={refreshConversations}
    />
  );

  const chat = conversationId ? (
    <ChatWindow
      conversationId={conversationId}
      currentUser={user}
      dataVersion={dataVersion}
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
          <section className="message-desktop-info-column"><TripInfoSidebar conversation={selectedConversation} currentUserId={user?.id} /></section>
        </main>
      ) : (
        <main className="message-module message-module-mobile">{conversationId ? chat : conversationList}</main>
      )}
      <ManageConversationDialog
        conversation={manageConversation}
        currentUserId={user?.id}
        pending={isManaging}
        error={manageError}
        onClose={() => setManageConversation(null)}
        onConfirm={confirmManage}
      />
    </>
  );
}
