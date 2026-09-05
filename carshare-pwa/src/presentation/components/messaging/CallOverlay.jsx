import { useCallback, useEffect, useRef, useState } from 'react';
import { useCallSession } from '../../../context/CallSessionContext.jsx';
import { useNotifications } from '../../../context/NotificationContext.jsx';
import { MessagingService } from '../../../business-logic/MessagingService.js';
import {
  IconMaximize,
  IconMicrophone,
  IconMinus,
  IconPhone,
  IconX,
} from '../icons.jsx';
import '../../styles/call.css';

function getInitials(name = 'Member') {
  return name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase();
}

function CallAvatar({ participant }) {
  const [failedUrl, setFailedUrl] = useState(null);
  if (participant?.avatarUrl && failedUrl !== participant.avatarUrl) {
    return (
      <img
        className="call-overlay-avatar"
        src={participant.avatarUrl}
        alt={participant.name}
        referrerPolicy="no-referrer"
        onError={() => setFailedUrl(participant.avatarUrl)}
      />
    );
  }
  return (
    <span className="call-overlay-avatar call-overlay-avatar-fallback" aria-hidden="true">
      {getInitials(participant?.name)}
    </span>
  );
}

function RemoteAudio({ entry, onBlocked }) {
  const ref = useRef(null);
  useEffect(() => {
    const audio = ref.current;
    if (!audio || !entry?.stream) return;
    audio.srcObject = entry.stream;
    void audio.play().catch(() => onBlocked?.());
  }, [entry.stream, onBlocked]);
  return <audio ref={ref} className="call-remote-audio" autoPlay playsInline aria-label="Remote call audio" />;
}

function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function callStatusText(callState, durationSeconds) {
  if (callState.phase === 'incoming') return callState.call?.isGroup ? 'Incoming group voice call' : 'Incoming voice call';
  if (callState.phase === 'outgoing') return callState.call?.isGroup ? 'Calling group…' : 'Calling…';
  if (callState.phase === 'connecting') return 'Connecting securely…';
  if (callState.phase === 'reconnecting') return 'Reconnecting…';
  if (callState.phase === 'connected') return formatDuration(durationSeconds);
  return callState.endedReason || 'Call ended';
}

const PARTICIPANT_STATUS_LABELS = Object.freeze({
  accepted: 'Connected',
  ringing: 'Ringing',
  declined: 'Declined',
  missed: 'Missed',
  left: 'Left',
  failed: 'Failed',
});

function GroupCallParticipant({ participant, isCallActive, isSpeaking }) {
  const isConnected = isCallActive && participant?.status === 'accepted';
  const statusLabel = isSpeaking && isConnected
    ? 'Speaking'
    : (PARTICIPANT_STATUS_LABELS[participant?.status] || 'Unavailable');
  const isUnavailable = ['declined', 'missed', 'left', 'failed'].includes(participant?.status);
  return (
    <div
      className={`call-participant ${isConnected ? 'is-connected' : ''} ${isSpeaking && isConnected ? 'is-speaking' : ''} ${isUnavailable ? 'is-unavailable' : ''}`}
      role="listitem"
      aria-label={`${participant?.name || 'Member'}, ${statusLabel}`}
    >
      <span className="call-participant-avatar-frame">
        <CallAvatar participant={participant} />
        <span className="call-participant-presence" aria-hidden="true" />
        {isSpeaking && isConnected && (
          <span className="call-participant-wave" aria-hidden="true">
            <i /><i /><i />
          </span>
        )}
      </span>
      <strong title={participant?.name}>{participant?.name || 'Member'}</strong>
      <span className="call-participant-label">{statusLabel}</span>
    </div>
  );
}

export default function CallOverlay() {
  const {
    callState,
    speakingUserIds,
    acceptCall,
    declineCall,
    hangUp,
    toggleMute,
    minimizeCall,
    expandCall,
    dismissEndedCall,
  } = useCallSession();
  const { soundBlocked, unlockAlertSounds } = useNotifications();
  const dialogRef = useRef(null);
  const returnFocusRef = useRef(null);
  const phaseRef = useRef(callState.phase);
  const dismissRef = useRef(dismissEndedCall);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [needsAudioTap, setNeedsAudioTap] = useState(false);
  const [conversationInfo, setConversationInfo] = useState(null);
  const handleAudioBlocked = useCallback(() => setNeedsAudioTap(true), []);
  const isOpen = callState.phase !== 'idle' && Boolean(callState.call);
  const isModalOpen = isOpen && !callState.isMinimized;
  phaseRef.current = callState.phase;
  dismissRef.current = dismissEndedCall;

  useEffect(() => {
    const conversationId = callState.call?.conversationId;
    if (!conversationId) {
      setConversationInfo(null);
      return undefined;
    }
    let active = true;
    void MessagingService.getConversation(conversationId)
      .then((conversation) => {
        if (active) setConversationInfo(conversation || null);
      })
      .catch(() => {
        if (active) setConversationInfo(null);
      });
    return () => { active = false; };
  }, [callState.call?.conversationId]);

  useEffect(() => {
    if (!isModalOpen) return undefined;
    returnFocusRef.current = document.activeElement;
    function handleKeyDown(event) {
      if (event.key === 'Escape' && phaseRef.current === 'ended') {
        dismissRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const buttons = [...(dialogRef.current?.querySelectorAll('button:not(:disabled)') || [])];
      if (!buttons.length) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      returnFocusRef.current?.focus?.();
    };
  }, [isModalOpen]);

  useEffect(() => {
    if (!isModalOpen) return;
    window.requestAnimationFrame(() => {
      (dialogRef.current?.querySelector('[data-call-autofocus]') || dialogRef.current)?.focus();
    });
  }, [callState.phase, isModalOpen]);

  useEffect(() => {
    if (callState.phase !== 'connected' || !callState.connectedAt) {
      setDurationSeconds(0);
      return undefined;
    }
    const update = () => setDurationSeconds(
      Math.max(0, Math.floor((Date.now() - callState.connectedAt) / 1000)),
    );
    update();
    const timerId = window.setInterval(update, 1_000);
    return () => window.clearInterval(timerId);
  }, [callState.connectedAt, callState.phase]);

  if (callState.phase === 'idle' || !callState.call) return null;

  const participant = callState.call.otherParticipant;
  const isGroup = callState.call.isGroup;
  const displayName = isGroup
    ? (conversationInfo?.title || 'Group voice call')
    : (participant?.name || 'Member');
  const visibleParticipants = callState.call.participants || [];
  const acceptedCount = visibleParticipants.filter((member) => member.status === 'accepted').length;
  const ringingCount = visibleParticipants.filter((member) => member.status === 'ringing').length;
  const declinedCount = visibleParticipants.filter((member) => member.status === 'declined').length;
  const remoteStreams = callState.remoteStreams?.length
    ? callState.remoteStreams
    : callState.remoteStream ? [{ userId: participant?.id || 'remote', stream: callState.remoteStream }] : [];
  const isIncoming = callState.phase === 'incoming';
  const isEnded = callState.phase === 'ended';
  const showMute = ['outgoing', 'connecting', 'connected', 'reconnecting'].includes(callState.phase);
  const canMinimize = showMute;
  const speakingUsers = new Set(speakingUserIds || []);
  const showSpeaking = ['connected', 'reconnecting'].includes(callState.phase);

  if (callState.isMinimized && canMinimize) {
    return (
      <aside className="call-mini-bar" aria-label={`Active call with ${displayName}`}>
        {remoteStreams.map((entry) => <RemoteAudio key={entry.userId} entry={entry} onBlocked={handleAudioBlocked} />)}
        <CallAvatar participant={participant} />
        <button type="button" className="call-mini-copy" onClick={expandCall} aria-label="Expand call controls">
          <strong>{displayName}</strong>
          <span>{callStatusText(callState, durationSeconds)}</span>
        </button>
        <div className="call-mini-actions">
          <button type="button" className={`call-mini-action ${callState.isMuted ? 'is-active' : ''}`} onClick={toggleMute} aria-label={callState.isMuted ? 'Unmute call' : 'Mute call'}>
            <IconMicrophone size={19} aria-hidden="true" />
          </button>
          <button type="button" className="call-mini-action" onClick={expandCall} aria-label="Expand call controls">
            <IconMaximize size={18} aria-hidden="true" />
          </button>
          <button type="button" className="call-mini-action call-mini-end" onClick={() => { void hangUp(); }} aria-label="End call">
            <IconPhone size={19} aria-hidden="true" />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <div className={`call-overlay-backdrop call-overlay-${callState.phase}`} role="presentation">
      <section
        ref={dialogRef}
        className={`call-overlay-card ${isGroup ? 'call-overlay-card-group' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="call-overlay-title"
        aria-describedby="call-overlay-status"
        tabIndex={-1}
      >
        {canMinimize && (
          <button
            type="button"
            className="call-overlay-minimize"
            onClick={minimizeCall}
            aria-label="Minimize call and continue browsing"
            title="Minimize call and continue browsing"
          >
            <IconMinus size={20} aria-hidden="true" />
          </button>
        )}
        {isEnded && (
          <button type="button" className="call-overlay-close" onClick={dismissEndedCall} aria-label="Dismiss call status">
            <IconX size={19} />
          </button>
        )}
        {isGroup ? (
          <div
            className="call-participant-strip"
            aria-label="Group call participants"
            tabIndex={visibleParticipants.length > 4 ? 0 : undefined}
          >
            <div className="call-participant-row" role="list">
              {visibleParticipants.map((member, index) => (
                <GroupCallParticipant
                  key={member?.id || index}
                  participant={member}
                  isCallActive={!isEnded}
                  isSpeaking={showSpeaking && speakingUsers.has(member?.id)}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="call-overlay-avatar-ring">
            <span className="call-overlay-avatar-slot">
              <CallAvatar participant={participant} />
            </span>
          </div>
        )}
        <div className="call-overlay-copy">
          <span className="call-overlay-eyebrow">{isGroup ? 'Group voice call' : 'Private voice call'}</span>
          <h2 id="call-overlay-title">{displayName}</h2>
          <p id="call-overlay-status" role="status" aria-live="polite">
            {callStatusText(callState, durationSeconds)}
          </p>
          {isGroup && !isEnded && (
            <p className="call-overlay-participant-status">
              {acceptedCount} joined{ringingCount ? ` · ${ringingCount} ringing` : ''}{declinedCount ? ` · ${declinedCount} declined` : ''}
            </p>
          )}
        </div>

        {callState.error && <p className="call-overlay-error" role="alert">{callState.error}</p>}
        {callState.relayNotice && !isEnded && (
          <p className="call-overlay-notice" role="status">{callState.relayNotice}</p>
        )}
        {soundBlocked && callState.phase === 'incoming' && (
          <button type="button" className="call-overlay-audio-permission" onClick={() => { void unlockAlertSounds(); }}>
            Tap to enable ring sound
          </button>
        )}
        {needsAudioTap && remoteStreams.length > 0 && (
          <button
            type="button"
            className="call-overlay-audio-permission"
            onClick={() => {
              const audioElements = [...document.querySelectorAll('.call-remote-audio')];
              void Promise.all(audioElements.map((audio) => audio.play()))
                .then(() => setNeedsAudioTap(false));
            }}
          >
            Tap to hear the call
          </button>
        )}

        {remoteStreams.map((entry) => (
          <RemoteAudio key={entry.userId} entry={entry} onBlocked={handleAudioBlocked} />
        ))}

        {isIncoming ? (
          <div className="call-overlay-actions call-overlay-incoming-actions">
            <button type="button" className="call-control call-control-decline" onClick={() => { void declineCall(); }} disabled={callState.isPending}>
              <span><IconPhone size={23} /></span>
              Reject
            </button>
            <button type="button" className="call-control call-control-accept" data-call-autofocus onClick={() => { void acceptCall(); }} disabled={callState.isPending}>
              <span><IconPhone size={23} /></span>
              {callState.isPending ? 'Opening mic…' : 'Answer'}
            </button>
          </div>
        ) : isEnded ? (
          <button type="button" className="call-overlay-done" data-call-autofocus onClick={dismissEndedCall}>Done</button>
        ) : (
          <div className="call-overlay-actions">
            {showMute && (
              <button type="button" className={`call-control call-control-mute ${callState.isMuted ? 'call-control-muted' : ''}`} onClick={toggleMute}>
                <span><IconMicrophone size={22} /></span>
                {callState.isMuted ? 'Unmute' : 'Mute'}
              </button>
            )}
            <button type="button" className="call-control call-control-decline" data-call-autofocus onClick={() => { void hangUp(); }}>
              <span><IconPhone size={23} /></span>
              End
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
