import { clientsClaim } from 'workbox-core';
import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

self.skipWaiting();
clientsClaim();
precacheAndRoute(self.__WB_MANIFEST);

registerRoute(
  ({ url, request }) => url.hostname.endsWith('.supabase.co')
    && url.pathname.startsWith('/rest/v1/')
    // Notification and incoming-call state must always be fresh. Serving these
    // private, user-scoped endpoints from a URL-only cache can hide a ringing
    // call or leak another account's state after an account switch.
    && !url.pathname.startsWith('/rest/v1/user_notifications')
    && !url.pathname.startsWith('/rest/v1/call_sessions')
    && request.method === 'GET',
  new NetworkFirst({
    cacheName: 'supabase-read-cache',
    networkTimeoutSeconds: 3,
    plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 })],
  }),
);

function safePushPayload(event) {
  try {
    const payload = event.data?.json() || {};
    return {
      title: typeof payload.title === 'string' ? payload.title : "Let's Tumpang",
      body: typeof payload.body === 'string' ? payload.body : 'You have a new notification.',
      actionPath: typeof payload.actionPath === 'string' && payload.actionPath.startsWith('/') && !payload.actionPath.startsWith('//') && !payload.actionPath.includes('\\')
        ? payload.actionPath
        : '/notifications',
      notificationId: typeof payload.notificationId === 'string' ? payload.notificationId : null,
      eventType: typeof payload.eventType === 'string' ? payload.eventType : '',
      callId: typeof payload.callId === 'string' ? payload.callId : null,
    };
  } catch {
    return {
      title: "Let's Tumpang",
      body: 'You have a new notification.',
      actionPath: '/notifications',
      notificationId: null,
      eventType: '',
      callId: null,
    };
  }
}

function sosEventIdFromPath(actionPath) {
  const match = String(actionPath || '').match(/^\/sos\/([^/?#]+)/);
  return match?.[1] || null;
}

async function broadcastSOSActivation(eventId) {
  if (!eventId) return;
  const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  windows.forEach((client) => client.postMessage({ type: 'sos-push', eventId }));
}

self.addEventListener('push', (event) => {
  const payload = safePushPayload(event);
  const isVoiceCall = payload.eventType === 'voice_call';
  const isSOS = payload.eventType.startsWith('sos_');
  const isSOSActivation = payload.eventType === 'sos_activated';
  const sosEventId = isSOS ? sosEventIdFromPath(payload.actionPath) : null;
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: isVoiceCall && payload.callId
      ? `voice-call-${payload.callId}`
      : sosEventId
        ? `sos-${sosEventId}`
      : payload.notificationId ? `notification-${payload.notificationId}` : undefined,
    requireInteraction: isVoiceCall || isSOSActivation,
    silent: isSOSActivation ? false : undefined,
    renotify: isSOSActivation || undefined,
    vibrate: isVoiceCall ? [300, 150, 300, 150, 500] : isSOSActivation ? [250, 100, 250, 100, 600] : undefined,
    actions: isSOSActivation ? [{ action: 'view-sos', title: 'View SOS' }] : undefined,
    data: {
      actionPath: payload.actionPath,
      eventType: payload.eventType,
      callId: payload.callId,
      sosEventId,
    },
  }).then(() => (isSOSActivation ? broadcastSOSActivation(sosEventId) : undefined)));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = event.notification.data?.actionPath || '/notifications';
  const eventType = event.notification.data?.eventType || '';
  const callId = event.notification.data?.callId || null;
  event.waitUntil((async () => {
    const target = new URL(path, self.location.origin);
    if (eventType === 'voice_call' && callId) target.searchParams.set('incomingCall', callId);
    const targetUrl = target.href;
    const matching = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = matching.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) {
      if (eventType === 'voice_call') {
        // Do not reload a live call client: unmounting its WebRTC provider can
        // tear down media/signalling before the user has a chance to answer.
        // Focusing also triggers the provider's authoritative pending-call
        // resync; postMessage adds the exact call id and SPA destination.
        await existing.focus();
        existing.postMessage({
          type: 'notification-click',
          actionPath: `${target.pathname}${target.search}${target.hash}`,
          eventType,
          callId,
        });
        return;
      }
      // A suspended mobile PWA can miss a postMessage sent immediately after
      // focus. Navigate the WindowClient itself so the conversation path
      // survives process restoration and React has it on first render.
      if (typeof existing.navigate === 'function') {
        try {
          const navigated = await existing.navigate(targetUrl);
          if (navigated) {
            await navigated.focus();
            return;
          }
        } catch {
          // Older/limited browsers keep the in-app message fallback below.
        }
      }
      await existing.focus();
      existing.postMessage({
        type: 'notification-click',
        actionPath: `${target.pathname}${target.search}${target.hash}`,
        eventType,
        callId,
      });
      return;
    }
    const opened = await clients.openWindow(targetUrl);
    await opened?.focus();
  })());
});
