import { describe, expect, it } from 'vitest';
import {
  PRIMARY_NAV_ITEMS,
  getPrimaryNavigationIndex,
  resolveSwipeDestination
} from '../primaryNavigation.js';

const paths = ['/home', '/search', '/ride', '/trip', '/message', '/favourite', '/profile'];

describe('primary navigation order', () => {
  it('keeps the shared navigation in the accepted seven-destination order', () => {
    expect(PRIMARY_NAV_ITEMS.map((item) => item.to)).toEqual(paths);
  });

  it('resolves every next and previous neighbour without wrapping', () => {
    paths.slice(0, -1).forEach((pathname, index) => {
      expect(resolveSwipeDestination(pathname, 'next', { id: 'user-1' })?.to).toBe(paths[index + 1]);
    });
    paths.slice(1).forEach((pathname, index) => {
      expect(resolveSwipeDestination(pathname, 'previous', { id: 'user-1' })?.to).toBe(paths[index]);
    });

    expect(resolveSwipeDestination('/home', 'previous', { id: 'user-1' })).toBeNull();
    expect(resolveSwipeDestination('/profile', 'next', { id: 'user-1' })).toBeNull();
  });

  it('does not apply primary swipe navigation to detail or form routes', () => {
    expect(getPrimaryNavigationIndex('/ride/ride-1')).toBe(-1);
    expect(resolveSwipeDestination('/ride/ride-1', 'next', { id: 'user-1' })).toBeNull();
    expect(resolveSwipeDestination('/message/conversation-1', 'previous', { id: 'user-1' })).toBeNull();
  });

  it('uses the existing authentication return contract for protected targets', () => {
    expect(resolveSwipeDestination('/search', 'next', null)).toEqual({
      to: '/auth',
      state: { from: '/ride', reason: 'Sign in to open Ride.' },
      direction: 'next',
      index: 2,
      label: 'Ride'
    });
  });
});
