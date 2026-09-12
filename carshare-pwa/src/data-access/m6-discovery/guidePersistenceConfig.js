// The Edge Function gives Gemini and Groq one shared 45 second service
// deadline. The browser waits a small amount longer for that controlled
// fallback response before aborting its own request.
export const GUIDE_REQUEST_TIMEOUT_MS = 50_000;
export const GUIDE_SESSION_RETENTION_DAYS = 90;
export const GUIDE_FIXTURE_STORAGE_KEY = 'letstumpang_m6_guide_v1';
