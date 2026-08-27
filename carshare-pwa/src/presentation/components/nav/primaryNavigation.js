import { getAuthNavigation } from '../../../business-logic/authAccess.js';
import {
  IconClock,
  IconHeart,
  IconHome,
  IconMessage,
  IconRoute,
  IconSearch,
  IconUser
} from '../icons.jsx';

export const PRIMARY_NAV_ITEMS = Object.freeze([
  Object.freeze({ to: '/home', label: 'Home', Icon: IconHome }),
  Object.freeze({ to: '/search', label: 'Search', Icon: IconSearch }),
  Object.freeze({ to: '/ride', label: 'Ride', Icon: IconRoute, requiresAuth: true }),
  Object.freeze({ to: '/trip', label: 'Trips', Icon: IconClock, requiresAuth: true }),
  Object.freeze({ to: '/message', label: 'Message', Icon: IconMessage, requiresAuth: true }),
  Object.freeze({ to: '/favourite', label: 'Favourite', Icon: IconHeart, requiresAuth: true }),
  Object.freeze({ to: '/profile', label: 'Profile', Icon: IconUser, requiresAuth: true })
]);

function normalisePrimaryPath(pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/')) return null;
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
  return pathname;
}

export function getPrimaryNavigationIndex(pathname) {
  const normalised = normalisePrimaryPath(pathname);
  return PRIMARY_NAV_ITEMS.findIndex((item) => item.to === normalised);
}

export function resolveSwipeDestination(pathname, direction, user) {
  const currentIndex = getPrimaryNavigationIndex(pathname);
  if (currentIndex < 0 || !['next', 'previous'].includes(direction)) return null;

  const targetIndex = currentIndex + (direction === 'next' ? 1 : -1);
  const item = PRIMARY_NAV_ITEMS[targetIndex];
  if (!item) return null;

  const target = item.requiresAuth
    ? getAuthNavigation(user, item.to, `Sign in to open ${item.label}.`)
    : { to: item.to };

  return {
    ...target,
    direction,
    index: targetIndex,
    label: item.label
  };
}
