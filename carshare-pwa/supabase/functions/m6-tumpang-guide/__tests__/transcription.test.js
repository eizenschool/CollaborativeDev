import { describe, expect, it } from 'vitest';
import {
  GUIDE_TRANSCRIPTION_MODEL, guideTranscriptionQuality, transcribeGuideAudio
} from '../transcription.ts';

describe('Tumpang Guide Groq transcription', () => {
  it('sends multilingual audio without forcing the UI language', async () => {
    const requests = [];
    const audio = new File([new Uint8Array(256)], 'voice.webm', { type: 'audio/webm' });
    const result = await transcribeGuideAudio({
      apiKey: 'test-key', audio,
      fetchImpl: async (_url, init) => {
        requests.push(init);
        return { ok: true, status: 200, json: async () => ({ text: '我们在 KL。', language: 'zh' }) };
      }
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].body.get('model')).toBe(GUIDE_TRANSCRIPTION_MODEL);
    expect(requests[0].body.get('language')).toBeNull();
    expect(requests[0].body.get('prompt')).toBeNull();
    expect(requests[0].body.get('temperature')).toBe('0');
    expect(requests[0].body.get('timestamp_granularities[]')).toBe('segment');
    expect(result).toMatchObject({ text: '我们在 KL。', language: 'zh' });
  });

  it('uses the user-selected spoken language in one high-accuracy request', async () => {
    let request;
    const audio = new File([new Uint8Array(256)], 'voice.webm', { type: 'audio/webm' });
    const result = await transcribeGuideAudio({
      apiKey: 'test-key', audio, languageHint: 'ms',
      fetchImpl: async (_url, init) => {
        request = init;
        return { ok: true, status: 200, json: async () => ({ text: 'Kami bertiga dari KL.' }) };
      }
    });

    expect(request.body.get('model')).toBe(GUIDE_TRANSCRIPTION_MODEL);
    expect(request.body.get('language')).toBe('ms');
    expect(request.body.get('prompt')).toBeNull();
    expect(result).toMatchObject({ text: 'Kami bertiga dari KL.', language: 'ms' });
  });

  it('rejects oversized recordings before contacting the provider', async () => {
    const audio = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'voice.webm', { type: 'audio/webm' });
    await expect(transcribeGuideAudio({ apiKey: 'test-key', audio })).rejects.toThrow(/too large/i);
  });

  it('rejects repeated catalogue-name hallucinations instead of filling the composer', () => {
    expect(guideTranscriptionQuality({}, "A'Famosa Safari Wanderland, A'Famosa Safari Wanderland, A'Famosa Safari Wanderland"))
      .toMatchObject({ valid: false, repeated: true });
  });

  it('rejects common subtitle/outro hallucinations from a short quiet recording', () => {
    expect(guideTranscriptionQuality({
      segments: [{ start: 0, end: 1.1, no_speech_prob: .3, avg_logprob: -.4, compression_ratio: 1.2 }]
    }, '请不吝点赞 订阅 转发 打赏支持明镜与点点栏目')).toMatchObject({
      valid: false, hallucinatedOutro: true, implausiblyDense: true
    });
  });

  it('accepts a confident genuine short utterance', () => {
    expect(guideTranscriptionQuality({
      segments: [{ start: 0, end: .8, no_speech_prob: .02, avg_logprob: -.12, compression_ratio: 1.1 }]
    }, '测试')).toMatchObject({ valid: true, weakAcousticEvidence: false });
  });

  it('accepts a genuine short mobile utterance despite moderate acoustic scores', () => {
    expect(guideTranscriptionQuality({
      segments: [{ start: 0, end: 1.2, no_speech_prob: .6, avg_logprob: -.8, compression_ratio: 1.1 }]
    }, 'nak pergi Batu Caves')).toMatchObject({
      valid: true, likelySilence: false, lowConfidence: false, weakAcousticEvidence: false
    });
  });

  it('rejects only extreme silence or extreme low confidence on their own', () => {
    expect(guideTranscriptionQuality({
      segments: [{ no_speech_prob: .95, avg_logprob: -.4, compression_ratio: 1.1 }]
    }, 'KL Bird Park')).toMatchObject({ valid: false, likelySilence: true });
    expect(guideTranscriptionQuality({
      segments: [{ no_speech_prob: .1, avg_logprob: -1.6, compression_ratio: 1.1 }]
    }, 'KL Bird Park')).toMatchObject({ valid: false, lowConfidence: true });
  });

  it('rejects combined weak acoustic evidence but accepts text with no segment scores', () => {
    expect(guideTranscriptionQuality({
      segments: [{ start: 0, end: 1, no_speech_prob: .8, avg_logprob: -1.2, compression_ratio: 1.1 }]
    }, 'KL Bird Park')).toMatchObject({ valid: false, weakAcousticEvidence: true });
    expect(guideTranscriptionQuality({}, 'We should go to Batu Caves'))
      .toMatchObject({ valid: true, likelySilence: false, lowConfidence: false, weakAcousticEvidence: false });
  });

  it('returns nonempty text without acoustic metadata for manual draft review', async () => {
    const audio = new File([new Uint8Array(256)], 'voice.webm', { type: 'audio/webm' });
    const result = await transcribeGuideAudio({
      apiKey: 'test-key', audio,
      fetchImpl: async () => ({
        ok: true, status: 200, json: async () => ({ text: 'We should go to Batu Caves' })
      })
    });
    expect(result.text).toBe('We should go to Batu Caves');
  });

  it('attaches acoustic diagnostics to the error when extreme evidence is rejected', async () => {
    const audio = new File([new Uint8Array(256)], 'voice.webm', { type: 'audio/webm' });
    let caught;
    try {
      await transcribeGuideAudio({
        apiKey: 'test-key', audio,
        fetchImpl: async () => ({
          ok: true, status: 200,
          json: async () => ({
            text: 'um',
            segments: [{ start: 0, end: 1, no_speech_prob: .8, avg_logprob: -1.2, compression_ratio: 1.1 }]
          })
        })
      });
    } catch (error) {
      caught = error;
    }
    expect(caught?.code).toBe('transcription_low_confidence');
    expect(caught?.quality).toMatchObject({
      valid: false, weakAcousticEvidence: true, noSpeechAverage: .8, logProbAverage: -1.2
    });
  });
});
