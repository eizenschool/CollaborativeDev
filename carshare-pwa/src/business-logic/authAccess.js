export const DEFAULT_AUTH_RETURN_PATH = '/home';

const AUTH_PROFILE_REFRESH_EVENTS = new Set([
  'INITIAL_SESSION',
  'SIGNED_IN',
  'TOKEN_REFRESHED',
  'USER_UPDATED'
]);

export function getAuthProfileRefreshOptions(event) {
  return AUTH_PROFILE_REFRESH_EVENTS.has(event) ? { showLoading: false } : null;
}

export function normaliseInternalReturnPath(value, fallback = DEFAULT_AUTH_RETURN_PATH) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return fallback;
  }
  return value;
}

export function normaliseAuthReturnPath(value) {
  const safePath = normaliseInternalReturnPath(value);
  return safePath.startsWith('/auth') ? DEFAULT_AUTH_RETURN_PATH : safePath;
}

export function resolveAuthReturnPath(state) {
  return normaliseAuthReturnPath(state?.from);
}

export function getAuthNavigation(user, destination, reason = 'Sign in to continue.') {
  const safeDestination = normaliseAuthReturnPath(destination);
  if (user) return { to: safeDestination };
  return {
    to: '/auth',
    state: { from: safeDestination, reason }
  };
}

// Supabase's OAuth redirect (see AuthService.signInWithGoogle) reports a
// failed Google sign-in (denied consent, misconfigured provider, redirect
// URL not allow-listed, etc.) by appending error params to the URL hash
// alongside where a successful `access_token` would otherwise land - it
// never throws inside the app, since the browser navigated away and back.
// Without reading this, a failed round trip looks like nothing happened.
export function parseOAuthHashError(hash) {
  if (typeof hash !== 'string' || hash.length < 2) return null;
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const error = params.get('error');
  if (!error) return null;
  return params.get('error_description') || error;
}
