import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCallSession } from '../../../context/CallSessionContext.jsx';
import { useNotifications } from '../../../context/NotificationContext.jsx';
import { MessagingService } from '../../../business-logic/MessagingService.js';
import {
  IconCar,
  IconMaximize,
  IconMessage,
  IconMicrophone,
  IconMinus,
  IconPhone,
  IconRoute,
  IconUser,
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

function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function callStatusText(callState, durationSeconds) {
  if (callState.phase === 'incoming') return 'Incoming voice call';
  if (callState.phase === 'outgoing') return 'Calling…';
  if (callState.phase === 'connecting') return 'Connecting securely…';
  if (callState.phase === 'reconnecting') return 'Reconnecting…';
  if (callState.phase === 'connected') return formatDuration(durationSeconds);
  return callState.endedReason || 'Call ended';
}

export default function CallOverlay() {
  const navigate = useNavigate();
  const {
    callState,
    acceptCall,
    declineCall,
    hangUp,
    toggleMute,
    minimizeCall,
    expandCall,
    dismissEndedCall,
  } = useCallSession();
  const { soundBlocked, unlockAlertSounds } = useNotifications();
  const audioRef = useRef(null);
  const dialogRef = useRef(null);
  const returnFocusRef = useRef(null);
  const phaseRef = useRef(callState.phase);
  const dismissRef = useRef(dismissEndedCall);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [needsAudioTap, setNeedsAudioTap] = useState(false);
  const [rideId, setRideId] = useState(null);
  const isOpen = callState.phase !== 'idle' && Boolean(callState.call);
  const isModalOpen = isOpen && !callState.isMinimized;
  phaseRef.current = callState.phase;
  dismissRef.current = dismissEndedCall;

  useEffect(() => {
    const conversationId = callState.call?.conversationId;
    if (!conversationId) {
      setRideId(null);
      return undefined;
    }
    let active = true;
    void MessagingService.getConversation(conversationId)
      .then((conversation) => {
        if (active) setRideId(conversation?.rideId || null);
      })
      .catch(() => {
        if (active) setRideId(null);
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

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !callState.remoteStream) return;
    audio.srcObject = callState.remoteStream;
    void audio.play()
      .then(() => setNeedsAudioTap(false))
      .catch(() => setNeedsAudioTap(true));
  }, [callState.isMinimized, callState.remoteStream]);

  if (callState.phase === 'idle' || !callState.call) return null;

  const participant = callState.call.otherParticipant;
  const isIncoming = callState.phase === 'incoming';
  const isEnded = callState.phase === 'ended';
  const showMute = ['outgoing', 'connecting', 'connected', 'reconnecting'].includes(callState.phase);
  const canMinimize = showMute;
  const browseTo = (path) => {
    minimizeCall();
    navigate(path);
  };
  const browseActions = [
    {
      key: 'chat',
      label: 'Chat',
      path: `/message/${callState.call.conversationId}`,
      icon: IconMessage,
    },
    {
      key: 'ride',
      label: rideId ? 'Ride details' : 'Rides',
      path: rideId ? `/ride/${rideId}` : '/ride',
      icon: IconCar,
    },
    { key: 'trips', label: 'Trips', path: '/trip', icon: IconRoute },
    ...(participant?.id ? [{
      key: 'profile',
      label: 'Profile',
      path: `/users/${participant.id}`,
      icon: IconUser,
    }] : []),
  ];

  if (callState.isMinimized && canMinimize) {
    return (
      <aside className="call-mini-bar" aria-label={`Active call with ${participant?.name || 'Member'}`}>
        <audio ref={audioRef} autoPlay playsInline aria-label="Remote call audio" />
        <CallAvatar participant={participant} />
        <button type="button" className="call-mini-copy" onClick={expandCall} aria-label="Expand call controls">
          <strong>{participant?.name || 'Member'}</strong>
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
        <nav className="call-mini-browse" aria-label="Browse during call">
          {browseActions.slice(0, 3).map(({ key, label, path, icon: Icon }) => (
            <button key={key} type="button" onClick={() => browseTo(path)}>
              <Icon size={15} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </aside>
    );
  }

  return (
    <div className={`call-overlay-backdrop call-overlay-${callState.phase}`} role="presentation">
      <section
        ref={dialogRef}
        className="call-overlay-card"
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
            <span>Minimize &amp; browse</span>
          </button>
        )}
        {isEnded && (
          <button type="button" className="call-overlay-close" onClick={dismissEndedCall} aria-label="Dismiss call status">
            <IconX size={19} />
          </button>
        )}
        <div className="call-overlay-avatar-ring"><CallAvatar participant={participant} /></div>
        <div className="call-overlay-copy">
          <span className="call-overlay-eyebrow">Private ride chat</span>
          <h2 id="call-overlay-title">{participant?.name || 'Member'}</h2>
          <p id="call-overlay-status" role="status" aria-live="polite">
            {callStatusText(callState, durationSeconds)}
          </p>
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
        {needsAudioTap && callState.remoteStream && (
          <button
            type="button"
            className="call-overlay-audio-permission"
            onClick={() => {
              void audioRef.current?.play().then(() => setNeedsAudioTap(false));
            }}
          >
            Tap to hear the call
          </button>
        )}

        <audio ref={audioRef} autoPlay playsInline aria-label="Remote call audio" />

        {!isIncoming && !isEnded && (
          <nav className="call-browse-actions" aria-label="View information during call">
            <span>View while calling</span>
            <div>
              {browseActions.map(({ key, label, path, icon: Icon }) => (
                <button key={key} type="button" onClick={() => browseTo(path)}>
                  <Icon size={17} aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>
          </nav>
        )}

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
