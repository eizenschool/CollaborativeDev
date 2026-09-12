import { GUIDE_STORAGE } from './constants.js';
import { classifyGuideContent } from './GuideContentSafety.js';

export function guideChatStorageKey(visitorSessionId, userId, sessionId = null) {
  return `${GUIDE_STORAGE.SESSION_KEY}:${userId || visitorSessionId}:${sessionId || 'current'}`;
}

export function guideDraftStorageKey(visitorSessionId, userId) {
  return `${GUIDE_STORAGE.SESSION_KEY}:draft:${userId || visitorSessionId}`;
}

function legacyGuideChatStorageKey(visitorSessionId, userId) {
  return `${GUIDE_STORAGE.SESSION_KEY}:${userId || visitorSessionId}`;
}

export function readGuideChatSnapshot(visitorSessionId, userId, requestedSessionId = null, storage = globalThis.sessionStorage) {
  const keys = [
    requestedSessionId ? guideChatStorageKey(visitorSessionId, userId, requestedSessionId) : null,
    guideChatStorageKey(visitorSessionId, userId),
    // A visitor can sign in after building a conversation. Keep the visitor
    // snapshot as a recovery source for that same tab before the first
    // signed-in save creates the user-scoped copy.
    userId ? guideChatStorageKey(visitorSessionId, null, requestedSessionId) : null,
    userId ? guideChatStorageKey(visitorSessionId, null) : null,
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
    const safeMessages = (Array.isArray(messages) ? messages : []).map((message) => {
      if (message?.role !== 'user' || typeof message.text !== 'string') return message;
      const safety = classifyGuideContent(message.text);
      if (safety.decision === 'block') return null;
      return { ...message, text: safety.sanitizedText || '' };
    }).filter(Boolean);
    const value = JSON.stringify({ planState, messages: safeMessages, feedbackStates, sessionId });
    storage?.setItem(guideChatStorageKey(visitorSessionId, userId, sessionId), value);
    if (sessionId) storage?.setItem(guideChatStorageKey(visitorSessionId, userId), value);
  } catch { /* Browser-private recovery is best effort. */ }
}

export function readGuideDraft(visitorSessionId, userId, storage = globalThis.sessionStorage) {
  try {
    const keys = [guideDraftStorageKey(visitorSessionId, userId), userId ? guideDraftStorageKey(visitorSessionId, null) : null].filter(Boolean);
    for (const key of [...new Set(keys)]) {
      const value = JSON.parse(storage?.getItem(key) || 'null');
      if (typeof value?.text !== 'string') continue;
      const safety = classifyGuideContent(value.text);
      if (safety.decision === 'block') {
        storage?.removeItem(key);
        continue;
      }
      const safeText = safety.sanitizedText || '';
      if (safeText !== value.text) storage?.setItem(key, JSON.stringify({ text: safeText }));
      return safeText;
    }
    return '';
  } catch { return ''; }
}

export function saveGuideDraft(visitorSessionId, userId, text, storage = globalThis.sessionStorage) {
  try {
    const safety = classifyGuideContent(text);
    const safeText = safety.decision === 'block' ? '' : (safety.sanitizedText || '');
    storage?.setItem(guideDraftStorageKey(visitorSessionId, userId), JSON.stringify({ text: safeText }));
  } catch { /* Browser-private recovery is best effort. */ }
}

function pendingActionStorageKey(visitorSessionId) {
  return `${GUIDE_STORAGE.PENDING_ACTION_KEY}:${visitorSessionId}`;
}

function compactPendingAction(action) {
  const recommendation = action?.recommendation;
  return {
    type: String(action?.type || ''),
    ...(action?.requestedName ? { requestedName: String(action.requestedName).slice(0, 160) } : {}),
    ...(action?.planState ? { planState: action.planState } : {}),
    ...(recommendation?.placeId ? {
      recommendation: {
        placeId: String(recommendation.placeId),
        place: recommendation.place?.name
          ? { id: String(recommendation.place.id || recommendation.placeId), name: String(recommendation.place.name).slice(0, 160) }
          : { id: String(recommendation.placeId) }
      }
    } : {})
  };
}

export function savePendingGuideAction(visitorSessionId, action, storage = globalThis.sessionStorage) {
  if (!visitorSessionId || !action?.type) return;
  try {
    storage?.setItem(pendingActionStorageKey(visitorSessionId), JSON.stringify({
      action: compactPendingAction(action), savedAt: Date.now()
    }));
  } catch { /* Browser-private recovery is best effort. */ }
}

export function readPendingGuideAction(visitorSessionId, storage = globalThis.sessionStorage) {
  if (!visitorSessionId) return null;
  try {
    const key = pendingActionStorageKey(visitorSessionId);
    const stored = JSON.parse(storage?.getItem(key) || 'null');
    if (!stored?.action?.type) return null;
    if (!Number.isFinite(Number(stored.savedAt)) || Date.now() - Number(stored.savedAt) > 30 * 60_000) {
      storage?.removeItem(key);
      return null;
    }
    return stored.action;
  } catch { return null; }
}

export function clearPendingGuideAction(visitorSessionId, storage = globalThis.sessionStorage) {
  if (!visitorSessionId) return;
  try { storage?.removeItem(pendingActionStorageKey(visitorSessionId)); } catch { /* Browser-private recovery is best effort. */ }
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
