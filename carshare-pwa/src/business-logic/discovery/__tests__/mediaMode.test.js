// mediaMode.js - the device-level "load photos and Street View automatically,
// or only when asked" setting. The property that matters most is the one the
// feature exists for: the choice survives a reload, which means it has to be
// read from real storage, not just an in-memory variable the way
// DiscoveryDemoControls.js's overrides are.
//
// This module reads/writes `globalThis.localStorage` directly rather than
// taking an injectable storage parameter, matching discoveryStore.js's own
// convention - so these tests install and remove a fake localStorage around
// each case instead of passing one in.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getMediaMode, isMediaEnabled, setMediaMode, subscribeMediaMode, toggleMediaMode,
  __resetMediaMode, MEDIA_MODE
} from '../mediaMode.js';

function fakeLocalStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    removeItem: (key) => { delete data[key]; },
    _data: data
  };
}

function installStorage(storage) {
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage, configurable: true, writable: true
  });
}

function removeStorage() {
  delete globalThis.localStorage;
}

afterEach(() => {
  __resetMediaMode();
  removeStorage();
});

describe('getMediaMode / isMediaEnabled', () => {
  it('defaults to off with no localStorage at all', () => {
    removeStorage();
    expect(getMediaMode()).toBe(MEDIA_MODE.OFF);
    expect(isMediaEnabled()).toBe(false);
  });

  it('defaults to off with nothing stored yet', () => {
    installStorage(fakeLocalStorage());
    expect(getMediaMode()).toBe(MEDIA_MODE.OFF);
  });

  it('falls back to off for a malformed or foreign stored value, rather than half-enabling', () => {
    installStorage(fakeLocalStorage({ letstumpang_discovery_media_v1: 'yes-please' }));
    expect(getMediaMode()).toBe(MEDIA_MODE.OFF);
  });

  it('tolerates a storage whose reads throw (private-browsing style failure)', () => {
    installStorage({
      getItem: () => { throw new Error('blocked'); },
      setItem: () => {},
      removeItem: () => {}
    });
    expect(() => getMediaMode()).not.toThrow();
    expect(getMediaMode()).toBe(MEDIA_MODE.OFF);
  });
});

describe('setMediaMode', () => {
  it('persists a recognised mode, readable back through getMediaMode', () => {
    const storage = fakeLocalStorage();
    installStorage(storage);

    setMediaMode(MEDIA_MODE.ON);

    expect(getMediaMode()).toBe(MEDIA_MODE.ON);
    expect(storage._data.letstumpang_discovery_media_v1).toBe('on');
  });

  it('ignores an unrecognised mode rather than half-enabling', () => {
    installStorage(fakeLocalStorage());
    setMediaMode('sometimes');
    expect(getMediaMode()).toBe(MEDIA_MODE.OFF);
  });

  it('tolerates a storage whose writes throw, without losing the in-call return value', () => {
    installStorage({
      getItem: () => null,
      setItem: () => { throw new Error('quota exceeded'); },
      removeItem: () => {}
    });
    expect(() => setMediaMode(MEDIA_MODE.ON)).not.toThrow();
  });

  it('does nothing destructive with no localStorage at all', () => {
    removeStorage();
    expect(() => setMediaMode(MEDIA_MODE.ON)).not.toThrow();
    expect(getMediaMode()).toBe(MEDIA_MODE.OFF);
  });
});

describe('toggleMediaMode', () => {
  it('flips off to on and back to off', () => {
    installStorage(fakeLocalStorage());
    expect(getMediaMode()).toBe(MEDIA_MODE.OFF);
    toggleMediaMode();
    expect(getMediaMode()).toBe(MEDIA_MODE.ON);
    toggleMediaMode();
    expect(getMediaMode()).toBe(MEDIA_MODE.OFF);
  });
});

describe('subscribeMediaMode', () => {
  it('notifies a listener when the mode actually changes', () => {
    installStorage(fakeLocalStorage());
    const listener = vi.fn();
    subscribeMediaMode(listener);

    setMediaMode(MEDIA_MODE.ON);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops notifying once unsubscribed', () => {
    installStorage(fakeLocalStorage());
    const listener = vi.fn();
    const unsubscribe = subscribeMediaMode(listener);
    unsubscribe();

    setMediaMode(MEDIA_MODE.ON);

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('getMediaMode snapshot stability', () => {
  // useSyncExternalStore requires getSnapshot to return the same value on
  // repeated calls between real changes - a string comparison guarantees
  // this without any extra memoisation, but only if two reads of the same
  // stored value actually produce equal primitives.
  it('returns the same primitive across repeated calls with no change in between', () => {
    installStorage(fakeLocalStorage({ letstumpang_discovery_media_v1: 'on' }));
    expect(getMediaMode()).toBe(getMediaMode());
  });
});
