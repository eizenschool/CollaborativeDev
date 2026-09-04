// ===== BUSINESS LOGIC LAYER (Tumpang Guide constants) =====
// Module 6 owns this assistant. Values that affect policy, privacy or QA live
// here so the browser fallback and Edge Function contract can be checked
// against the same named limits.

export const GUIDE_MODE = Object.freeze({
  CLARIFY: 'clarify',
  RECOMMEND: 'recommend',
  HELP: 'help',
  SMALL_TALK: 'small_talk',
  ACTION: 'action',
  PLACE_INFO: 'place_info',
  TRAVEL_INFO: 'travel_info',
  CATALOGUE_MISSING: 'catalogue_missing',
  EMERGENCY: 'emergency',
  FALLBACK: 'fallback'
});

export const GUIDE_LANGUAGE = Object.freeze({
  ENGLISH: 'en',
  CHINESE: 'zh-CN',
  MALAY: 'ms',
  TAMIL: 'ta'
});

export const GUIDE_CORE_LANGUAGES = Object.freeze(Object.values(GUIDE_LANGUAGE));

// These are searchable BCP-47 tags supported by the dynamic language-pack
// endpoint. The four core languages remain available without Gemini so a
// provider outage can never leave the Guide half-translated.
export const GUIDE_LANGUAGES = Object.freeze([
  ...GUIDE_CORE_LANGUAGES,
  'id', 'ja', 'ko', 'fr', 'de', 'es', 'pt-BR', 'it', 'nl', 'ar', 'hi', 'th', 'vi', 'bn', 'ur'
]);

export const GUIDE_ROLE = Object.freeze({
  BEST: 'best_match',
  PRACTICAL: 'practical_alternative',
  WILDCARD: 'wildcard'
});

export const GUIDE_ACTION = Object.freeze({
  OPEN_PLACE: 'open_place',
  FIND_RIDE: 'find_ride',
  RECORD_INTEREST: 'record_interest',
  REGISTER_RIDE_ALERT: 'register_ride_alert',
  SAVE_PREFERENCES: 'save_preferences',
  REQUEST_CATALOGUE: 'request_catalogue',
  OPEN_PROFILE: 'open_profile',
  CALL_EMERGENCY: 'call_emergency'
});

export const GUIDE_REASON = Object.freeze({
  AFFINITY: 'affinity',
  SEASON: 'season',
  QUALITY: 'quality',
  QUIETER: 'headroom',
  LOCAL: 'local',
  SEATS: 'seat_headroom',
  NEARER: 'journey_cost',
  DEMAND: 'demand_convergence',
  WEATHER: 'weather_checked',
  RANGE: 'date_range_consistency'
});

export const GUIDE_TRADEOFF = Object.freeze({
  NONE: 'none',
  NO_RIDE: 'no_ride_yet',
  FARTHER: 'farther_away',
  BUSIER: 'busier_choice',
  THIN_REVIEWS: 'thin_reviews',
  LOWER_PERSONAL_MATCH: 'lower_personal_match'
});

export const GUIDE_LIMITS = Object.freeze({
  AUTHENTICATED_DAILY_TURNS: Number.MAX_SAFE_INTEGER,
  // Spent only by a turn that actually produces a recommendation batch —
  // chatting, place-info answers and search-augmented follow-ups are free
  // even for guests (see supabase/functions/m6-tumpang-guide/index.ts's
  // finalize()).
  GUEST_SESSION_TURNS: 3,
  CONTEXT_TURNS: 6,
  MAX_DATE_RANGE_DAYS: 7,
  // The Edge Function may need an intent pass, catalogue retrieval, and (for
  // place_info) Gemini Search followed by Groq browser search. The old 35s
  // client deadline could abort a healthy fallback while the Edge Function
  // was still working. 110s remains below Supabase's 150s hosted request
  // ceiling and leaves time for a real Gemini -> Groq fallback.
  REQUEST_TIMEOUT_MS: 110_000,
  SESSION_RETENTION_DAYS: 90,
  MAX_MESSAGE_CHARS: 1_200,
  MAX_RECOMMENDATIONS: 3
});

export const GUIDE_MODEL = Object.freeze({
  GENERATION: 'gemini-3.7-flash',
  EMBEDDING: 'gemini-embedding-2-preview',
  EMBEDDING_DIMENSIONS: 768,
  PROMPT_VERSION: 'm6-guide-agent-v3',
  THINKING_LEVEL: 'low'
});

export const GUIDE_STORAGE = Object.freeze({
  FIXTURE_KEY: 'letstumpang_m6_guide_v1',
  ONBOARDING_KEY: 'letstumpang_m6_guide_onboarding_v1',
  LANGUAGE_KEY: 'letstumpang_m6_guide_language_v1',
  SESSION_KEY: 'letstumpang_m6_guide_session_v2',
  SESSION_INDEX_KEY: 'letstumpang_m6_guide_session_index_v1'
});

export const GUIDE_ORIGIN = Object.freeze({
  label: 'Kuala Lumpur',
  lat: 3.139,
  lng: 101.6869
});

const hasBrowserSupabaseConfig = Boolean(
  import.meta.env.VITE_SUPABASE_URL
  && (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY)
);

const fixtureBuild = import.meta.env.MODE === 'fixture';
const explicitFixtureMode = import.meta.env.VITE_TUMPANG_GUIDE_MODE === 'fixture';
// A missing Supabase configuration must not silently turn a normal local build
// into a demo database. The service will provide a clearly-labelled rules
// fallback when the live Edge Function is unavailable instead.
export const GUIDE_FIXTURE_MODE = fixtureBuild || explicitFixtureMode;
export const GUIDE_LIVE_MODE = !GUIDE_FIXTURE_MODE && hasBrowserSupabaseConfig;
// Edge recommendations and browser hydration must use the same catalogue.
// Requiring this explicit source switch prevents a mixed mode where Edge
// returns live Place IDs but the UI tries to hydrate them from mock data.
const hasLiveDiscoverySource = String(import.meta.env.VITE_DISCOVERY_DATA_SOURCE || '')
  .trim().toLowerCase() === 'supabase';
export const GUIDE_LIVE_CATALOGUE_MODE = GUIDE_LIVE_MODE && hasLiveDiscoverySource;

export const GUIDE_FEATURE_ENABLED = import.meta.env.DEV
  || fixtureBuild
  || (import.meta.env.VITE_TUMPANG_GUIDE_ENABLED === 'true' && GUIDE_LIVE_MODE);

// QA controls are visible during local development and still require the
// Edge Function's account allowlist in a deployed environment. This flag is
// presentation-only; it is never treated as an authorization decision.
export const GUIDE_QA_MODE = import.meta.env.DEV
  || fixtureBuild
  || import.meta.env.VITE_TUMPANG_GUIDE_QA_ENABLED === 'true';
