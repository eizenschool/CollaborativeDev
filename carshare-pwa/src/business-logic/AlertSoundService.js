const RING_INTERVAL_MS = 2_600;
const RINGTONE_VOLUME = 0.12;

export function createAlertSoundService(globalObject = globalThis) {
  let context = null;
  let ringtoneTimerId = null;
  let ringtoneId = null;
  let ringtoneAudible = false;

  function getContext() {
    if (context) return context;
    const AudioContextClass = globalObject.AudioContext || globalObject.webkitAudioContext;
    if (!AudioContextClass) return null;
    context = new AudioContextClass();
    return context;
  }

  async function unlock() {
    const audioContext = getContext();
    if (!audioContext) return false;
    if (audioContext.state === 'suspended') {
      try { await audioContext.resume(); }
      catch { return false; }
    }
    return audioContext.state === 'running';
  }

  function tone(frequency, delaySeconds, durationSeconds, volume = 0.055) {
    const audioContext = getContext();
    if (!audioContext || audioContext.state !== 'running') return false;
    const startAt = audioContext.currentTime + delaySeconds;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + durationSeconds);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + durationSeconds + 0.03);
    return true;
  }

  function playBell() {
    const first = tone(880, 0, 0.22, 0.09);
    const second = tone(1_320, 0.16, 0.34, 0.07);
    return first || second;
  }

  function ringOnce() {
    const first = tone(740, 0, 0.42, RINGTONE_VOLUME);
    const second = tone(740, 0.58, 0.42, RINGTONE_VOLUME);
    return first || second;
  }

  function stopRingtone(requestedId = null) {
    if (requestedId && requestedId !== ringtoneId) return false;
    const stopped = Boolean(ringtoneId || ringtoneTimerId != null);
    if (ringtoneTimerId != null) globalObject.clearInterval(ringtoneTimerId);
    ringtoneTimerId = null;
    ringtoneId = null;
    ringtoneAudible = false;
    return stopped;
  }

  function startRingtone(nextRingtoneId) {
    if (!nextRingtoneId) return false;
    if (ringtoneId === nextRingtoneId && ringtoneTimerId != null) {
      if (!ringtoneAudible && context?.state === 'running') ringtoneAudible = ringOnce();
      return ringtoneAudible;
    }
    stopRingtone();
    ringtoneId = nextRingtoneId;
    ringtoneAudible = ringOnce();
    ringtoneTimerId = globalObject.setInterval(() => {
      ringtoneAudible = ringOnce() || ringtoneAudible;
    }, RING_INTERVAL_MS);
    return ringtoneAudible;
  }

  function dispose() {
    stopRingtone();
    void context?.close?.();
    context = null;
  }

  return {
    unlock,
    playBell,
    startRingtone,
    stopRingtone,
    dispose,
  };
}

export const AlertSoundService = createAlertSoundService();

function ringtoneKey(kind, id) {
  return `${kind}:${id}`;
}

export function createRingtoneCoordinator(soundService = AlertSoundService) {
  let callId = null;
  let callSoundEnabled = false;
  let sosEventId = null;

  return {
    startCall(nextCallId, enabled = true) {
      if (!nextCallId) return false;
      callId = nextCallId;
      callSoundEnabled = Boolean(enabled);
      if (!callSoundEnabled) {
        soundService.stopRingtone(ringtoneKey('call', callId));
        return false;
      }
      if (sosEventId) return true;
      return soundService.startRingtone(ringtoneKey('call', callId));
    },

    stopCall() {
      const stoppedCallId = callId;
      callId = null;
      callSoundEnabled = false;
      return stoppedCallId
        ? soundService.stopRingtone(ringtoneKey('call', stoppedCallId))
        : false;
    },

    setCallSoundEnabled(enabled) {
      callSoundEnabled = Boolean(enabled);
      if (!callId) return false;
      if (!callSoundEnabled) {
        return soundService.stopRingtone(ringtoneKey('call', callId));
      }
      if (sosEventId) return true;
      return soundService.startRingtone(ringtoneKey('call', callId));
    },

    startSOS(nextEventId) {
      if (!nextEventId) return false;
      sosEventId = nextEventId;
      return soundService.startRingtone(ringtoneKey('sos', sosEventId));
    },

    stopSOS(requestedEventId = null) {
      if (!sosEventId || (requestedEventId && requestedEventId !== sosEventId)) return false;
      const stoppedEventId = sosEventId;
      sosEventId = null;
      soundService.stopRingtone(ringtoneKey('sos', stoppedEventId));
      if (callId && callSoundEnabled) {
        return soundService.startRingtone(ringtoneKey('call', callId));
      }
      return true;
    },

    reset() {
      callId = null;
      callSoundEnabled = false;
      sosEventId = null;
      return soundService.stopRingtone();
    },
  };
}
