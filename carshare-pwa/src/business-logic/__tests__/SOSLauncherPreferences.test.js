import { describe, expect, it } from 'vitest';
import {
  clampSOSDockPoint,
  hasExceededSOSDragThreshold,
  moveSOSDockPosition,
  readSOSDockPosition,
  SOS_DOCK_DEFAULT_POSITION,
  sosDockPointFromPosition,
  sosDockPositionFromPoint,
  sosDockPositionKey,
  sosDockSideKey,
  writeSOSDockPosition,
} from '../SOSLauncherPreferences.js';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

describe('SOS launcher preferences', () => {
  it('defaults invalid, missing, and unavailable positions safely', () => {
    expect(readSOSDockPosition('user-1', memoryStorage())).toEqual(SOS_DOCK_DEFAULT_POSITION);
    expect(readSOSDockPosition('user-1', memoryStorage({
      [sosDockPositionKey('user-1')]: JSON.stringify({ side: 'middle', yRatio: 4 }),
    }))).toEqual({ side: 'right', yRatio: 1 });
    expect(readSOSDockPosition('user-1', { getItem: () => { throw new Error('blocked'); } }))
      .toEqual(SOS_DOCK_DEFAULT_POSITION);
  });

  it('migrates the legacy side and persists a user-scoped versioned position', () => {
    const legacy = memoryStorage({ [sosDockSideKey('user-1')]: 'left' });
    expect(readSOSDockPosition('user-1', legacy)).toEqual({ side: 'left', yRatio: 0.58 });

    const storage = memoryStorage();
    expect(writeSOSDockPosition('user-1', { side: 'left', yRatio: 0.25 }, storage))
      .toEqual({ side: 'left', yRatio: 0.25 });
    expect(JSON.parse(storage.getItem(sosDockPositionKey('user-1'))))
      .toEqual({ version: 1, side: 'left', yRatio: 0.25 });
    expect(readSOSDockPosition('user-2', storage)).toEqual(SOS_DOCK_DEFAULT_POSITION);
  });

  it('moves by accessible 15 percent steps and clamps at both limits', () => {
    expect(moveSOSDockPosition({ side: 'right', yRatio: 0.1 }, 'up')).toEqual({ side: 'right', yRatio: 0 });
    expect(moveSOSDockPosition({ side: 'left', yRatio: 0.9 }, 'down')).toEqual({ side: 'left', yRatio: 1 });
  });

  it('uses an 8px drag threshold, clamps motion, and snaps to the nearest edge', () => {
    const bounds = { width: 343, height: 636 };
    expect(hasExceededSOSDragThreshold(5, 5)).toBe(false);
    expect(hasExceededSOSDragThreshold(8, 0)).toBe(true);
    expect(clampSOSDockPoint({ x: -20, y: 900 }, bounds)).toEqual({ x: 0, y: 580 });
    expect(sosDockPositionFromPoint({ x: 20, y: 290 }, bounds)).toEqual({ side: 'left', yRatio: 0.5 });
    expect(sosDockPositionFromPoint({ x: 250, y: 145 }, bounds)).toEqual({ side: 'right', yRatio: 0.25 });
    expect(sosDockPointFromPosition({ side: 'right', yRatio: 0.5 }, bounds)).toEqual({ x: 287, y: 290 });
  });
});
