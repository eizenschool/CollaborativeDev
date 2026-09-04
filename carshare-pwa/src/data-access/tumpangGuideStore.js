// ===== DATA ACCESS LAYER (Tumpang Guide fixture persistence) =====
// Signed-in fixture users get the same private/Past plans behaviour without a
// deployed schema. Guests are deliberately never written here.
import { GUIDE_LIMITS, GUIDE_STORAGE } from '../business-logic/guide/constants.js';

const empty = () => ({ version: 1, sessions: [], messages: [], feedback: [], usage: {} });
const memory = empty();

function storage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

function read() {
  const target = storage();
  if (!target) return memory;
  try {
    const parsed = JSON.parse(target.getItem(GUIDE_STORAGE.FIXTURE_KEY) || 'null');
    return parsed?.version === 1 ? parsed : empty();
  } catch { return empty(); }
}

function write(db) {
  const target = storage();
  if (target) target.setItem(GUIDE_STORAGE.FIXTURE_KEY, JSON.stringify(db));
  else Object.assign(memory, db);
}

function id(prefix) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function prune(db, now = Date.now()) {
  const cutoff = now - GUIDE_LIMITS.SESSION_RETENTION_DAYS * 86400000;
  const expired = new Set(db.sessions.filter((session) => new Date(session.updatedAt).getTime() < cutoff).map((session) => session.id));
  if (!expired.size) return db;
  db.sessions = db.sessions.filter((session) => !expired.has(session.id));
  db.messages = db.messages.filter((message) => !expired.has(message.sessionId));
  db.feedback = db.feedback.filter((item) => !expired.has(item.sessionId));
  return db;
}

function ownedSession(db, userId, sessionId) {
  return db.sessions.find((session) => session.id === sessionId && session.userId === userId) || null;
}

export const tumpangGuideStore = {
  createSession(userId, language, planState) {
    if (!userId) return null;
    const db = prune(read());
    const now = new Date().toISOString();
    const session = { id: id('guide'), userId, language, planState, title: 'New travel plan', createdAt: now, updatedAt: now };
    db.sessions.unshift(session);
    write(db);
    return session;
  },

  appendTurn(userId, sessionId, userMessage, assistantResponse) {
    if (!userId || !sessionId) return null;
    const db = prune(read());
    const session = ownedSession(db, userId, sessionId);
    if (!session) return null;
    const now = new Date().toISOString();
    db.messages.push(
      { id: id('msg'), sessionId, userId, role: 'user', text: userMessage, createdAt: now },
      { id: id('msg'), sessionId, userId, role: 'assistant', text: assistantResponse.assistantMessage, response: assistantResponse, createdAt: now }
    );
    session.updatedAt = now;
    session.language = assistantResponse.language;
    session.planState = assistantResponse.planState;
    session.title = userMessage.trim().slice(0, 72) || session.title;
    write(db);
    return session;
  },

  listSessions(userId) {
    if (!userId) return [];
    const db = prune(read());
    write(db);
    return db.sessions.filter((session) => session.userId === userId)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  },

  getMessages(userId, sessionId) {
    const db = prune(read());
    if (!ownedSession(db, userId, sessionId)) return [];
    return db.messages.filter((message) => message.sessionId === sessionId && message.userId === userId);
  },

  deleteSession(userId, sessionId) {
    const db = read();
    if (!ownedSession(db, userId, sessionId)) return false;
    db.sessions = db.sessions.filter((session) => session.id !== sessionId);
    db.messages = db.messages.filter((message) => message.sessionId !== sessionId);
    db.feedback = db.feedback.filter((item) => item.sessionId !== sessionId);
    write(db);
    return true;
  },

  deleteAll(userId) {
    if (!userId) return 0;
    const db = read();
    const ids = new Set(db.sessions.filter((session) => session.userId === userId).map((session) => session.id));
    db.sessions = db.sessions.filter((session) => session.userId !== userId);
    db.messages = db.messages.filter((message) => !ids.has(message.sessionId));
    db.feedback = db.feedback.filter((item) => !ids.has(item.sessionId));
    write(db);
    return ids.size;
  },

  saveFeedback(userId, sessionId, traceId, sentiment, reason) {
    if (!userId || !ownedSession(read(), userId, sessionId)) return null;
    const db = read();
    const existing = db.feedback.find((item) => item.userId === userId && item.sessionId === sessionId && item.traceId === traceId);
    if (sentiment === 'clear') {
      db.feedback = db.feedback.filter((item) => item !== existing);
      write(db);
      return { cleared: true };
    }
    const item = existing || { id: id('feedback'), userId, sessionId, traceId, createdAt: new Date().toISOString() };
    Object.assign(item, { sentiment, reason });
    if (!existing) db.feedback.push(item);
    write(db);
    return item;
  },

  listFeedback(userId, sessionId) {
    if (!userId || !sessionId) return [];
    const db = prune(read());
    if (!ownedSession(db, userId, sessionId)) return [];
    return db.feedback
      .filter((item) => item.userId === userId && item.sessionId === sessionId)
      .map(({ traceId, sentiment, reason }) => ({ traceId, sentiment, reason }));
  },

  dailyUsage(key, now = new Date()) {
    const db = read();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const usageKey = `${key}:${date}`;
    return Number(db.usage[usageKey]) || 0;
  },

  recordSuccessfulTurn(key, limit, now = new Date()) {
    const db = read();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const usageKey = `${key}:${date}`;
    const used = Number(db.usage[usageKey]) || 0;
    if (used >= limit) return { allowed: false, remaining: 0 };
    db.usage[usageKey] = used + 1;
    write(db);
    return { allowed: true, remaining: limit - used - 1 };
  },

  __reset() { write(empty()); }
};
