// ===== DATA ACCESS LAYER (Tumpang Guide Edge Function adapter) =====
// Only publishable Supabase credentials and the current user's JWT cross this
// boundary. GEMINI_API_KEY is an Edge secret and never enters the browser.
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
    if (!response.ok) {
      const error = new Error(response.status === 429 ? 'Guide rate limit reached.' : 'Guide request failed.');
      error.status = response.status;
      throw error;
    }
    return response.json();
  } finally { clearTimeout(timer); }
}

export function requestGuideTurn(payload, options) { return invoke({ operation: 'turn', ...payload }, options); }
export function requestGuideFeedback(payload, options) { return invoke({ operation: 'feedback', ...payload }, options); }
export function requestGuideLanguagePack(payload, options) { return invoke({ operation: 'language_pack', ...payload }, options); }
export function requestGuideTranslations(payload, options) { return invoke({ operation: 'translate_messages', ...payload }, options); }

export const tumpangGuideEdgeRepository = {
  requestGuideTurn, requestGuideFeedback, requestGuideLanguagePack, requestGuideTranslations
};
