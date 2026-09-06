import { describe, expect, it } from 'vitest';
import {
  selectPendingSOSAlerts,
  SOS_RING_TIMEOUT_MS,
  sosEventId,
  sosRingRemainingMs,
} from '../SOSAlertService.js';

const EVENT_A = '00000000-0000-4000-8000-000000000001';
const EVENT_B = '00000000-0000-4000-8000-000000000002';

function notification(overrides = {}) {
  const eventId = overrides.eventId || EVENT_A;
  return {
    id: overrides.id || `notification-${eventId}`,
    eventType: 'sos_activated',
    actionPath: `/sos/${eventId}`,
    payload: { eventId },
    createdAt: '2026-08-28T00:00:00Z',
    isRead: false,
    ...overrides,
  };
}

describe('SOS alert selection', () => {
  it('uses the fixed 45-second foreground ringtone window', () => {
    expect(SOS_RING_TIMEOUT_MS).toBe(45_000);
    const createdAt = '2026-08-28T00:00:00.000Z';
    expect(sosRingRemainingMs(createdAt, Date.parse(createdAt) + 12_000)).toBe(33_000);
    expect(sosRingRemainingMs(createdAt, Date.parse(createdAt) + 50_000)).toBe(0);
    expect(sosRingRemainingMs('invalid', Date.parse(createdAt))).toBe(45_000);
  });

  it('accepts only valid unread activation notifications with matching safe paths', () => {
    const valid = notification();
    const result = selectPendingSOSAlerts([
      valid,
      notification({ id: 'read', isRead: true }),
      notification({ id: 'signal', eventType: 'sos_signal_lost' }),
      notification({ id: 'bad-id', payload: { eventId: 'not-a-uuid' } }),
      notification({ id: 'bad-path', actionPath: '/notifications' }),
    ]);

    expect(result).toEqual([{ ...valid, eventId: EVENT_A }]);
    expect(sosEventId(valid)).toBe(EVENT_A);
  });

  it('removes resolved events even when the resolved notification is already read', () => {
    expect(selectPendingSOSAlerts([
      notification(),
      notification({ id: 'resolved', eventType: 'sos_resolved', isRead: true }),
    ])).toEqual([]);
  });

  it('deduplicates events and orders the newest unresolved alert first', () => {
    const newest = notification({ eventId: EVENT_B, id: 'newest', createdAt: '2026-08-28T00:02:00Z' });
    const older = notification({ eventId: EVENT_A, id: 'older', createdAt: '2026-08-28T00:01:00Z' });
    const duplicate = notification({ eventId: EVENT_B, id: 'duplicate', createdAt: '2026-08-28T00:00:00Z' });

    expect(selectPendingSOSAlerts([older, duplicate, newest]).map((alert) => alert.id))
      .toEqual(['newest', 'older']);
  });
});
