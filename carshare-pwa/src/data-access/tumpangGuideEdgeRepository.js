// ===== DATA ACCESS LAYER (Tumpang Guide Edge Function adapter) =====
// Only publishable Supabase credentials and the current user's JWT cross this
// boundary. Gemini/Groq API keys are Edge secrets and never enter the browser.
import { supabase } from './supabaseClient.js';
import { GUIDE_LIMITS } from '../business-logic/guide/constants.js';

const baseUrl = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, '') || '';
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  || import.meta.env.VITE_SUPABASE_ANON_KEY || '';

async function invoke(payload, { fetchImpl = globalThis.fetch, timeoutMs = GUIDE_LIMITS.REQUEST_TIMEOUT_MS } = {}) {
  if (!baseUrl || !publishableKey || typeof fetchImpl !== 'function') {
    throw new Error('Tumpang Guide Edge Function is not configured.');
  }
  const session = await supabase?.auth.getSession();
  const accessToken = session?.data?.session?.access_token || null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('guide-timeout'), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}/functions/v1/m6-tumpang-guide`, {
      method: 'POST', signal: controller.signal,
      headers: {
        'content-type': 'application/json', apikey: publishableKey,
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {})
      },
      body: JSON.stringify(payload)
    });
    return parseGuideEdgeResponse(response);
  } finally { clearTimeout(timer); }
}

export async function parseGuideEdgeResponse(response) {
  let body = null;
  try { body = await response.json(); } catch { /* Preserve the HTTP failure below. */ }
  if (response.ok) return body;
  // Quota and controlled provider failures are still complete Guide responses.
  // Returning them preserves the exact server reason and Retry action instead
  // of relabelling every HTTP 429 as a provider quota failure in the browser.
  if (body?.mode && body?.traceId && body?.fallbackReason) return body;
  const error = new Error(response.status === 429 ? 'Guide rate limit reached.' : 'Guide request failed.');
  error.status = response.status;
  error.fallbackReason = body?.fallbackReason || body?.reason || null;
  error.traceId = body?.traceId || null;
  error.edgeVersion = body?.edgeVersion || response.headers?.get?.('x-tumpang-guide-version') || null;
  throw error;
}

export async function requestGuideTranscription(audio, { visitorSessionId, languageHint = 'auto', fetchImpl = globalThis.fetch, timeoutMs = 60_000 } = {}) {
  if (!baseUrl || !publishableKey || typeof fetchImpl !== 'function') throw new Error('Tumpang Guide Edge Function is not configured.');
  if (!(audio instanceof Blob) || audio.size < 100) throw new Error('No speech was recorded.');
  const session = await supabase?.auth.getSession();
  const accessToken = session?.data?.session?.access_token || null;
  const form = new FormData();
  form.append('operation', 'transcribe');
  form.append('visitorSessionId', String(visitorSessionId || ''));
  form.append('languageHint', String(languageHint || 'auto'));
  form.append('audio', audio, `tumpang-guide.${audio.type.includes('ogg') ? 'ogg' : audio.type.includes('mp4') ? 'mp4' : 'webm'}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('guide-voice-timeout'), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}/functions/v1/m6-tumpang-guide`, {
      method: 'POST', signal: controller.signal,
      headers: { apikey: publishableKey, ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
      body: form
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body?.text) {
      const error = new Error(body?.error || 'Voice transcription failed.');
      error.status = response.status;
      error.reason = body?.reason || null;
      throw error;
    }
    return body;
  } finally { clearTimeout(timer); }
}

export async function requestGuideTurn(payload, options) {
  const request = { operation: 'turn', ...payload };
  const deadline = Date.now() + Math.max(5_000, Number(options?.timeoutMs) || GUIDE_LIMITS.REQUEST_TIMEOUT_MS);
  while (Date.now() < deadline) {
    const response = await invoke(request, options);
    if (response?.mode !== 'processing') return response;
    const waitMs = Math.max(300, Math.min(2500, Number(response.retryAfterMs) || 1200));
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  const error = new Error('This Guide turn is still processing.');
  error.fallbackReason = 'processing_timeout';
  throw error;
}
export function requestGuideFeedback(payload, options) { return invoke({ operation: 'feedback', ...payload }, options); }
export function requestGuideLanguagePack(payload, options) { return invoke({ operation: 'language_pack', ...payload }, options); }
export function requestGuideTranslations(payload, options) { return invoke({ operation: 'translate_messages', ...payload }, options); }

export const tumpangGuideEdgeRepository = {
  requestGuideTurn, requestGuideFeedback, requestGuideLanguagePack, requestGuideTranslations, requestGuideTranscription
};
