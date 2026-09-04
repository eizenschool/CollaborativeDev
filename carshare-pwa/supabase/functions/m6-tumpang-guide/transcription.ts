export const GUIDE_TRANSCRIPTION_MODEL = "whisper-large-v3";
export const GUIDE_TRANSCRIPTION_DETECTION_MODEL = "whisper-large-v3-turbo";

const LANGUAGE_ALIASES: Record<string, string> = {
  en: "en", english: "en", ms: "ms", malay: "ms", "bahasa melayu": "ms",
  zh: "zh", chinese: "zh", mandarin: "zh", ta: "ta", tamil: "ta"
};

function normaliseLanguageHint(value: unknown) {
  return LANGUAGE_ALIASES[String(value || "").trim().toLowerCase()] || "";
}

async function requestTranscription({ apiKey, audio, model, language, fetchImpl, timeoutMs }: {
  apiKey: string; audio: File; model: string; language?: string; fetchImpl: typeof fetch;
  timeoutMs?: number;
}) {
  const form = new FormData();
  form.append("file", audio, audio.name || "tumpang-guide.webm");
  form.append("model", model);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");
  form.append("temperature", "0");
  if (language) form.append("language", language);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs || 45_000);
  try {
    const response = await fetchImpl("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST", signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}` }, body: form
    });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      const error = new Error(`Groq transcription failed with status ${response.status}.`) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    return body;
  } finally { clearTimeout(timeout); }
}

function repeatedTranscript(text: string) {
  const parts = text.split(/\s*[,;|]\s*|\s+[.!?]\s+/u)
    .map((part) => part.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim())
    .filter((part) => part.length >= 3);
  return parts.length >= 2 && new Set(parts).size < parts.length;
}

function knownWhisperHallucination(text: string) {
  return /(?:请不吝|請不吝|点赞|點讚|订阅|訂閱|转发|轉發|打赏|打賞|明镜与点点|明鏡與點點|谢谢观看|謝謝觀看|字幕(?:由|提供)|感谢收看|感謝收看|thanks\s+for\s+watching|like\s+and\s+subscribe|subscribe\s+to|amara\.org)/iu.test(text);
}

function transcriptDuration(body: Record<string, unknown>, segments: Array<Record<string, unknown>>) {
  const declared = Number(body.duration);
  if (Number.isFinite(declared) && declared > 0) return declared;
  const starts = segments.map((segment) => Number(segment.start)).filter(Number.isFinite);
  const ends = segments.map((segment) => Number(segment.end)).filter(Number.isFinite);
  return starts.length && ends.length ? Math.max(...ends) - Math.min(...starts) : 0;
}

export function guideTranscriptionQuality(body: Record<string, unknown>, text: string) {
  const segments = Array.isArray(body.segments)
    ? body.segments.filter((item) => item && typeof item === "object") as Array<Record<string, unknown>> : [];
  const noSpeech = segments.map((segment) => Number(segment.no_speech_prob)).filter(Number.isFinite);
  const logProb = segments.map((segment) => Number(segment.avg_logprob)).filter(Number.isFinite);
  const compression = segments.map((segment) => Number(segment.compression_ratio)).filter(Number.isFinite);
  const noSpeechAverage = noSpeech.length ? noSpeech.reduce((sum, value) => sum + value, 0) / noSpeech.length : 0;
  const logProbAverage = logProb.length ? logProb.reduce((sum, value) => sum + value, 0) / logProb.length : 0;
  const duration = transcriptDuration(body, segments);
  const spokenUnits = [...text.replace(/[\s\p{P}\p{S}]/gu, "")].length;
  const likelySilence = noSpeech.length > 0 && noSpeechAverage >= .65;
  const lowConfidence = logProb.length > 0 && logProbAverage < -1;
  const overCompressed = compression.some((value) => value > 2.4);
  const repeated = repeatedTranscript(text);
  const hallucinatedOutro = knownWhisperHallucination(text);
  const implausiblyDense = duration > 0 && duration <= 4
    && spokenUnits > Math.max(18, Math.ceil(duration * 14));
  const uncertainShortUtterance = duration > 0 && duration <= 2.5
    && ((logProb.length > 0 && logProbAverage < -.55) || (noSpeech.length > 0 && noSpeechAverage > .35));
  return {
    valid: Boolean(text) && !likelySilence && !lowConfidence && !overCompressed && !repeated
      && !hallucinatedOutro && !implausiblyDense && !uncertainShortUtterance,
    likelySilence, lowConfidence, overCompressed, repeated, hallucinatedOutro,
    implausiblyDense, uncertainShortUtterance, duration
  };
}

export async function transcribeGuideAudio({
  apiKey, audio,
  languageHint = "auto",
  fetchImpl = fetch,
  timeoutMs = 45_000
}: {
  apiKey: string; audio: File; languageHint?: string; fetchImpl?: typeof fetch; timeoutMs?: number;
}) {
  if (!apiKey) throw new Error("Groq transcription is not configured.");
  if (!(audio instanceof File) || audio.size < 100) throw new Error("The audio recording is empty.");
  if (audio.size > 5 * 1024 * 1024) throw new Error("The audio recording is too large.");
  if (!/^audio\/(?:webm|ogg|mp4|mpeg|wav|x-wav|flac|m4a)/i.test(audio.type || "audio/webm")) {
    throw new Error("The audio format is not supported.");
  }

  const explicitLanguage = normaliseLanguageHint(languageHint);
  // Whisper's prompt is prior transcript context, not a keyword dictionary.
  // Supplying catalogue place names causes short utterances and quiet audio to
  // hallucinate those names. Use one clean high-accuracy pass instead.
  const body = await requestTranscription({
    apiKey, audio, model: GUIDE_TRANSCRIPTION_MODEL,
    ...(explicitLanguage ? { language: explicitLanguage } : {}), fetchImpl, timeoutMs
  });
  const detectedLanguage = explicitLanguage || normaliseLanguageHint(body.language);
  const text = String(body.text || "").replace(/\s+/g, " ").trim();
  if (!text) throw new Error("No speech was recognised.");
  const quality = guideTranscriptionQuality(body, text);
  if (!quality.valid) {
    const error = new Error("The transcription was too uncertain to use.") as Error & { code?: string };
    error.code = "transcription_low_confidence";
    throw error;
  }
  return { text, language: detectedLanguage || String(body.language || "").trim() || null,
    model: GUIDE_TRANSCRIPTION_MODEL };
}
