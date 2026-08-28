import { describe, expect, it } from 'vitest';
import {
  hasShownSOSDockIntro,
  markSOSDockIntroShown,
  readSOSDockSide,
  SOS_DOCK_DEFAULT_SIDE,
  sosDockIntroKey,
  sosDockSideKey,
  writeSOSDockSide,
} from '../SOSLauncherPreferences.js';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

describe('SOS launcher preferences', () => {
  it('defaults invalid, missing, and unavailable side preferences to the right', () => {
    expect(readSOSDockSide('user-1', memoryStorage())).toBe(SOS_DOCK_DEFAULT_SIDE);
    expect(readSOSDockSide('user-1', memoryStorage({ [sosDockSideKey('user-1')]: 'middle' }))).toBe('right');
    expect(readSOSDockSide('user-1', { getItem: () => { throw new Error('blocked'); } })).toBe('right');
  });

  it('persists only left or right for the current user', () => {
    const storage = memoryStorage();
    expect(writeSOSDockSide('user-1', 'left', storage)).toBe('left');
    expect(readSOSDockSide('user-1', storage)).toBe('left');
    expect(readSOSDockSide('user-2', storage)).toBe('right');
    expect(writeSOSDockSide('user-1', 'free-drag', storage)).toBe('right');
    expect(readSOSDockSide('user-1', storage)).toBe('right');
  });

  it('records the intro once per user in session storage', () => {
    const storage = memoryStorage();
    expect(hasShownSOSDockIntro('user-1', storage)).toBe(false);
    expect(markSOSDockIntroShown('user-1', storage)).toBe(true);
    expect(storage.getItem(sosDockIntroKey('user-1'))).toBe('shown');
    expect(hasShownSOSDockIntro('user-1', storage)).toBe(true);
    expect(hasShownSOSDockIntro('user-2', storage)).toBe(false);
  });
});
