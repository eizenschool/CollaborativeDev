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
    // Notification read state must always be fresh. Serving this private,
    // user-scoped endpoint from a URL-only cache can hide new unread items
    // after an account switch or a slow network response.
    && !url.pathname.startsWith('/rest/v1/user_notifications')
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
    };
  } catch {
    return { title: "Let's Tumpang", body: 'You have a new notification.', actionPath: '/notifications', notificationId: null };
  }
}

self.addEventListener('push', (event) => {
  const payload = safePushPayload(event);
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: payload.notificationId ? `notification-${payload.notificationId}` : undefined,
    data: { actionPath: payload.actionPath },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = event.notification.data?.actionPath || '/notifications';
  event.waitUntil((async () => {
    const matching = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = matching.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) {
      await existing.focus();
      existing.postMessage({ type: 'notification-click', actionPath: path });
      return;
    }
    await clients.openWindow(new URL(path, self.location.origin).href);
  })());
});
