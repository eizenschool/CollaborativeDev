import { describe, expect, it, vi } from 'vitest';
import { createAlertSoundService } from '../AlertSoundService.js';

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

  it('unlocks a suspended browser context and does not duplicate the same ringtone', async () => {
    const harness = soundHarness('suspended');
    const service = createAlertSoundService(harness.globalObject);
    await expect(service.unlock()).resolves.toBe(true);
    expect(harness.context.resume).toHaveBeenCalledOnce();
    service.startRingtone('call-1');
    service.startRingtone('call-1');
    expect(harness.setInterval).toHaveBeenCalledOnce();
  });
});
