import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IconArrowLeft,
  IconArchive,
  IconCamera,
  IconClock,
  IconMapPin,
  IconMessage,
  IconMicrophone,
  IconMoreVertical,
  IconPaperclip,
  IconSend,
  IconStop,
  IconVideo,
  IconX,
} from '../icons.jsx';
import {
  MESSAGE_TYPE,
  MessagingService,
  validateMessageDraft,
} from '../../../business-logic/MessagingService.js';
import { useMessagingSession } from '../../../context/MessagingSessionContext.jsx';
import MessageBubble from './MessageBubble.jsx';
import GoogleLocationMap from '../maps/GoogleLocationMap.jsx';
import useVideoRecorder from './useVideoRecorder.js';
import useVoiceRecorder from './useVoiceRecorder.js';

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

function ChatSkeleton() {
  return (
    <section className="message-chat-window" aria-label="Loading conversation" aria-busy="true">
      <div className="message-chat-header message-chat-header-skeleton" aria-hidden="true">
        <span className="message-skeleton-avatar" />
        <span className="message-skeleton-lines"><i /><i /></span>
      </div>
      <div className="message-chat-skeleton" aria-hidden="true">
        <i className="message-chat-skeleton-bubble message-chat-skeleton-bubble-left" />
        <i className="message-chat-skeleton-bubble message-chat-skeleton-bubble-right" />
        <i className="message-chat-skeleton-bubble message-chat-skeleton-bubble-left message-chat-skeleton-bubble-short" />
      </div>
      <span className="message-sr-only">Loading conversation</span>
    </section>
  );
}

function formatDuration(totalSeconds = 0) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
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
  onBack,
  onManage,
  onOpenHistory,
  highlightedMessageId,
  isDesktop = false,
}) {
  const {
    getConversation,
    getMessagesState,
    refreshConversation,
    getDraft,
    saveDraft,
    clearDraft,
  } = useMessagingSession();
  const initialDraft = getDraft(conversationId);
  const [text, setText] = useState(() => initialDraft?.text || '');
  const [mediaEntries, setMediaEntries] = useState(() => initialDraft?.mediaEntries || []);
  const [location, setLocation] = useState(() => initialDraft?.location || null);
  const [voiceRecording, setVoiceRecording] = useState(() => initialDraft?.voiceRecording || null);
  const [editingMessage, setEditingMessage] = useState(() => initialDraft?.editingMessage || null);
  const [composerConversationId, setComposerConversationId] = useState(conversationId);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [isCaptureMenuOpen, setIsCaptureMenuOpen] = useState(false);
  const fileInputRef = useRef(null);
  const photoInputRef = useRef(null);
  const messageInputRef = useRef(null);
  const messageBottomRef = useRef(null);
  const videoPreviewRef = useRef(null);
  const captureButtonRef = useRef(null);
  const captureMenuRef = useRef(null);
  const captureFirstActionRef = useRef(null);
  const deleteCancelRef = useRef(null);
  const deleteModalRef = useRef(null);
  const deleteReturnFocusRef = useRef(null);
  const lastMessageIdRef = useRef(null);

  const conversation = getConversation(conversationId);
  const messageState = getMessagesState(conversationId);
  const messageList = messageState.items;
  const isLoading = messageState.loading;
  const loadError = messageState.error;

  const releaseMediaEntries = useCallback((entries) => {
    entries.filter((entry) => entry.source === 'new').forEach((entry) => URL.revokeObjectURL(entry.previewUrl));
  }, []);

  const releaseVoiceRecording = useCallback((recording) => {
    if (recording?.previewUrl) URL.revokeObjectURL(recording.previewUrl);
  }, []);

  const handleVoiceReady = useCallback(({ file, durationSeconds }) => {
    setVoiceRecording((current) => {
      releaseVoiceRecording(current);
      return {
        file,
        durationSeconds,
        previewUrl: URL.createObjectURL(file),
      };
    });
    setErrorMessage('');
  }, [releaseVoiceRecording]);

  const handleVoiceError = useCallback((error) => {
    setErrorMessage(error.message || 'Unable to record a voice message.');
  }, []);

  const {
    isStarting: isVoiceStarting,
    isRecording: isVoiceRecording,
    isProcessing: isVoiceProcessing,
    elapsedSeconds: voiceElapsedSeconds,
    startRecording: startVoiceRecording,
    stopRecording: stopVoiceRecording,
    cancelRecording: cancelVoiceRecording,
  } = useVoiceRecorder({
    onRecordingReady: handleVoiceReady,
    onError: handleVoiceError,
  });

  const {
    isStarting: isVideoStarting,
    isRecording: isVideoRecording,
    isProcessing: isVideoProcessing,
    elapsedSeconds: videoElapsedSeconds,
    previewStream: videoPreviewStream,
    startRecording: startVideoRecording,
    stopRecording: stopVideoRecording,
    cancelRecording: cancelVideoRecording,
  } = useVideoRecorder({
    onRecordingReady: (file) => addFiles([file]),
    onError: (error) => setErrorMessage(error.message || 'Unable to record video.'),
  });

  const resetComposer = useCallback(() => {
    setMediaEntries((current) => {
      releaseMediaEntries(current);
      return [];
    });
    setText('');
    setLocation(null);
    setVoiceRecording((current) => {
      releaseVoiceRecording(current);
      return null;
    });
    setEditingMessage(null);
    setErrorMessage('');
    cancelVoiceRecording();
    cancelVideoRecording();
    setIsCaptureMenuOpen(false);
    clearDraft(conversationId);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (photoInputRef.current) photoInputRef.current.value = '';
    if (messageInputRef.current) messageInputRef.current.style.height = '';
  }, [cancelVideoRecording, cancelVoiceRecording, clearDraft, conversationId, releaseMediaEntries, releaseVoiceRecording]);

  useEffect(() => {
    lastMessageIdRef.current = null;
    const draft = getDraft(conversationId);
    setText(draft?.text || '');
    setMediaEntries(draft?.mediaEntries || []);
    setLocation(draft?.location || null);
    setVoiceRecording(draft?.voiceRecording || null);
    setEditingMessage(draft?.editingMessage || null);
    setComposerConversationId(conversationId);
    setErrorMessage('');
    setIsCaptureMenuOpen(false);
    cancelVoiceRecording();
    cancelVideoRecording();
    refreshConversation(conversationId, { markRead: true });
  }, [cancelVideoRecording, cancelVoiceRecording, conversationId, getDraft, refreshConversation]);

  useEffect(() => {
    if (composerConversationId !== conversationId) return;
    saveDraft(conversationId, {
      text,
      mediaEntries,
      location,
      voiceRecording,
      editingMessage,
    });
  }, [composerConversationId, conversationId, editingMessage, location, mediaEntries, saveDraft, text, voiceRecording]);

  useEffect(() => {
    if (!deleteTarget) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !isPending) closeDeleteDialog();
      if (event.key !== 'Tab') return;
      const focusable = [...(deleteModalRef.current?.querySelectorAll('button:not(:disabled)') || [])];
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
    deleteCancelRef.current?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [deleteTarget, isPending]);

  useEffect(() => {
    if (!isCaptureMenuOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeCaptureMenu();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...(captureMenuRef.current?.querySelectorAll('button:not(:disabled)') || [])];
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
    window.setTimeout(() => captureFirstActionRef.current?.focus(), 0);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isCaptureMenuOpen]);

  useEffect(() => {
    const preview = videoPreviewRef.current;
    if (!preview) return undefined;
    preview.srcObject = videoPreviewStream;
    if (videoPreviewStream) void preview.play().catch(() => {});
    return () => {
      preview.srcObject = null;
    };
  }, [videoPreviewStream]);

  useEffect(() => {
    if (!isVideoStarting && !isVideoRecording && !isVideoProcessing) return undefined;
    const handleVideoKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      cancelVideoRecording();
    };
    document.addEventListener('keydown', handleVideoKeyDown);
    return () => document.removeEventListener('keydown', handleVideoKeyDown);
  }, [cancelVideoRecording, isVideoProcessing, isVideoRecording, isVideoStarting]);

  useEffect(() => {
    if (highlightedMessageId) {
      document.getElementById(`message-${highlightedMessageId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (messageList.at(-1)?.id !== lastMessageIdRef.current) {
      messageBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    lastMessageIdRef.current = messageList.at(-1)?.id || null;
  }, [messageList, highlightedMessageId]);

  function addFiles(fileList) {
    const additions = Array.from(fileList || []).map(mediaEntryFromFile);
    try {
      validateMessageDraft({
        text: text || 'draft',
        files: validationFiles([...mediaEntries, ...additions]),
        location,
        voiceRecording,
      });
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
    window.setTimeout(() => messageInputRef.current?.focus(), 0);
  }

  function openCaptureMenu() {
    setIsCaptureMenuOpen(true);
  }

  function closeCaptureMenu(restoreFocus = true) {
    setIsCaptureMenuOpen(false);
    if (restoreFocus) {
      window.setTimeout(() => captureButtonRef.current?.focus(), 0);
    }
  }

  function openCaptureInput(inputRef) {
    // Keep this click inside the user's original tap. Mobile browsers only honour
    // `capture` while the file picker is opened by a direct user gesture. Moving
    // focus back to the camera button can make the picker fall back to Files.
    inputRef.current?.click();
    closeCaptureMenu(false);
  }

  async function openVideoCapture() {
    closeCaptureMenu(false);
    setErrorMessage('');
    try {
      await startVideoRecording();
    } catch (error) {
      setErrorMessage(error.message || 'Unable to start video recording.');
    }
  }

  async function beginVoiceRecording() {
    setErrorMessage('');
    try {
      await startVoiceRecording();
    } catch (error) {
      setErrorMessage(error.message || 'Unable to start voice recording.');
    }
  }

  function removeVoiceRecording() {
    setVoiceRecording((current) => {
      releaseVoiceRecording(current);
      return null;
    });
    setErrorMessage('');
  }

  function openDeleteDialog(message) {
    deleteReturnFocusRef.current = document.activeElement;
    setDeleteTarget(message);
  }

  function closeDeleteDialog() {
    setDeleteTarget(null);
    window.setTimeout(() => deleteReturnFocusRef.current?.focus(), 0);
  }

  function handleComposerKeyDown(event) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (text.trim() || mediaEntries.length || location) submitMessage();
  }

  function resizeComposer(event) {
    const input = event.currentTarget;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 128)}px`;
  }

  async function submitMessage() {
    if (isPending || isVoiceStarting || isVoiceRecording || isVoiceProcessing
        || isVideoStarting || isVideoRecording || isVideoProcessing) return;
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
          voiceRecording: voiceRecording
            ? { file: voiceRecording.file, durationSeconds: voiceRecording.durationSeconds }
            : null,
        });
      }
      resetComposer();
      await refreshConversation(conversationId);
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
      await refreshConversation(conversationId);
    } catch (error) {
      setErrorMessage(error.message || 'Unable to delete message.');
    } finally {
      setIsPending(false);
    }
  }

  if (loadError && !conversation) {
    return (
      <section className="message-chat-window">
        <div className="message-inline-error" role="alert"><p>{loadError}</p><button type="button" onClick={() => refreshConversation(conversationId, { markRead: true })}>Retry</button></div>
      </section>
    );
  }
  if (isLoading || !conversation) {
    return <ChatSkeleton />;
  }

  const hasNormalDraft = Boolean(text.trim() || mediaEntries.length || location);
  const hasDraft = Boolean(hasNormalDraft || voiceRecording);
  const isVoiceBusy = isVoiceStarting || isVoiceRecording || isVoiceProcessing;
  const isVideoBusy = isVideoStarting || isVideoRecording || isVideoProcessing;
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
          <p className="message-chat-header-context">
            <span><span className="message-status-dot" aria-hidden="true" />{conversation.rideStatus ? `${conversation.rideStatus} · ${memberDescription}` : memberDescription}</span>
            {conversation.tripRoute && <span className="message-chat-header-route">{conversation.tripRoute}</span>}
          </p>
        </div>
        <div className="message-chat-header-actions">
          <button type="button" className="message-chat-header-button" onClick={() => onOpenHistory(conversation.id)} aria-label="Open message history" title="Message history"><IconClock size={19} /></button>
          <button type="button" className="message-chat-header-button" onClick={() => onManage(conversation)} aria-label="Manage conversation" title="Manage conversation"><IconMoreVertical size={19} /></button>
        </div>
      </header>

      {loadError && (
        <div className="message-inline-error" role="alert">
          <p>{loadError} Current messages are still shown.</p>
          <button type="button" onClick={() => refreshConversation(conversationId, { markRead: true })}>Retry</button>
        </div>
      )}

      <div className="message-chat-scroll" aria-live="polite">
        {messageList.length ? messageList.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            currentUserId={currentUser.id}
            onEdit={beginEdit}
            onDelete={openDeleteDialog}
            highlighted={message.id === highlightedMessageId}
          />
        )) : <ChatEmptyState />}
        <div ref={messageBottomRef} />
      </div>

      {conversation.isReadOnly ? (
        <footer className="message-read-only-banner"><IconArchive size={17} /> Archived conversations are read-only until they expire.</footer>
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
          <input
            ref={fileInputRef}
            className="message-file-input"
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime"
            onChange={(event) => {
              addFiles(event.target.files);
              event.currentTarget.value = '';
            }}
          />
          <input
            ref={photoInputRef}
            className="message-file-input"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            onChange={(event) => {
              addFiles(event.target.files);
              event.currentTarget.value = '';
            }}
          />
          {isVoiceBusy ? (
            <div className="message-voice-recording-bar" role="status" aria-live="polite">
              <span className={isVoiceRecording ? 'message-voice-recording-dot' : 'message-voice-processing-dot'} aria-hidden="true" />
              <div>
                <strong>
                  {isVoiceStarting
                    ? 'Requesting microphone access…'
                    : isVoiceProcessing
                      ? 'Preparing voice message…'
                      : 'Recording voice message'}
                </strong>
                <span>{formatDuration(voiceElapsedSeconds)} / 3:00</span>
              </div>
              {!isVoiceProcessing && (
                <button type="button" className="message-voice-cancel" onClick={cancelVoiceRecording}>Cancel</button>
              )}
              {isVoiceRecording && (
                <button type="button" className="message-voice-stop" onClick={stopVoiceRecording} aria-label="Stop voice recording" title="Stop recording"><IconStop size={14} /></button>
              )}
            </div>
          ) : (
            <div className="message-composer-inner">
              {voiceRecording ? (
                <div className="message-voice-draft">
                  <IconMicrophone size={18} aria-hidden="true" />
                  <audio src={voiceRecording.previewUrl} controls preload="metadata" aria-label="Voice message preview" />
                  <span>{formatDuration(voiceRecording.durationSeconds)}</span>
                  <button type="button" onClick={removeVoiceRecording} aria-label="Delete voice message draft" title="Delete voice draft"><IconX size={15} /></button>
                </div>
              ) : (
                <>
                  <button type="button" className="message-composer-icon-button" onClick={() => fileInputRef.current?.click()} disabled={isPending} aria-label="Add photos or videos" title="Add photos or videos"><IconPaperclip size={20} /></button>
                  <button ref={captureButtonRef} type="button" className="message-composer-icon-button" onClick={openCaptureMenu} disabled={isPending} aria-label="Open camera options" title="Take photo or record video"><IconCamera size={20} /></button>
                  <button type="button" className={`message-composer-icon-button ${location ? 'message-composer-icon-button-active' : ''}`} onClick={shareCurrentLocation} disabled={isPending || isLocating} aria-label={isLocating ? 'Getting current location' : 'Share current location'} title="Share current location"><IconMapPin size={20} /></button>
                  <div className="message-composer-input-wrap">
                    <textarea
                      ref={messageInputRef}
                      value={text}
                      onChange={(event) => { setText(event.target.value); resizeComposer(event); }}
                      onKeyDown={handleComposerKeyDown}
                      rows="1"
                      maxLength="1000"
                      placeholder="Write a message"
                      aria-label="Message text"
                      aria-describedby={`message-composer-help-${conversation.id}`}
                      disabled={isPending}
                    />
                  </div>
                </>
              )}
              {!editingMessage && !hasDraft ? (
                <button type="button" className="message-send-button message-voice-start-button" onClick={beginVoiceRecording} disabled={isPending} aria-label="Record voice message" title="Record voice message"><IconMicrophone size={19} /></button>
              ) : (
                <button type="button" className={`message-send-button ${hasDraft && !isPending ? 'message-send-button-active' : ''}`} onClick={submitMessage} disabled={!hasDraft || isPending} aria-label={editingMessage ? 'Save edited message' : 'Send message'} title={editingMessage ? 'Save changes' : 'Send message'}><IconSend size={19} /></button>
              )}
            </div>
          )}
          {!voiceRecording && !isVoiceBusy && (
            <div id={`message-composer-help-${conversation.id}`} className="message-composer-help">
              <span>Enter to send · Shift + Enter for a new line</span>
              <span className={text.length >= 900 ? 'message-character-count message-character-count-warning' : 'message-character-count'}>{text.length}/1000</span>
            </div>
          )}
          {errorMessage && <p className="message-composer-error" role="alert" aria-live="assertive">{errorMessage}</p>}
          {isPending && <p className="message-pending-status" role="status" aria-live="polite">{editingMessage ? 'Saving message…' : 'Uploading and sending…'}</p>}
        </footer>
      )}

      {isVideoBusy && (
        <div className="message-video-recorder-backdrop" role="presentation">
          <section className="message-video-recorder" role="dialog" aria-modal="true" aria-labelledby="video-recorder-title">
            <div className="message-video-recorder-header">
              <div>
                <strong id="video-recorder-title">Record video</strong>
                <span>{isVideoStarting ? 'Opening camera…' : isVideoProcessing ? 'Preparing video…' : 'Recording with your device camera'}</span>
              </div>
              {!isVideoProcessing && (
                <button type="button" onClick={cancelVideoRecording} aria-label="Cancel video recording"><IconX size={20} /></button>
              )}
            </div>
            <div className="message-video-recorder-preview">
              <video ref={videoPreviewRef} autoPlay muted playsInline aria-label="Live camera preview" />
              {isVideoRecording && (
                <span className="message-video-recorder-time"><i aria-hidden="true" />{formatDuration(videoElapsedSeconds)}</span>
              )}
              {(isVideoStarting || isVideoProcessing) && (
                <div className="message-video-recorder-status" role="status">
                  {isVideoStarting ? 'Requesting camera access…' : 'Saving recording…'}
                </div>
              )}
            </div>
            <div className="message-video-recorder-actions">
              <button type="button" className="message-video-recorder-cancel" onClick={cancelVideoRecording} disabled={isVideoProcessing}>Cancel</button>
              <button type="button" className="message-video-recorder-stop" onClick={stopVideoRecording} disabled={!isVideoRecording}>
                <IconStop size={15} /> Stop and use video
              </button>
            </div>
            <p>Video is added to your draft after stopping. Maximum size: 50 MB.</p>
          </section>
        </div>
      )}

      {isCaptureMenuOpen && (
        <div className="message-options-backdrop message-capture-backdrop" role="presentation" onMouseDown={closeCaptureMenu}>
          <section ref={captureMenuRef} className="message-options-modal message-capture-modal" role="dialog" aria-modal="true" aria-labelledby="capture-media-title" onMouseDown={(event) => event.stopPropagation()}>
            <span className="message-options-handle" />
            <div className="message-options-header">
              <div><span id="capture-media-title">Create media</span><p>Use your device camera, then review the result before sending.</p></div>
              <button type="button" onClick={closeCaptureMenu} aria-label="Close camera options"><IconX size={18} /></button>
            </div>
            <div className="message-capture-actions">
              <button ref={captureFirstActionRef} type="button" onClick={() => openCaptureInput(photoInputRef)}>
                <IconCamera size={21} />
                <span><strong>Take photo</strong><small>Use the rear camera when available</small></span>
              </button>
              <button type="button" onClick={openVideoCapture}>
                <IconVideo size={21} />
                <span><strong>Record video</strong><small>Up to the existing 50 MB limit</small></span>
              </button>
            </div>
          </section>
        </div>
      )}

      {deleteTarget && (
        <div className="message-options-backdrop" role="presentation" onMouseDown={() => !isPending && closeDeleteDialog()}>
          <section ref={deleteModalRef} className="message-options-modal" role="dialog" aria-modal="true" aria-labelledby="delete-message-title" onMouseDown={(event) => event.stopPropagation()}>
            <span className="message-options-handle" />
            <div className="message-options-header"><div><span id="delete-message-title">Delete this message?</span><p>The complete text, media, location or voice message will be deleted permanently.</p></div><button ref={deleteCancelRef} type="button" onClick={closeDeleteDialog} aria-label="Close delete confirmation"><IconX size={18} /></button></div>
            <div className="message-options-actions">
              <button type="button" className="message-options-cancel" onClick={closeDeleteDialog} disabled={isPending}>Keep message</button>
              <button type="button" className="message-options-delete" onClick={confirmDelete} disabled={isPending}>{isPending ? 'Deleting…' : 'Delete message'}</button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
