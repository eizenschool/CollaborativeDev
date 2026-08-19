// ===== PRESENTATION LAYER (useMediaMode) =====
// React binding for mediaMode.js. useSyncExternalStore rather than context:
// the global toggle on /discover has to reach PlaceImage instances on a
// different route (/discover/:placeId) and inside the shared home rail, and a
// context provider would have to wrap the whole app to get there. A module
// subscription reaches every mounted reader with no plumbing.
//
// getMediaMode() returns a primitive string, so repeated calls between real
// changes are snapshot-stable by value equality - no memoisation needed to
// satisfy useSyncExternalStore's stability requirement.
import { useSyncExternalStore } from 'react';
import { MEDIA_MODE, getMediaMode, subscribeMediaMode } from '../../../business-logic/discovery/mediaMode.js';

export function useMediaEnabled() {
  const mode = useSyncExternalStore(subscribeMediaMode, getMediaMode, getMediaMode);
  return mode === MEDIA_MODE.ON;
}
