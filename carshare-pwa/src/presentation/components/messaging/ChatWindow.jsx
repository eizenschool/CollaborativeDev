import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IconArrowLeft,
  IconCamera,
  IconClock,
  IconMapPin,
  IconMessage,
  IconMoreVertical,
  IconPaperclip,
  IconSend,
  IconX,
} from '../icons.jsx';
import {
  MESSAGE_TYPE,
  MessagingService,
  validateMessageDraft,
} from '../../../business-logic/MessagingService.js';
import MessageBubble from './MessageBubble.jsx';
import GoogleLocationMap from '../maps/GoogleLocationMap.jsx';

function getInitials(name = 'Member') {
  return name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase();
}

function MemberAvatar({ member, className }) {
  if (member?.avatarUrl) return <img src={member.avatarUrl} alt={member.name} className={className} />;
  return <span className={`${className} message-avatar-fallback`}>{getInitials(member?.name)}</span>;
}

function ConversationAvatar({ conversation, currentUserId }) {
  const others = conversation.members.filter((member) => member.id !== currentUserId);
  if (conversation.type === 'group') {
    return (
      <div className="message-chat-group-avatar" aria-label={`${conversation.title} group`}>
        {others.slice(0, 2).map((member, index) => (
          <MemberAvatar key={member.id} member={member} className={`message-chat-group-image message-chat-group-image-${index + 1}`} />
        ))}
      </div>
    );
  }
  return <MemberAvatar member={others[0] || { name: conversation.title }} className="message-chat-avatar" />;
}

function ChatEmptyState({ title = 'No messages yet', text = 'Send a message to start this conversation.' }) {
  return (
    <div className="message-chat-empty">
      <div className="message-chat-empty-icon"><IconMessage size={28} /></div>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

function mediaEntryFromAttachment(attachment) {
  return {
    token: `existing:${attachment.id}`,
    source: 'existing',
    attachment,
    name: attachment.fileName,
    kind: attachment.kind,
    previewUrl: attachment.url,
  };
}

function mediaEntryFromFile(file) {
  const clientId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  return {
    token: `new:${clientId}`,
    clientId,
    source: 'new',
    file,
    name: file.name,
    kind: file.type.startsWith('image/') ? 'image' : 'video',
    previewUrl: URL.createObjectURL(file),
  };
}

function validationFiles(entries) {
  return entries.map((entry) => entry.file || {
    name: entry.attachment.fileName,
    type: entry.attachment.mimeType,
    size: Number(entry.attachment.fileSize),
  });
}

function ComposerMedia({ entries, onMove, onRemove }) {
  if (!entries.length) return null;
  return (
    <div className="message-draft-media" aria-label="Selected media">
      {entries.map((entry, index) => (
        <article key={entry.token} className="message-draft-media-item">
          {entry.kind === 'image'
            ? <img src={entry.previewUrl} alt={entry.name} />
            : <video src={entry.previewUrl} muted preload="metadata" aria-label={entry.name} />}
          <span title={entry.name}>{entry.name}</span>
          <div>
            <button type="button" onClick={() => onMove(index, -1)} disabled={index === 0} aria-label={`Move ${entry.name} earlier`}>←</button>
            <button type="button" onClick={() => onMove(index, 1)} disabled={index === entries.length - 1} aria-label={`Move ${entry.name} later`}>→</button>
            <button type="button" onClick={() => onRemove(index)} aria-label={`Remove ${entry.name}`}><IconX size={12} /></button>
          </div>
        </article>
      ))}
    </div>
  );
}

export default function ChatWindow({
  conversationId,
  currentUser,
  dataVersion,
  onBack,
  onManage,
  onOpenHistory,
  highlightedMessageId,
  isDesktop = false,
}) {
  const [conversation, setConversation] = useState(null);
  const [messageList, setMessageList] = useState([]);
  const [text, setText] = useState('');
  const [mediaEntries, setMediaEntries] = useState([]);
  const [location, setLocation] = useState(null);
  const [editingMessage, setEditingMessage] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [loadError, setLoadError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, setIsPending] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const fileInputRef = useRef(null);
  const messageBottomRef = useRef(null);
  const mediaEntriesRef = useRef([]);

  const releaseMediaEntries = useCallback((entries) => {
    entries.filter((entry) => entry.source === 'new').forEach((entry) => URL.revokeObjectURL(entry.previewUrl));
  }, []);

  const resetComposer = useCallback(() => {
    setMediaEntries((current) => {
      releaseMediaEntries(current);
      return [];
    });
    setText('');
    setLocation(null);
    setEditingMessage(null);
    setErrorMessage('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [releaseMediaEntries]);

  const loadConversation = useCallback(async () => {
    if (!conversationId) return;
    setLoadError('');
    setIsLoading(true);
    try {
      const [nextConversation, nextMessages] = await Promise.all([
        MessagingService.getConversation(conversationId),
        MessagingService.listMessages(conversationId),
      ]);
      if (!nextConversation) throw new Error('This conversation is no longer available.');
      setConversation(nextConversation);
      setMessageList(nextMessages);
      await MessagingService.markConversationRead(conversationId).catch(() => {});
    } catch (error) {
      setConversation(null);
      setMessageList([]);
      setLoadError(error.message || 'Unable to load this conversation.');
    } finally {
      setIsLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    resetComposer();
    loadConversation();
  }, [conversationId, loadConversation, resetComposer]);

  useEffect(() => {
    if (dataVersion) loadConversation();
  }, [dataVersion, loadConversation]);

  useEffect(() => {
    mediaEntriesRef.current = mediaEntries;
  }, [mediaEntries]);

  useEffect(() => () => releaseMediaEntries(mediaEntriesRef.current), [releaseMediaEntries]);

  useEffect(() => {
    if (highlightedMessageId) {
      document.getElementById(`message-${highlightedMessageId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      messageBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messageList, highlightedMessageId]);

  function addFiles(fileList) {
    const additions = Array.from(fileList || []).map(mediaEntryFromFile);
    try {
      validateMessageDraft({ text: text || 'draft', files: validationFiles([...mediaEntries, ...additions]), location });
      setMediaEntries((current) => [...current, ...additions]);
      setErrorMessage('');
    } catch (error) {
      releaseMediaEntries(additions);
      setErrorMessage(error.message);
    }
  }

  function moveMedia(index, direction) {
    setMediaEntries((current) => {
      const next = [...current];
      [next[index], next[index + direction]] = [next[index + direction], next[index]];
      return next;
    });
  }

  function removeMedia(index) {
    setMediaEntries((current) => {
      const next = [...current];
      const [removed] = next.splice(index, 1);
      if (removed?.source === 'new') URL.revokeObjectURL(removed.previewUrl);
      return next;
    });
  }

  function shareCurrentLocation() {
    if (!navigator.geolocation) {
      setErrorMessage('Location sharing is not supported by this browser.');
      return;
    }
    setIsLocating(true);
    setErrorMessage('');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude });
        setIsLocating(false);
      },
      (error) => {
        setErrorMessage(error.code === error.PERMISSION_DENIED
          ? 'Location permission was denied. Allow location access and try again.'
          : 'Unable to get your current location. Please try again.');
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  }

  function beginEdit(message) {
    resetComposer();
    setEditingMessage(message);
    setText(message.text);
    setMediaEntries(message.attachments.filter((item) => ['image', 'video'].includes(item.kind)).map(mediaEntryFromAttachment));
    const sharedLocation = message.attachments.find((item) => item.kind === MESSAGE_TYPE.LOCATION);
    setLocation(sharedLocation ? { latitude: sharedLocation.latitude, longitude: sharedLocation.longitude } : null);
  }

  async function submitMessage() {
    if (isPending) return;
    setIsPending(true);
    setErrorMessage('');
    try {
      if (editingMessage) {
        await MessagingService.editMessage({
          messageId: editingMessage.id,
          text,
          existingAttachmentIds: mediaEntries.filter((item) => item.source === 'existing').map((item) => item.attachment.id),
          newFiles: mediaEntries.filter((item) => item.source === 'new').map((item) => ({ file: item.file, clientId: item.clientId })),
          mediaOrder: mediaEntries.map((item) => item.token),
          location,
        });
      } else {
        await MessagingService.sendMessage({
          conversationId,
          text,
          files: mediaEntries.map((item) => item.file),
          location,
        });
      }
      resetComposer();
      await loadConversation();
    } catch (error) {
      setErrorMessage(`${error.message || 'Unable to save message.'} Your draft has been kept for Retry.`);
    } finally {
      setIsPending(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || isPending) return;
    setIsPending(true);
    setErrorMessage('');
    try {
      await MessagingService.deleteMessage(deleteTarget.id);
      setDeleteTarget(null);
      await loadConversation();
    } catch (error) {
      setErrorMessage(error.message || 'Unable to delete message.');
    } finally {
      setIsPending(false);
    }
  }

  if (loadError) {
    return (
      <section className="message-chat-window">
        <div className="message-inline-error" role="alert"><p>{loadError}</p><button type="button" onClick={loadConversation}>Retry</button></div>
      </section>
    );
  }
  if (isLoading || !conversation) {
    return <section className="message-chat-window"><div className="message-loading-state">Loading conversation…</div></section>;
  }

  const hasDraft = Boolean(text.trim() || mediaEntries.length || location);
  const memberDescription = conversation.type === 'group' ? `${conversation.members.length} members` : 'Private ride chat';

  return (
    <section className="message-chat-window" aria-label={`Conversation with ${conversation.title}`}>
      <header className="message-chat-header">
        {!isDesktop && <button type="button" className="message-chat-header-button message-chat-back-button" onClick={onBack} aria-label="Back to conversations"><IconArrowLeft size={17} /></button>}
        <ConversationAvatar conversation={conversation} currentUserId={currentUser.id} />
        <div className="message-chat-header-content">
          <div className="message-chat-header-title-row">
            <h2>{conversation.title}</h2>
            {conversation.type === 'group' && <span className="message-chat-header-badge">Group chat</span>}
            {conversation.isArchived && <span className="message-chat-header-badge">Archived</span>}
          </div>
          <p>{memberDescription}</p>
        </div>
        <div className="message-chat-header-actions">
          <button type="button" className="message-chat-header-button" onClick={() => onOpenHistory(conversation.id)} aria-label="Open message history"><IconClock size={18} /></button>
          <button type="button" className="message-chat-header-button" onClick={() => onManage(conversation)} aria-label="Manage conversation"><IconMoreVertical size={18} /></button>
        </div>
      </header>

      <div className="message-chat-scroll">
        {messageList.length ? messageList.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            currentUserId={currentUser.id}
            onEdit={beginEdit}
            onDelete={setDeleteTarget}
            highlighted={message.id === highlightedMessageId}
          />
        )) : <ChatEmptyState />}
        <div ref={messageBottomRef} />
      </div>

      {conversation.isReadOnly ? (
        <footer className="message-read-only-banner">Archived conversations are read-only until they expire.</footer>
      ) : (
        <footer className="message-composer">
          {editingMessage && (
            <div className="message-editing-banner">
              <span>Editing message — changes apply to the whole text/media/location bundle.</span>
              <button type="button" onClick={resetComposer}>Cancel</button>
            </div>
          )}
          <ComposerMedia entries={mediaEntries} onMove={moveMedia} onRemove={removeMedia} />
          {location && (
            <div className="message-draft-location">
              <GoogleLocationMap latitude={location.latitude} longitude={location.longitude} compact />
              <button type="button" onClick={() => setLocation(null)} aria-label="Remove shared location"><IconX size={14} /></button>
            </div>
          )}
          <div className="message-composer-inner">
            <input
              ref={fileInputRef}
              className="message-file-input"
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime"
              onChange={(event) => addFiles(event.target.files)}
            />
            <button type="button" className="message-composer-icon-button" onClick={() => fileInputRef.current?.click()} disabled={isPending} aria-label="Add photos or videos"><IconPaperclip size={18} /></button>
            <button type="button" className="message-composer-icon-button" onClick={() => fileInputRef.current?.click()} disabled={isPending} aria-label="Add media"><IconCamera size={18} /></button>
            <button type="button" className={`message-composer-icon-button ${location ? 'message-composer-icon-button-active' : ''}`} onClick={shareCurrentLocation} disabled={isPending || isLocating} aria-label="Share current location"><IconMapPin size={18} /></button>
            <div className="message-composer-input-wrap">
              <textarea value={text} onChange={(event) => setText(event.target.value)} rows="1" maxLength="1000" placeholder="Write a message…" aria-label="Message text" disabled={isPending} />
            </div>
            <button type="button" className={`message-send-button ${hasDraft && !isPending ? 'message-send-button-active' : ''}`} onClick={submitMessage} disabled={!hasDraft || isPending} aria-label={editingMessage ? 'Save edited message' : 'Send message'}><IconSend size={17} /></button>
          </div>
          {errorMessage && <p className="message-composer-error" role="alert" aria-live="assertive">{errorMessage}</p>}
          {isPending && <p className="message-pending-status" role="status" aria-live="polite">{editingMessage ? 'Saving message…' : 'Uploading and sending…'}</p>}
        </footer>
      )}

      {deleteTarget && (
        <div className="message-options-backdrop" role="presentation" onMouseDown={() => !isPending && setDeleteTarget(null)}>
          <section className="message-options-modal" role="dialog" aria-modal="true" aria-labelledby="delete-message-title" onMouseDown={(event) => event.stopPropagation()}>
            <span className="message-options-handle" />
            <div className="message-options-header"><div><span id="delete-message-title">Delete this message?</span><p>The complete text, media and location bundle will be deleted permanently.</p></div><button type="button" onClick={() => setDeleteTarget(null)} aria-label="Close"><IconX size={15} /></button></div>
            <button type="button" className="message-options-delete" onClick={confirmDelete} disabled={isPending}>Delete message</button>
          </section>
        </div>
      )}
    </section>
  );
}
