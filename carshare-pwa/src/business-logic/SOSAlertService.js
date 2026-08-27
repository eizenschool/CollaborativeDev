export const SOS_ACTIVATED_EVENT_TYPE = 'sos_activated';
export const SOS_RESOLVED_EVENT_TYPE = 'sos_resolved';
export const SOS_RING_TIMEOUT_MS = 45_000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function sosEventId(notification) {
  const eventId = notification?.payload?.eventId;
  return typeof eventId === 'string' && UUID_PATTERN.test(eventId) ? eventId : null;
}

function createdTime(notification) {
  const value = new Date(notification?.createdAt || 0).getTime();
  return Number.isFinite(value) ? value : 0;
}

export function selectPendingSOSAlerts(notifications = []) {
  const resolvedEventIds = new Set(
    notifications
      .filter((notification) => notification?.eventType === SOS_RESOLVED_EVENT_TYPE)
      .map(sosEventId)
      .filter(Boolean),
  );
  const seenEventIds = new Set();

  return [...notifications]
    .sort((left, right) => createdTime(right) - createdTime(left))
    .flatMap((notification) => {
      if (notification?.eventType !== SOS_ACTIVATED_EVENT_TYPE || notification.isRead) return [];
      const eventId = sosEventId(notification);
      if (!eventId || resolvedEventIds.has(eventId) || seenEventIds.has(eventId)) return [];
      if (notification.actionPath !== `/sos/${eventId}`) return [];
      seenEventIds.add(eventId);
      return [{ ...notification, eventId }];
    });
}
