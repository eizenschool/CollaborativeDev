import { describe, expect, it, vi } from 'vitest';
import { emitGuideAllSessionsDeleted, emitGuideSessionDeleted, subscribeGuideSessionEvents } from '../GuideChatEvents.js';

describe('Tumpang Guide same-tab / cross-tab session deletion events', () => {
  it('delivers a single-session deletion to a subscriber in the same tab', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeGuideSessionEvents(listener);
    emitGuideSessionDeleted('user-1', 'session-1');
    expect(listener).toHaveBeenCalledWith({ type: 'session_deleted', userId: 'user-1', sessionId: 'session-1' });
    unsubscribe();
  });

  it('delivers an all-sessions deletion to a subscriber in the same tab', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeGuideSessionEvents(listener);
    emitGuideAllSessionsDeleted('user-1');
    expect(listener).toHaveBeenCalledWith({ type: 'all_sessions_deleted', userId: 'user-1' });
    unsubscribe();
  });

  it('stops delivering events after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeGuideSessionEvents(listener);
    unsubscribe();
    emitGuideSessionDeleted('user-1', 'session-1');
    expect(listener).not.toHaveBeenCalled();
  });

  it('ignores calls with a missing user or session id instead of emitting a broken event', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeGuideSessionEvents(listener);
    emitGuideSessionDeleted(null, 'session-1');
    emitGuideSessionDeleted('user-1', null);
    emitGuideAllSessionsDeleted(null);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('keeps one bad subscriber from blocking delivery to the rest', () => {
    const broken = vi.fn(() => { throw new Error('boom'); });
    const healthy = vi.fn();
    const unsubscribeBroken = subscribeGuideSessionEvents(broken);
    const unsubscribeHealthy = subscribeGuideSessionEvents(healthy);
    emitGuideSessionDeleted('user-2', 'session-2');
    expect(healthy).toHaveBeenCalledTimes(1);
    unsubscribeBroken(); unsubscribeHealthy();
  });
});
