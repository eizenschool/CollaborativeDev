export const DEFAULT_AUTH_RETURN_PATH = '/home';

export function normaliseAuthReturnPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/auth')) {
    return DEFAULT_AUTH_RETURN_PATH;
  }
  return value;
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
