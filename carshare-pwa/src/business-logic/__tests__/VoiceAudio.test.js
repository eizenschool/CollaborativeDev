import { describe, expect, it } from 'vitest';
import { createVoiceWav } from '../../presentation/components/messaging/voiceAudio.js';

function ascii(view, start, length) {
  return Array.from({ length }, (_, index) =>
    String.fromCharCode(view.getUint8(start + index))).join('');
}

describe('voice WAV encoding', () => {
  it('creates a playable 16 kHz mono PCM WAV with an accurate duration', async () => {
    const firstHalf = new Float32Array(24000).fill(0.25);
    const secondHalf = new Float32Array(24000).fill(-0.25);
    const result = createVoiceWav([firstHalf, secondHalf], 48000);
    const view = new DataView(await result.blob.arrayBuffer());

    expect(result.blob.type).toBe('audio/wav');
    expect(result.durationSeconds).toBe(1);
    expect(result.sampleRate).toBe(16000);
    expect(result.blob.size).toBe(44 + 16000 * 2);
    expect(ascii(view, 0, 4)).toBe('RIFF');
    expect(ascii(view, 8, 4)).toBe('WAVE');
    expect(ascii(view, 36, 4)).toBe('data');
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(34, true)).toBe(16);
  });

  it('rejects an empty recording', () => {
    expect(() => createVoiceWav([], 48000)).toThrow('voice recording is empty');
  });
});

