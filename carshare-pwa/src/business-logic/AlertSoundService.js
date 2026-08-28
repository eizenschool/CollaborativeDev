const RING_INTERVAL_MS = 2_600;
const RINGTONE_VOLUME = 0.12;
export const SOS_RINGTONE_VOLUME_MULTIPLIER = 3;
export const SOS_RINGTONE_VOLUME = RINGTONE_VOLUME * SOS_RINGTONE_VOLUME_MULTIPLIER;

export function normalizeAlertVolume(value, fallback = 1) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.min(1, Math.max(0, numericValue));
}

export function createAlertSoundService(globalObject = globalThis) {
  let context = null;
  let ringtoneTimerId = null;
  let ringtoneId = null;
  let ringtoneAudible = false;
  let ringtoneVolume = 1;
  let ringtonePeakVolume = RINGTONE_VOLUME;

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

  function playBell(volume = 1) {
    const normalizedVolume = normalizeAlertVolume(volume);
    if (normalizedVolume === 0) return false;
    const first = tone(880, 0, 0.22, 0.09 * normalizedVolume);
    const second = tone(1_320, 0.16, 0.34, 0.07 * normalizedVolume);
    return first || second;
  }

  function ringOnce(volume = 1, peakVolume = RINGTONE_VOLUME) {
    const normalizedVolume = normalizeAlertVolume(volume);
    if (normalizedVolume === 0) return false;
    const normalizedPeakVolume = normalizeAlertVolume(peakVolume, RINGTONE_VOLUME);
    const first = tone(740, 0, 0.42, normalizedPeakVolume * normalizedVolume);
    const second = tone(740, 0.58, 0.42, normalizedPeakVolume * normalizedVolume);
    return first || second;
  }

  function stopRingtone(requestedId = null) {
    if (requestedId && requestedId !== ringtoneId) return false;
    const stopped = Boolean(ringtoneId || ringtoneTimerId != null);
    if (ringtoneTimerId != null) globalObject.clearInterval(ringtoneTimerId);
    ringtoneTimerId = null;
    ringtoneId = null;
    ringtoneAudible = false;
    ringtoneVolume = 1;
    ringtonePeakVolume = RINGTONE_VOLUME;
    return stopped;
  }

  function startRingtone(nextRingtoneId, volume = 1, peakVolume = RINGTONE_VOLUME) {
    if (!nextRingtoneId) return false;
    const normalizedVolume = normalizeAlertVolume(volume);
    const normalizedPeakVolume = normalizeAlertVolume(peakVolume, RINGTONE_VOLUME);
    if (normalizedVolume === 0) {
      stopRingtone(nextRingtoneId);
      return false;
    }
    if (ringtoneId === nextRingtoneId && ringtoneTimerId != null) {
      ringtoneVolume = normalizedVolume;
      ringtonePeakVolume = normalizedPeakVolume;
      if (!ringtoneAudible && context?.state === 'running') ringtoneAudible = ringOnce(ringtoneVolume, ringtonePeakVolume);
      return ringtoneAudible;
    }
    stopRingtone();
    ringtoneId = nextRingtoneId;
    ringtoneVolume = normalizedVolume;
    ringtonePeakVolume = normalizedPeakVolume;
    ringtoneAudible = ringOnce(ringtoneVolume, ringtonePeakVolume);
    ringtoneTimerId = globalObject.setInterval(() => {
      ringtoneAudible = ringOnce(ringtoneVolume, ringtonePeakVolume) || ringtoneAudible;
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
    previewRingtone: ringOnce,
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
  let callVolume = 1;
  let sosEventId = null;

  return {
    startCall(nextCallId, enabled = true, volume = callVolume) {
      if (!nextCallId) return false;
      callId = nextCallId;
      callSoundEnabled = Boolean(enabled);
      callVolume = normalizeAlertVolume(volume);
      if (!callSoundEnabled || callVolume === 0) {
        soundService.stopRingtone(ringtoneKey('call', callId));
        return false;
      }
      if (sosEventId) return true;
      return soundService.startRingtone(ringtoneKey('call', callId), callVolume);
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
      if (callVolume === 0) return false;
      if (sosEventId) return true;
      return soundService.startRingtone(ringtoneKey('call', callId), callVolume);
    },

    setCallVolume(volume) {
      callVolume = normalizeAlertVolume(volume);
      if (!callId || !callSoundEnabled) return false;
      if (callVolume === 0) {
        return soundService.stopRingtone(ringtoneKey('call', callId));
      }
      if (sosEventId) return true;
      return soundService.startRingtone(ringtoneKey('call', callId), callVolume);
    },

    startSOS(nextEventId) {
      if (!nextEventId) return false;
      sosEventId = nextEventId;
      return soundService.startRingtone(ringtoneKey('sos', sosEventId), 1, SOS_RINGTONE_VOLUME);
    },

    stopSOS(requestedEventId = null) {
      if (!sosEventId || (requestedEventId && requestedEventId !== sosEventId)) return false;
      const stoppedEventId = sosEventId;
      sosEventId = null;
      soundService.stopRingtone(ringtoneKey('sos', stoppedEventId));
      if (callId && callSoundEnabled && callVolume > 0) {
        return soundService.startRingtone(ringtoneKey('call', callId), callVolume);
      }
      return true;
    },

    reset() {
      callId = null;
      callSoundEnabled = false;
      callVolume = 1;
      sosEventId = null;
      return soundService.stopRingtone();
    },
  };
}
