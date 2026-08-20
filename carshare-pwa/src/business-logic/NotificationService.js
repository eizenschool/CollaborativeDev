// ===== BUSINESS LOGIC LAYER (NotificationService) =====
import { supabaseNotificationRepository } from '../data-access/supabaseNotificationRepository.js';

export const NOTIFICATION_LIMIT = 50;

function normalizeActionPath(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')
    ? value
    : null;
}

export function mapNotificationRow(row) {
  return {
    id: row.id,
    sourceModule: row.source_module,
    eventType: row.event_type,
    title: row.title,
    body: row.body,
    actionPath: normalizeActionPath(row.action_path),
    payload: row.payload || {},
    createdAt: row.created_at,
    readAt: row.read_at,
    isRead: Boolean(row.read_at),
  };
}

export function countUnread(notifications) {
  return notifications.reduce((count, notification) => count + (notification.isRead ? 0 : 1), 0);
}

export function isPushSupported() {
  return typeof window !== 'undefined'
    && window.isSecureContext
    && 'Notification' in window
    && 'PushManager' in window
    && 'serviceWorker' in navigator;
}

export function urlBase64ToUint8Array(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  const decoded = globalThis.atob(`${normalized}${padding}`);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function configuredVapidPublicKey() {
  return import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY || '';
}

export function createNotificationService(repository = supabaseNotificationRepository, options = {}) {
  const vapidPublicKey = options.vapidPublicKey || configuredVapidPublicKey();
  return {
    backend: repository.backend,

    async listNotifications(limit = NOTIFICATION_LIMIT) {
      const rows = await repository.listNotifications(Math.min(Math.max(Number(limit) || NOTIFICATION_LIMIT, 1), NOTIFICATION_LIMIT));
      return rows.map(mapNotificationRow);
    },

    markRead(notificationId) {
      if (!notificationId) throw new Error('A notification identifier is required.');
      return repository.markRead(notificationId);
    },

    markAllRead() {
      return repository.markAllRead();
    },

    subscribeToNotifications(listener) {
      return repository.subscribe(listener);
    },

    async getPushStatus() {
      if (!isPushSupported()) return 'unsupported';
      if (!vapidPublicKey) return 'unconfigured';
      if (Notification.permission === 'denied') return 'denied';
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      return subscription ? 'enabled' : 'available';
    },

    async enablePush() {
      if (!isPushSupported()) {
        throw new Error('This browser does not support device notifications over this connection.');
      }
      const publicKey = vapidPublicKey;
      if (!publicKey) throw new Error('Device notifications are not configured for this deployment.');

      const permission = Notification.permission === 'default'
        ? await Notification.requestPermission()
        : Notification.permission;
      if (permission !== 'granted') throw new Error('Allow notifications in your browser settings to enable device alerts.');

      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing || await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      try {
        await repository.savePushSubscription(subscription.toJSON());
      } catch (error) {
        // A device-only subscription is misleading: the server cannot address
        // it, so remove it and let the user retry from a known state.
        try {
          await subscription.unsubscribe?.();
        } catch {
          // Keep the original server-registration error for the UI.
        }
        throw error;
      }
      return 'enabled';
    },

    async disablePush() {
      if (!isPushSupported()) return 'unsupported';
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) return 'available';
      await repository.removePushSubscription(subscription.endpoint);
      await subscription.unsubscribe();
      return 'available';
    },
  };
}

export const NotificationService = createNotificationService();
