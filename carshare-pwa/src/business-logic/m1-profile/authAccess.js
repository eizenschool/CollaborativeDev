export const DEFAULT_AUTH_RETURN_PATH = '/home';
export const AUTH_BOOTSTRAP_TIMEOUT_MS = 8000;
export const AUTH_RETURN_STORAGE_KEY = 'letstumpang_auth_return_v1';
export const AUTH_RETURN_MAX_AGE_MS = 30 * 60 * 1000;

export function promiseWithTimeout(promise, timeoutMs = AUTH_BOOTSTRAP_TIMEOUT_MS) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error('Authentication is taking longer than expected.'));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

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

function usableStorage(storage) {
  if (storage && typeof storage.getItem === 'function'
    && typeof storage.setItem === 'function' && typeof storage.removeItem === 'function') {
    return storage;
  }
  return null;
}

// OAuth leaves the application and therefore cannot preserve React Router's
// location.state. Keep only a short-lived, validated internal path so the
// callback can return to the exact Guide action that required sign-in.
export function saveAuthReturnPath(path, storage = globalThis?.sessionStorage) {
  const safePath = normaliseAuthReturnPath(path);
  const targetStorage = usableStorage(storage);
  if (!targetStorage || safePath === DEFAULT_AUTH_RETURN_PATH) return false;
  try {
    targetStorage.setItem(AUTH_RETURN_STORAGE_KEY, JSON.stringify({
      path: safePath,
      savedAt: Date.now()
    }));
    return true;
  } catch {
    return false;
  }
}

export function readAuthReturnPath(storage = globalThis?.sessionStorage, now = Date.now()) {
  const targetStorage = usableStorage(storage);
  if (!targetStorage) return null;
  try {
    const saved = JSON.parse(targetStorage.getItem(AUTH_RETURN_STORAGE_KEY) || 'null');
    if (!saved || typeof saved.savedAt !== 'number'
      || now - saved.savedAt < 0 || now - saved.savedAt > AUTH_RETURN_MAX_AGE_MS) {
      targetStorage.removeItem(AUTH_RETURN_STORAGE_KEY);
      return null;
    }
    const safePath = normaliseAuthReturnPath(saved.path);
    if (safePath === DEFAULT_AUTH_RETURN_PATH && saved.path !== DEFAULT_AUTH_RETURN_PATH) {
      targetStorage.removeItem(AUTH_RETURN_STORAGE_KEY);
      return null;
    }
    return safePath;
  } catch {
    try { targetStorage.removeItem(AUTH_RETURN_STORAGE_KEY); } catch { /* best effort */ }
    return null;
  }
}

export function clearAuthReturnPath(storage = globalThis?.sessionStorage) {
  const targetStorage = usableStorage(storage);
  if (!targetStorage) return;
  try { targetStorage.removeItem(AUTH_RETURN_STORAGE_KEY); } catch { /* best effort */ }
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
