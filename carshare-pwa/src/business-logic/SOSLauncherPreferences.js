export const SOS_DOCK_DEFAULT_SIDE = 'right';
export const SOS_DOCK_SIDES = Object.freeze(['left', 'right']);

export function sosDockSideKey(userId) {
  return `m2-sos-launcher-side:${userId}`;
}

export function sosDockIntroKey(userId) {
  return `m2-sos-launcher-intro:${userId}`;
}

export function readSOSDockSide(userId, storage = globalThis.localStorage) {
  if (!userId) return SOS_DOCK_DEFAULT_SIDE;
  try {
    const value = storage?.getItem?.(sosDockSideKey(userId));
    return SOS_DOCK_SIDES.includes(value) ? value : SOS_DOCK_DEFAULT_SIDE;
  } catch {
    return SOS_DOCK_DEFAULT_SIDE;
  }
}

export function writeSOSDockSide(userId, side, storage = globalThis.localStorage) {
  const nextSide = SOS_DOCK_SIDES.includes(side) ? side : SOS_DOCK_DEFAULT_SIDE;
  if (!userId) return nextSide;
  try { storage?.setItem?.(sosDockSideKey(userId), nextSide); } catch { /* session state still applies */ }
  return nextSide;
}

export function hasShownSOSDockIntro(userId, storage = globalThis.sessionStorage) {
  if (!userId) return true;
  try { return storage?.getItem?.(sosDockIntroKey(userId)) === 'shown'; }
  catch { return false; }
}

export function markSOSDockIntroShown(userId, storage = globalThis.sessionStorage) {
  if (!userId) return false;
  try {
    storage?.setItem?.(sosDockIntroKey(userId), 'shown');
    return true;
  } catch {
    return false;
  }
}
