export const SOS_DOCK_DEFAULT_POSITION = Object.freeze({ side: 'right', yRatio: 0.58 });
export const SOS_DOCK_VERTICAL_STEP = 0.15;
export const SOS_DOCK_DRAG_THRESHOLD_PX = 8;
export const SOS_DOCK_BUTTON_SIZE_PX = 56;

const SOS_DOCK_SIDES = new Set(['left', 'right']);
const SOS_DOCK_POSITION_VERSION = 1;

export function sosDockSideKey(userId) {
  return `m2-sos-launcher-side:${userId}`;
}

export function sosDockPositionKey(userId) {
  return `m2-sos-launcher-position:${userId}`;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeSOSDockPosition(position) {
  const side = SOS_DOCK_SIDES.has(position?.side) ? position.side : SOS_DOCK_DEFAULT_POSITION.side;
  const numericRatio = Number(position?.yRatio);
  const yRatio = Number.isFinite(numericRatio)
    ? clamp(numericRatio, 0, 1)
    : SOS_DOCK_DEFAULT_POSITION.yRatio;
  return { side, yRatio };
}

export function readSOSDockPosition(userId, storage = globalThis.localStorage) {
  if (!userId) return { ...SOS_DOCK_DEFAULT_POSITION };
  try {
    const stored = storage?.getItem?.(sosDockPositionKey(userId));
    if (stored) return normalizeSOSDockPosition(JSON.parse(stored));

    const legacySide = storage?.getItem?.(sosDockSideKey(userId));
    if (SOS_DOCK_SIDES.has(legacySide)) {
      return { side: legacySide, yRatio: SOS_DOCK_DEFAULT_POSITION.yRatio };
    }
  } catch {
    // Local persistence is optional; keep a stable in-memory default.
  }
  return { ...SOS_DOCK_DEFAULT_POSITION };
}

export function writeSOSDockPosition(userId, position, storage = globalThis.localStorage) {
  const next = normalizeSOSDockPosition(position);
  if (!userId) return next;
  try {
    storage?.setItem?.(sosDockPositionKey(userId), JSON.stringify({
      version: SOS_DOCK_POSITION_VERSION,
      ...next,
    }));
  } catch {
    // The position remains active for this session when storage is unavailable.
  }
  return next;
}

export function moveSOSDockPosition(position, direction) {
  const current = normalizeSOSDockPosition(position);
  if (direction === 'up') {
    return { ...current, yRatio: clamp(current.yRatio - SOS_DOCK_VERTICAL_STEP, 0, 1) };
  }
  if (direction === 'down') {
    return { ...current, yRatio: clamp(current.yRatio + SOS_DOCK_VERTICAL_STEP, 0, 1) };
  }
  return current;
}

export function hasExceededSOSDragThreshold(deltaX, deltaY, threshold = SOS_DOCK_DRAG_THRESHOLD_PX) {
  return Math.hypot(deltaX, deltaY) >= threshold;
}

export function sosDockPointFromPosition(position, bounds) {
  const current = normalizeSOSDockPosition(position);
  const maxX = Math.max(0, Number(bounds?.width || 0) - SOS_DOCK_BUTTON_SIZE_PX);
  const maxY = Math.max(0, Number(bounds?.height || 0) - SOS_DOCK_BUTTON_SIZE_PX);
  return {
    x: current.side === 'left' ? 0 : maxX,
    y: current.yRatio * maxY,
  };
}

export function clampSOSDockPoint(point, bounds) {
  const maxX = Math.max(0, Number(bounds?.width || 0) - SOS_DOCK_BUTTON_SIZE_PX);
  const maxY = Math.max(0, Number(bounds?.height || 0) - SOS_DOCK_BUTTON_SIZE_PX);
  return {
    x: clamp(Number(point?.x) || 0, 0, maxX),
    y: clamp(Number(point?.y) || 0, 0, maxY),
  };
}

export function sosDockPositionFromPoint(point, bounds) {
  const clamped = clampSOSDockPoint(point, bounds);
  const maxX = Math.max(0, Number(bounds?.width || 0) - SOS_DOCK_BUTTON_SIZE_PX);
  const maxY = Math.max(0, Number(bounds?.height || 0) - SOS_DOCK_BUTTON_SIZE_PX);
  return {
    side: clamped.x <= maxX / 2 ? 'left' : 'right',
    yRatio: maxY > 0 ? clamped.y / maxY : SOS_DOCK_DEFAULT_POSITION.yRatio,
  };
}
