import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearGuideChatSnapshots, clearPendingGuideAction, guideChatStorageKey, readGuideChatSnapshot, readGuideDraft,
  readPendingGuideAction, saveGuideChatSnapshot, saveGuideDraft, savePendingGuideAction
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

  it('keeps an unsent draft across a detail-page round trip', () => {
    saveGuideDraft('visitor', 'user-1', 'What should I know before visiting?', storage);
    expect(readGuideDraft('visitor', 'user-1', storage)).toBe('What should I know before visiting?');
    expect(readGuideDraft('visitor', 'user-2', storage)).toBe('');
  });

  it('recovers a visitor chat and draft after the same tab signs in', () => {
    saveGuideChatSnapshot('visitor', null, { language: 'en' }, [{ role: 'user', text: 'nature near JB' }], {}, null, storage);
    saveGuideDraft('visitor', null, 'nature near JB', storage);

    expect(readGuideChatSnapshot('visitor', 'user-1', null, storage)?.messages[0].text).toBe('nature near JB');
    expect(readGuideDraft('visitor', 'user-1', storage)).toBe('nature near JB');
  });

  it('does not persist raw casual profanity or a blocked targeted insult in a draft', () => {
    saveGuideDraft('visitor', null, 'Damn, show me nature places', storage);
    expect(readGuideDraft('visitor', null, storage)).toBe('****, show me nature places');

    saveGuideDraft('visitor', null, 'You are stupid', storage);
    expect(readGuideDraft('visitor', null, storage)).toBe('');
  });

  it('sanitizes cached user chat messages and drops blocked ones', () => {
    saveGuideChatSnapshot('visitor', null, { language: 'en' }, [
      { role: 'user', text: 'Damn, find a nature place' },
      { role: 'user', text: 'You are stupid' }
    ], {}, null, storage);

    expect(readGuideChatSnapshot('visitor', null, null, storage)?.messages).toEqual([
      { role: 'user', text: '****, find a nature place' }
    ]);
  });

  it('keeps a guest action pending through sign-in without storing the full recommendation card', () => {
    savePendingGuideAction('visitor', {
      type: 'record_interest', planState: { startDate: '2026-09-24' },
      recommendation: {
        placeId: 'place-1', place: { id: 'place-1', name: 'A very long place name', photoReferences: ['should not persist'] }
      }
    }, storage);

    expect(readPendingGuideAction('visitor', storage)).toEqual({
      type: 'record_interest', planState: { startDate: '2026-09-24' },
      recommendation: { placeId: 'place-1', place: { id: 'place-1', name: 'A very long place name' } }
    });
    clearPendingGuideAction('visitor', storage);
    expect(readPendingGuideAction('visitor', storage)).toBeNull();
  });
});
