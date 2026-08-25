import { useEffect, useRef, useState } from 'react';
import { useCallSession } from '../../../context/CallSessionContext.jsx';
import { IconMicrophone, IconPhone, IconX } from '../icons.jsx';
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
  const {
    callState,
    acceptCall,
    declineCall,
    hangUp,
    toggleMute,
    dismissEndedCall,
  } = useCallSession();
  const audioRef = useRef(null);
  const dialogRef = useRef(null);
  const returnFocusRef = useRef(null);
  const phaseRef = useRef(callState.phase);
  const dismissRef = useRef(dismissEndedCall);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [needsAudioTap, setNeedsAudioTap] = useState(false);
  const isOpen = callState.phase !== 'idle' && Boolean(callState.call);
  phaseRef.current = callState.phase;
  dismissRef.current = dismissEndedCall;

  useEffect(() => {
    if (!isOpen) return undefined;
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
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    window.requestAnimationFrame(() => {
      (dialogRef.current?.querySelector('[data-call-autofocus]') || dialogRef.current)?.focus();
    });
  }, [callState.phase, isOpen]);

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
  }, [callState.remoteStream]);

  if (callState.phase === 'idle' || !callState.call) return null;

  const participant = callState.call.otherParticipant;
  const isIncoming = callState.phase === 'incoming';
  const isEnded = callState.phase === 'ended';
  const showMute = ['connecting', 'connected', 'reconnecting'].includes(callState.phase);

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
