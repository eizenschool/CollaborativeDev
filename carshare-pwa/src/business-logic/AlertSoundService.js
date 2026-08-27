const RING_INTERVAL_MS = 2_600;

export function createAlertSoundService(globalObject = globalThis) {
  let context = null;
  let ringtoneTimerId = null;
  let ringtoneCallId = null;

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
    const first = tone(880, 0, 0.22, 0.045);
    const second = tone(1_320, 0.16, 0.34, 0.035);
    return first || second;
  }

  function ringOnce() {
    const first = tone(740, 0, 0.42, 0.06);
    const second = tone(740, 0.58, 0.42, 0.06);
    return first || second;
  }

  function stopRingtone() {
    if (ringtoneTimerId) globalObject.clearInterval(ringtoneTimerId);
    ringtoneTimerId = null;
    ringtoneCallId = null;
  }

  function startRingtone(callId) {
    if (!callId) return false;
    if (ringtoneCallId === callId && ringtoneTimerId) return context?.state === 'running';
    stopRingtone();
    ringtoneCallId = callId;
    const played = ringOnce();
    ringtoneTimerId = globalObject.setInterval(ringOnce, RING_INTERVAL_MS);
    return played;
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
