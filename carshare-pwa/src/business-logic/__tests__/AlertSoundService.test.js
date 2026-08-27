import { describe, expect, it, vi } from 'vitest';
import {
  createAlertSoundService,
  createRingtoneCoordinator,
  normalizeAlertVolume,
} from '../AlertSoundService.js';

function soundHarness(state = 'running') {
  const oscillator = {
    type: '',
    frequency: { setValueAtTime: vi.fn() },
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
  const gain = {
    gain: {
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
  };
  const context = {
    state,
    currentTime: 10,
    destination: {},
    resume: vi.fn(async () => { context.state = 'running'; }),
    close: vi.fn(),
    createOscillator: vi.fn(() => oscillator),
    createGain: vi.fn(() => gain),
  };
  const clearInterval = vi.fn();
  const setInterval = vi.fn(() => 42);
  class AudioContext { constructor() { return context; } }
  return {
    context,
    oscillator,
    globalObject: { AudioContext, setInterval, clearInterval },
    setInterval,
    clearInterval,
  };
}

describe('AlertSoundService', () => {
  it('uses a short two-tone bell and a separately scheduled ring-ring ringtone', async () => {
    const harness = soundHarness();
    const service = createAlertSoundService(harness.globalObject);
    await expect(service.unlock()).resolves.toBe(true);
    expect(service.playBell()).toBe(true);
    expect(service.startRingtone('call-1')).toBe(true);
    expect(harness.context.createOscillator).toHaveBeenCalledTimes(4);
    expect(harness.setInterval).toHaveBeenCalledWith(expect.any(Function), 2600);
    service.stopRingtone();
    expect(harness.clearInterval).toHaveBeenCalledWith(42);
  });

  it('applies the three-times sound boost while keeping user volume normalized', async () => {
    const harness = soundHarness();
    const service = createAlertSoundService(harness.globalObject);
    await service.unlock();

    expect(service.playBell(0.5)).toBe(true);
    expect(harness.context.createGain.mock.results[0].value.gain.exponentialRampToValueAtTime)
      .toHaveBeenCalledWith(0.135, 10.02);
    expect(service.previewRingtone(0.25)).toBe(true);
    expect(harness.context.createGain.mock.results[2].value.gain.exponentialRampToValueAtTime)
      .toHaveBeenCalledWith(0.09, 10.02);
    expect(service.playBell(0)).toBe(false);
    expect(service.previewRingtone(0)).toBe(false);
    expect(harness.context.createOscillator).toHaveBeenCalledTimes(4);
  });

  it('normalizes stored and user-provided volume values', () => {
    expect(normalizeAlertVolume('0.45')).toBe(0.45);
    expect(normalizeAlertVolume(-1)).toBe(0);
    expect(normalizeAlertVolume(4)).toBe(1);
    expect(normalizeAlertVolume('invalid')).toBe(1);
  });

  it('unlocks a suspended browser context and does not duplicate the same ringtone', async () => {
    const harness = soundHarness('suspended');
    const service = createAlertSoundService(harness.globalObject);
    await expect(service.unlock()).resolves.toBe(true);
    expect(harness.context.resume).toHaveBeenCalledOnce();
    service.startRingtone('call-1');
    service.startRingtone('call-1');
    expect(harness.setInterval).toHaveBeenCalledOnce();
  });

  it('stops only the ringtone owned by the requested alert id', async () => {
    const harness = soundHarness();
    const service = createAlertSoundService(harness.globalObject);
    await service.unlock();
    service.startRingtone('call:call-1');

    expect(service.stopRingtone('sos:event-1')).toBe(false);
    expect(harness.clearInterval).not.toHaveBeenCalled();
    expect(service.stopRingtone('call:call-1')).toBe(true);
    expect(harness.clearInterval).toHaveBeenCalledWith(42);
  });

  it('rings immediately after a previously blocked context is unlocked', async () => {
    const harness = soundHarness('suspended');
    const service = createAlertSoundService(harness.globalObject);

    expect(service.startRingtone('sos:event-1')).toBe(false);
    expect(harness.context.createOscillator).not.toHaveBeenCalled();
    await service.unlock();
    expect(service.startRingtone('sos:event-1')).toBe(true);
    expect(harness.context.createOscillator).toHaveBeenCalledTimes(2);
    expect(harness.setInterval).toHaveBeenCalledOnce();
  });
});

describe('ringtone coordination', () => {
  it('lets SOS preempt a call and resumes only a still-ringing enabled call', () => {
    const soundService = {
      startRingtone: vi.fn(() => true),
      stopRingtone: vi.fn(() => true),
    };
    const coordinator = createRingtoneCoordinator(soundService);

    expect(coordinator.startCall('call-1', true)).toBe(true);
    expect(coordinator.startSOS('event-1')).toBe(true);
    expect(coordinator.stopSOS('event-1')).toBe(true);
    expect(soundService.startRingtone.mock.calls).toEqual([
      ['call:call-1', 1],
      ['sos:event-1', 1],
      ['call:call-1', 1],
    ]);
  });

  it('does not let call cleanup stop an active SOS ringtone', () => {
    const soundService = {
      startRingtone: vi.fn(() => true),
      stopRingtone: vi.fn(() => true),
    };
    const coordinator = createRingtoneCoordinator(soundService);

    coordinator.startCall('call-1', true);
    coordinator.startSOS('event-1');
    coordinator.stopCall();
    coordinator.stopSOS('event-1');

    expect(soundService.stopRingtone).toHaveBeenNthCalledWith(1, 'call:call-1');
    expect(soundService.stopRingtone).toHaveBeenNthCalledWith(2, 'sos:event-1');
    expect(soundService.startRingtone).toHaveBeenCalledTimes(2);
  });

  it('forces SOS ringing while leaving disabled general call sound silent', () => {
    const soundService = {
      startRingtone: vi.fn(() => true),
      stopRingtone: vi.fn(() => true),
    };
    const coordinator = createRingtoneCoordinator(soundService);

    expect(coordinator.startCall('call-1', false)).toBe(false);
    expect(coordinator.startSOS('event-1')).toBe(true);
    expect(soundService.startRingtone).toHaveBeenCalledOnce();
    expect(soundService.startRingtone).toHaveBeenCalledWith('sos:event-1', 1);
  });

  it('updates active call volume without changing the fixed SOS volume', () => {
    const soundService = {
      startRingtone: vi.fn(() => true),
      stopRingtone: vi.fn(() => true),
    };
    const coordinator = createRingtoneCoordinator(soundService);

    coordinator.startCall('call-1', true, 0.4);
    coordinator.setCallVolume(0.2);
    coordinator.startSOS('event-1');
    coordinator.setCallVolume(0.7);
    coordinator.stopSOS('event-1');

    expect(soundService.startRingtone.mock.calls).toEqual([
      ['call:call-1', 0.4],
      ['call:call-1', 0.2],
      ['sos:event-1', 1],
      ['call:call-1', 0.7],
    ]);
  });
});
