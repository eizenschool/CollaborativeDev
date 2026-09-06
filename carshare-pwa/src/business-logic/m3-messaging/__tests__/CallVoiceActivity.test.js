import { describe, expect, it } from 'vitest';
import { advanceVoiceActivity, rmsFromTimeDomain } from '../CallVoiceActivity.js';

describe('call voice activity detection', () => {
  it('calculates RMS volume from time-domain samples', () => {
    expect(rmsFromTimeDomain(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5);
    expect(rmsFromTimeDomain(new Float32Array(8))).toBe(0);
  });

  it('requires two loud samples to activate and five quiet samples to release', () => {
    let state = advanceVoiceActivity(null, 0.08);
    expect(state.speaking).toBe(false);
    state = advanceVoiceActivity(state, 0.08);
    expect(state.speaking).toBe(true);

    for (let index = 0; index < 4; index += 1) state = advanceVoiceActivity(state, 0.01);
    expect(state.speaking).toBe(true);
    state = advanceVoiceActivity(state, 0.01);
    expect(state.speaking).toBe(false);
  });

  it('tracks simultaneous speakers independently', () => {
    const first = advanceVoiceActivity(advanceVoiceActivity(null, 0.09), 0.09);
    const second = advanceVoiceActivity(advanceVoiceActivity(null, 0.07), 0.07);
    expect(first.speaking).toBe(true);
    expect(second.speaking).toBe(true);
  });
});
