export const VOICE_ACTIVITY_THRESHOLD = 0.04;
export const VOICE_ACTIVITY_ATTACK_SAMPLES = 2;
export const VOICE_ACTIVITY_RELEASE_SAMPLES = 5;

export function rmsFromTimeDomain(samples) {
  if (!samples?.length) return 0;
  let squareTotal = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    squareTotal += sample * sample;
  }
  return Math.sqrt(squareTotal / samples.length);
}

export function advanceVoiceActivity(previous, level, options = {}) {
  const threshold = options.threshold ?? VOICE_ACTIVITY_THRESHOLD;
  const attackSamples = options.attackSamples ?? VOICE_ACTIVITY_ATTACK_SAMPLES;
  const releaseSamples = options.releaseSamples ?? VOICE_ACTIVITY_RELEASE_SAMPLES;
  const loud = Number.isFinite(level) && level >= threshold;
  const next = {
    speaking: Boolean(previous?.speaking),
    loudSamples: loud ? (previous?.loudSamples || 0) + 1 : 0,
    quietSamples: loud ? 0 : (previous?.quietSamples || 0) + 1,
  };

  if (!next.speaking && next.loudSamples >= attackSamples) next.speaking = true;
  if (next.speaking && next.quietSamples >= releaseSamples) next.speaking = false;
  return next;
}
