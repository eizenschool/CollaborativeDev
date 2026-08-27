import { describe, expect, it } from 'vitest';
import {
  AUTH_BOOTSTRAP_TIMEOUT_MS,
  DEFAULT_AUTH_RETURN_PATH,
  getAuthProfileRefreshOptions,
  getAuthNavigation,
  normaliseAuthReturnPath,
  normaliseInternalReturnPath,
  parseOAuthHashError,
  promiseWithTimeout,
  resolveAuthReturnPath
} from '../authAccess.js';

describe('public-first authentication navigation', () => {
  it('sends guests to auth while preserving the requested internal service', () => {
    expect(getAuthNavigation(null, '/ride/ride-1', 'Sign in to join.')).toEqual({
      to: '/auth',
      state: { from: '/ride/ride-1', reason: 'Sign in to join.' }
    });
  });

  it('lets signed-in users continue directly to the requested service', () => {
    expect(getAuthNavigation({ id: 'user-1' }, '/message')).toEqual({ to: '/message' });
  });

  it('accepts local return paths and rejects auth loops or external redirects', () => {
    expect(resolveAuthReturnPath({ from: '/profile?panel=settings' })).toBe('/profile?panel=settings');
    expect(normaliseAuthReturnPath('/auth')).toBe(DEFAULT_AUTH_RETURN_PATH);
    expect(normaliseAuthReturnPath('//example.com')).toBe(DEFAULT_AUTH_RETURN_PATH);
    expect(normaliseAuthReturnPath('https://example.com')).toBe(DEFAULT_AUTH_RETURN_PATH);
    expect(normaliseAuthReturnPath('/search\\evil')).toBe(DEFAULT_AUTH_RETURN_PATH);
  });

  it('validates ride-detail return paths with a caller-selected fallback', () => {
    expect(normaliseInternalReturnPath('/search?pickup=KL+Sentral', '/search')).toBe('/search?pickup=KL+Sentral');
    expect(normaliseInternalReturnPath('/favourite', '/search')).toBe('/favourite');
    expect(normaliseInternalReturnPath('//example.com', '/search')).toBe('/search');
    expect(normaliseInternalReturnPath('https://example.com', '/search')).toBe('/search');
  });
});

describe('reading a failed Google OAuth round trip off the URL', () => {
  it('reads the human-readable description Supabase appends to the hash', () => {
    expect(parseOAuthHashError('#error=server_error&error_description=Unable+to+exchange+code')).toBe(
      'Unable to exchange code'
    );
  });

  it('falls back to the bare error code when no description is present', () => {
    expect(parseOAuthHashError('#error=access_denied')).toBe('access_denied');
  });

  it('returns null for a successful callback or an unrelated hash', () => {
    expect(parseOAuthHashError('#access_token=abc&token_type=bearer')).toBeNull();
    expect(parseOAuthHashError('')).toBeNull();
    expect(parseOAuthHashError(undefined)).toBeNull();
  });
});

describe('Supabase auth-state profile refresh', () => {
  it('refreshes profile data for session events that can arrive after returning to a tab', () => {
    expect(getAuthProfileRefreshOptions('INITIAL_SESSION')).toEqual({ showLoading: false });
    expect(getAuthProfileRefreshOptions('SIGNED_IN')).toEqual({ showLoading: false });
    expect(getAuthProfileRefreshOptions('TOKEN_REFRESHED')).toEqual({ showLoading: false });
    expect(getAuthProfileRefreshOptions('USER_UPDATED')).toEqual({ showLoading: false });
  });

  it('does not treat sign-out or unrelated events as profile refreshes', () => {
    expect(getAuthProfileRefreshOptions('SIGNED_OUT')).toBeNull();
    expect(getAuthProfileRefreshOptions('PASSWORD_RECOVERY')).toBeNull();
    expect(getAuthProfileRefreshOptions(undefined)).toBeNull();
  });
});

describe('bounded auth recovery', () => {
  it('uses an eight-second ceiling for the initial auth screen', () => {
    expect(AUTH_BOOTSTRAP_TIMEOUT_MS).toBe(8000);
  });

  it('returns a completed auth request without waiting for the ceiling', async () => {
    await expect(promiseWithTimeout(Promise.resolve({ id: 'user-1' }), 20))
      .resolves.toEqual({ id: 'user-1' });
  });

  it('rejects a stuck auth request so the UI can offer retry', async () => {
    await expect(promiseWithTimeout(new Promise(() => {}), 5))
      .rejects.toThrow('Authentication is taking longer than expected.');
  });
});
