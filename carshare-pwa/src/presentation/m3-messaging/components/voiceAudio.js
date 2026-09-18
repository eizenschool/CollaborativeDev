const VOICE_SAMPLE_RATE = 16000;

function writeAscii(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function sampleAt(chunks, sampleIndex, state) {
  while (
    state.chunkIndex < chunks.length
    && sampleIndex >= state.chunkStart + chunks[state.chunkIndex].length
  ) {
    state.chunkStart += chunks[state.chunkIndex].length;
    state.chunkIndex += 1;
  }
  if (state.chunkIndex >= chunks.length) return 0;
  return chunks[state.chunkIndex][sampleIndex - state.chunkStart] || 0;
}

export function createVoiceWav(chunks, inputSampleRate) {
  const cleanChunks = (chunks || []).filter((chunk) => chunk?.length);
  const totalInputSamples = cleanChunks.reduce((total, chunk) => total + chunk.length, 0);
  if (!totalInputSamples || !Number.isFinite(inputSampleRate) || inputSampleRate <= 0) {
    throw new Error('The voice recording is empty. Please record it again.');
  }

  const outputSampleRate = Math.min(VOICE_SAMPLE_RATE, Math.round(inputSampleRate));
  const ratio = inputSampleRate / outputSampleRate;
  const outputSamples = Math.max(1, Math.floor(totalInputSamples / ratio));
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + outputSamples * bytesPerSample);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + outputSamples * bytesPerSample, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, outputSampleRate, true);
  view.setUint32(28, outputSampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, outputSamples * bytesPerSample, true);

  const state = { chunkIndex: 0, chunkStart: 0 };
  for (let outputIndex = 0; outputIndex < outputSamples; outputIndex += 1) {
    const inputStart = Math.floor(outputIndex * ratio);
    const inputEnd = Math.max(inputStart + 1, Math.floor((outputIndex + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let inputIndex = inputStart; inputIndex < inputEnd; inputIndex += 1) {
      sum += sampleAt(cleanChunks, inputIndex, state);
      count += 1;
    }
    const sample = Math.max(-1, Math.min(1, sum / count));
    view.setInt16(
      44 + outputIndex * bytesPerSample,
      sample < 0 ? sample * 0x8000 : sample * 0x7fff,
      true,
    );
  }

  return {
    blob: new Blob([buffer], { type: 'audio/wav' }),
    durationSeconds: totalInputSamples / inputSampleRate,
    sampleRate: outputSampleRate,
  };
}

