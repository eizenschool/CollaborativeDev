export const DEFAULT_AUTH_RETURN_PATH = '/home';

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
