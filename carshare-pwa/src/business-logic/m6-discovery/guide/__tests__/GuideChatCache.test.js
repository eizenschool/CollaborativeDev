import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearGuideChatSnapshots, guideChatStorageKey, readGuideChatSnapshot, saveGuideChatSnapshot
} from '../GuideChatCache.js';

describe('Tumpang Guide active chat cache', () => {
  let storage;
  beforeEach(() => {
    const rows = new Map();
    storage = {
      get length() { return rows.size; },
      key: (index) => [...rows.keys()][index] ?? null,
      getItem: (key) => rows.get(key) ?? null,
      setItem: (key, value) => rows.set(key, String(value)),
      removeItem: (key) => rows.delete(key),
      clear: () => rows.clear()
    };
  });

  it('removes the current and route snapshots when their saved session is deleted', () => {
    saveGuideChatSnapshot('visitor', 'user-1', { language: 'en' }, [{ role: 'user', text: 'hello' }], {}, 'session-1', storage);
    saveGuideChatSnapshot('visitor', 'user-1', { language: 'en' }, [{ role: 'user', text: 'other' }], {}, 'session-2', storage);

    clearGuideChatSnapshots('user-1', 'session-2', storage);

    expect(storage.getItem(guideChatStorageKey('visitor', 'user-1', 'session-2'))).toBeNull();
    expect(readGuideChatSnapshot('visitor', 'user-1', null, storage)).toBeNull();
    expect(readGuideChatSnapshot('visitor', 'user-1', 'session-1', storage)?.sessionId).toBe('session-1');
  });

  it('removes every signed-in active snapshot after Delete all', () => {
    saveGuideChatSnapshot('visitor', 'user-1', { language: 'en' }, [{ role: 'user', text: 'hello' }], {}, 'session-1', storage);

    expect(clearGuideChatSnapshots('user-1', null, storage)).toBeGreaterThan(0);
    expect(readGuideChatSnapshot('visitor', 'user-1', null, storage)).toBeNull();
  });
});
