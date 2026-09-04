const CHANNEL_NAME = 'letstumpang-guide-sessions';

const listeners = new Set();
let channel = null;

function getChannel() {
  if (channel || typeof BroadcastChannel === 'undefined') return channel;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (event) => dispatch(event.data, false);
  } catch { channel = null; }
  return channel;
}

function dispatch(event, broadcast) {
  listeners.forEach((listener) => { try { listener(event); } catch { /* one bad subscriber must not break the rest */ } });
  // A BroadcastChannel message never reaches its own sending tab, so the
  // local dispatch above is what same-tab subscribers rely on.
  if (broadcast) { try { getChannel()?.postMessage(event); } catch { /* cross-tab delivery is best effort */ } }
}

export function emitGuideSessionDeleted(userId, sessionId) {
  if (!userId || !sessionId) return;
  dispatch({ type: 'session_deleted', userId, sessionId }, true);
}

export function emitGuideAllSessionsDeleted(userId) {
  if (!userId) return;
  dispatch({ type: 'all_sessions_deleted', userId }, true);
}

export function subscribeGuideSessionEvents(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  getChannel();
  return () => listeners.delete(listener);
}
