// ===== BUSINESS LOGIC LAYER (mediaMode) =====
// A device-level setting: whether billable/heavy media - Google Place Photos
// and the interactive Street View embed - loads automatically, or only when
// asked for.
//
// Off by default and persisted. Not DiscoveryDemoControls.js's pattern: that
// state is module-level only, deliberately reset by every reload, because it
// exists to demonstrate a rule for one session. This exists to solve a
// student's Places Photo quota draining from ordinary dev reloads, so
// surviving a reload is the entire point - the opposite requirement.
//
// Not routed through discoveryStore.js's per-user `preferences` slice either:
// that is per signed-in user, asynchronous, and reached through
// DestinationDiscoveryService. This is a device setting - it applies before
// sign-in, and every image slot needs to read it synchronously during render.
//
// Reviews, ratings, descriptions and coordinates are not gated by this at all
// - they are Supabase column reads with no per-view cost (see
// docs/MODULE6-API-SETUP.md §3.3), so gating them would only make the demo
// harder to use for no saving. Only the two things that actually cost
// something (or, for Street View, feel slow to reload) are gated.

const STORAGE_KEY = 'letstumpang_discovery_media_v1';

export const MEDIA_MODE = { ON: 'on', OFF: 'off' };

function storage() {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

/**
 * `'on'` or `'off'`. Off whenever storage is unavailable, empty, or holds
 * anything other than the exact `'on'` string - a corrupted or foreign value
 * must not silently start spending quota. Read fresh from storage on every
 * call rather than cached in a module variable, so there is exactly one
 * source of truth and no separate state to fall out of sync with it.
 */
export function getMediaMode() {
  const s = storage();
  if (!s) return MEDIA_MODE.OFF;
  try {
    return s.getItem(STORAGE_KEY) === MEDIA_MODE.ON ? MEDIA_MODE.ON : MEDIA_MODE.OFF;
  } catch {
    return MEDIA_MODE.OFF;
  }
}

export function isMediaEnabled() {
  return getMediaMode() === MEDIA_MODE.ON;
}

const listeners = new Set();

/**
 * Ignores anything that is not a recognised mode, the same "do not
 * half-enable" rule `DiscoveryDemoControls.setWeatherOverride` follows.
 */
export function setMediaMode(next) {
  if (next !== MEDIA_MODE.ON && next !== MEDIA_MODE.OFF) return getMediaMode();

  const s = storage();
  if (s) {
    try {
      s.setItem(STORAGE_KEY, next);
    } catch {
      // A full or unavailable localStorage must not break browsing.
    }
  }
  listeners.forEach((listener) => listener());
  return next;
}

export function toggleMediaMode() {
  return setMediaMode(isMediaEnabled() ? MEDIA_MODE.OFF : MEDIA_MODE.ON);
}

/** For `useSyncExternalStore`. Returns an unsubscribe function. */
export function subscribeMediaMode(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test hook, so one case's toggle cannot leak into the next. */
export function __resetMediaMode() {
  listeners.clear();
  const s = storage();
  if (s) {
    try {
      s.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}
