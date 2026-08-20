import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AUTH_RETURN_PATH,
  getAuthNavigation,
  normaliseAuthReturnPath,
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
  });
});
