import { GUIDE_STORAGE } from './constants.js';

export function guideChatStorageKey(visitorSessionId, userId, sessionId = null) {
  return `${GUIDE_STORAGE.SESSION_KEY}:${userId || visitorSessionId}:${sessionId || 'current'}`;
}

function legacyGuideChatStorageKey(visitorSessionId, userId) {
  return `${GUIDE_STORAGE.SESSION_KEY}:${userId || visitorSessionId}`;
}

export function readGuideChatSnapshot(visitorSessionId, userId, requestedSessionId = null, storage = globalThis.sessionStorage) {
  const keys = [
    requestedSessionId ? guideChatStorageKey(visitorSessionId, userId, requestedSessionId) : null,
    guideChatStorageKey(visitorSessionId, userId),
    legacyGuideChatStorageKey(visitorSessionId, userId)
  ].filter(Boolean);
  try {
    for (const key of [...new Set(keys)]) {
      const stored = JSON.parse(storage?.getItem(key) || 'null');
      if (!stored?.messages?.length) continue;
      if (requestedSessionId && stored.sessionId !== requestedSessionId) continue;
      return stored;
    }
  } catch { /* Browser-private recovery is best effort. */ }
  return null;
}

export function saveGuideChatSnapshot(visitorSessionId, userId, planState, messages, feedbackStates = {}, sessionId = null, storage = globalThis.sessionStorage) {
  try {
    const value = JSON.stringify({ planState, messages, feedbackStates, sessionId });
    storage?.setItem(guideChatStorageKey(visitorSessionId, userId, sessionId), value);
    if (sessionId) storage?.setItem(guideChatStorageKey(visitorSessionId, userId), value);
  } catch { /* Browser-private recovery is best effort. */ }
}

export function clearGuideChatSnapshots(userId, sessionId = null, storage = globalThis.sessionStorage) {
  if (!userId || !storage) return 0;
  const prefix = `${GUIDE_STORAGE.SESSION_KEY}:${userId}`;
  const keys = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key || (key !== prefix && !key.startsWith(`${prefix}:`))) continue;
      if (!sessionId) { keys.push(key); continue; }
      let storedSessionId = null;
      try { storedSessionId = JSON.parse(storage.getItem(key) || 'null')?.sessionId || null; } catch { /* Exact corrupt route snapshots are still removed below. */ }
      if (key === `${prefix}:${sessionId}` || storedSessionId === sessionId) keys.push(key);
    }
    keys.forEach((key) => storage.removeItem(key));
  } catch { return 0; }
  return keys.length;
}
