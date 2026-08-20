import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  countUnread,
  createNotificationService,
  mapNotificationRow,
  urlBase64ToUint8Array,
} from '../NotificationService.js';

const rawNotification = {
  id: '10000000-0000-4000-8000-000000000001',
  source_module: 'm3',
  event_type: 'message',
  title: 'New message from Aina',
  body: 'Meet at the station',
  action_path: '/message/20000000-0000-4000-8000-000000000001',
  payload: { conversationId: '20000000-0000-4000-8000-000000000001' },
  created_at: '2026-08-20T00:00:00.000Z',
  read_at: null,
};

function createRepository() {
  const calls = [];
  return {
    backend: 'test',
    calls,
    listNotifications: async () => [rawNotification],
    markRead: async (id) => { calls.push(['read', id]); return true; },
    markAllRead: async () => { calls.push(['all-read']); return 1; },
    subscribe: (listener) => { calls.push(['subscribe', listener]); return () => calls.push(['unsubscribe']); },
  };
}

const originalWindow = globalThis.window;
const originalNavigator = globalThis.navigator;
const originalNotification = globalThis.Notification;

function installPushEnvironment({ permission = 'granted', subscription = null } = {}) {
  const pushManager = {
    getSubscription: vi.fn().mockResolvedValue(subscription),
    subscribe: vi.fn().mockResolvedValue({
      endpoint: 'https://push.example/subscription',
      unsubscribe: vi.fn().mockResolvedValue(true),
      toJSON: () => ({
        endpoint: 'https://push.example/subscription',
        expirationTime: null,
        keys: { p256dh: 'public-device-key', auth: 'auth-device-key' },
      }),
    }),
  };
  const serviceWorker = { ready: Promise.resolve({ pushManager }) };
  const notification = {
    permission,
    requestPermission: vi.fn().mockImplementation(async () => {
      notification.permission = 'granted';
      return 'granted';
    }),
  };
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { isSecureContext: true, Notification: notification, PushManager: class PushManager {}, serviceWorker },
  });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serviceWorker, PushManager: class PushManager {} } });
  Object.defineProperty(globalThis, 'Notification', { configurable: true, value: notification });
  return { notification, pushManager };
}

afterEach(() => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: originalNavigator });
  Object.defineProperty(globalThis, 'Notification', { configurable: true, value: originalNotification });
});

describe('NotificationService', () => {
  it('maps the generic database contract into a safe in-app notification', () => {
    expect(mapNotificationRow(rawNotification)).toMatchObject({
      sourceModule: 'm3',
      eventType: 'message',
      actionPath: rawNotification.action_path,
      isRead: false,
    });
    expect(mapNotificationRow({ ...rawNotification, action_path: 'https://unsafe.example' }).actionPath).toBeNull();
    expect(mapNotificationRow({ ...rawNotification, action_path: '/\\unsafe.example' }).actionPath).toBeNull();
  });

  it('counts unread items and delegates read mutations to its repository', async () => {
    const repository = createRepository();
    const service = createNotificationService(repository);
    const notifications = await service.listNotifications();
    expect(countUnread([...notifications, { ...notifications[0], id: 'read', isRead: true }])).toBe(1);
    await service.markRead(rawNotification.id);
    await service.markAllRead();
    expect(repository.calls).toEqual([
      ['read', rawNotification.id],
      ['all-read'],
    ]);
  });

  it('converts URL-safe VAPID public-key bytes for PushManager', () => {
    expect([...urlBase64ToUint8Array('AQID-_8')]).toEqual([1, 2, 3, 251, 255]);
  });

  it('reports a denied browser permission without attempting a subscription', async () => {
    installPushEnvironment({ permission: 'denied' });
    const service = createNotificationService(createRepository(), { vapidPublicKey: 'AQID-_8' });
    await expect(service.getPushStatus()).resolves.toBe('denied');
  });

  it('requests permission and registers the browser subscription with the repository', async () => {
    const repository = { ...createRepository(), savePushSubscription: vi.fn().mockResolvedValue(true) };
    const { notification, pushManager } = installPushEnvironment({ permission: 'default' });
    const service = createNotificationService(repository, { vapidPublicKey: 'AQID-_8' });

    await expect(service.enablePush()).resolves.toBe('enabled');
    expect(notification.requestPermission).toHaveBeenCalledOnce();
    expect(pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: new Uint8Array([1, 2, 3, 251, 255]),
    });
    expect(repository.savePushSubscription).toHaveBeenCalledWith({
      endpoint: 'https://push.example/subscription',
      expirationTime: null,
      keys: { p256dh: 'public-device-key', auth: 'auth-device-key' },
    });
  });

  it('surfaces a subscription registration failure and keeps the listener internal to the provider', async () => {
    const repository = {
      ...createRepository(),
      savePushSubscription: vi.fn().mockRejectedValue(new Error('subscription API failed')),
    };
    const { pushManager } = installPushEnvironment();
    const service = createNotificationService(repository, { vapidPublicKey: 'AQID-_8' });

    await expect(service.enablePush()).rejects.toThrow('subscription API failed');
    expect((await pushManager.subscribe.mock.results[0].value).unsubscribe).toHaveBeenCalledOnce();
    const unsubscribe = service.subscribeToNotifications(() => {});
    unsubscribe();
    expect(repository.calls.map(([type]) => type)).toEqual(['subscribe', 'unsubscribe']);
  });
});
