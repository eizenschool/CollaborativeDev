import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { NotificationService, countUnread } from '../business-logic/NotificationService.js';
import { AlertSoundService } from '../business-logic/AlertSoundService.js';
import { useAuth } from './AuthContext.jsx';

const NotificationContext = createContext(null);

function soundPreferenceKey(userId) {
  return `m3-alert-sounds:${userId}`;
}

function readSoundPreference(userId) {
  if (!userId) return true;
  try { return localStorage.getItem(soundPreferenceKey(userId)) !== 'off'; }
  catch { return true; }
}

export function NotificationProvider({ children }) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pushStatus, setPushStatus] = useState('unsupported');
  const [pushError, setPushError] = useState('');
  const [pushPending, setPushPending] = useState(false);
  const [alertSoundsEnabled, setAlertSoundsEnabled] = useState(true);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const playedNotificationIdsRef = useRef(new Set());

  const refreshNotifications = useCallback(async () => {
    if (!user) {
      setNotifications([]);
      setError('');
      return [];
    }
    setLoading(true);
    setError('');
    try {
      const next = await NotificationService.listNotifications();
      setNotifications(next);
      return next;
    } catch (requestError) {
      setError(requestError.message || 'Unable to load notifications.');
      return [];
    } finally {
      setLoading(false);
    }
  }, [user]);

  const refreshPushStatus = useCallback(async () => {
    setPushError('');
    try {
      const status = await NotificationService.getPushStatus();
      if (user && status === 'enabled') {
        await NotificationService.syncPushSubscription();
      }
      setPushStatus(status);
    } catch (requestError) {
      // A local PushSubscription can survive account changes. If the server
      // re-registration fails, expose a retry button instead of claiming that
      // device alerts are enabled for the current account.
      setPushStatus('available');
      setPushError(requestError.message || 'Unable to register device notifications for this account.');
    }
  }, [user]);

  useEffect(() => {
    refreshNotifications();
    refreshPushStatus();
  }, [refreshNotifications, refreshPushStatus]);

  useEffect(() => {
    setAlertSoundsEnabled(readSoundPreference(user?.id));
    setSoundBlocked(false);
    playedNotificationIdsRef.current.clear();
    AlertSoundService.stopRingtone();
  }, [user?.id]);

  const unlockAlertSounds = useCallback(async () => {
    const unlocked = await AlertSoundService.unlock();
    setSoundBlocked(!unlocked);
    return unlocked;
  }, []);

  useEffect(() => {
    if (!user || !alertSoundsEnabled) return undefined;
    const unlock = () => { void unlockAlertSounds(); };
    globalThis.addEventListener?.('pointerdown', unlock, { once: true, capture: true });
    globalThis.addEventListener?.('keydown', unlock, { once: true, capture: true });
    return () => {
      globalThis.removeEventListener?.('pointerdown', unlock, { capture: true });
      globalThis.removeEventListener?.('keydown', unlock, { capture: true });
    };
  }, [alertSoundsEnabled, unlockAlertSounds, user]);

  const playNotificationBell = useCallback(() => {
    if (!alertSoundsEnabled) return false;
    const played = AlertSoundService.playBell();
    setSoundBlocked(!played);
    return played;
  }, [alertSoundsEnabled]);

  const startCallRingtone = useCallback((callId) => {
    if (!alertSoundsEnabled) return false;
    const played = AlertSoundService.startRingtone(callId);
    setSoundBlocked(!played);
    return played;
  }, [alertSoundsEnabled]);

  const stopCallRingtone = useCallback(() => {
    AlertSoundService.stopRingtone();
  }, []);

  const setAlertSounds = useCallback(async (enabled) => {
    const next = Boolean(enabled);
    setAlertSoundsEnabled(next);
    setSoundBlocked(false);
    try {
      if (user?.id) localStorage.setItem(soundPreferenceKey(user.id), next ? 'on' : 'off');
    } catch {
      // The preference remains active for this session when storage is unavailable.
    }
    if (next) await unlockAlertSounds();
    else AlertSoundService.stopRingtone();
  }, [unlockAlertSounds, user?.id]);

  useEffect(() => {
    if (!user) return undefined;
    return NotificationService.subscribeToNotifications((change) => {
      const notificationId = change?.new?.id;
      const isNewAudibleNotification = change?.eventType === 'INSERT'
        && change.new?.event_type !== 'voice_call'
        && notificationId
        && !playedNotificationIdsRef.current.has(notificationId);
      if (isNewAudibleNotification) {
        playedNotificationIdsRef.current.add(notificationId);
        if (playedNotificationIdsRef.current.size > 100) {
          const oldestId = playedNotificationIdsRef.current.values().next().value;
          playedNotificationIdsRef.current.delete(oldestId);
        }
        playNotificationBell();
      }
      void refreshNotifications();
    });
  }, [playNotificationBell, refreshNotifications, user]);

  const markRead = useCallback(async (notificationId) => {
    const readAt = new Date().toISOString();
    setNotifications((current) => current.map((item) => item.id === notificationId
      ? { ...item, isRead: true, readAt }
      : item));
    try {
      await NotificationService.markRead(notificationId);
    } catch (requestError) {
      await refreshNotifications();
      throw requestError;
    }
  }, [refreshNotifications]);

  const markAllRead = useCallback(async () => {
    const readAt = new Date().toISOString();
    setNotifications((current) => current.map((item) => ({ ...item, isRead: true, readAt })));
    try {
      await NotificationService.markAllRead();
    } catch (requestError) {
      await refreshNotifications();
      throw requestError;
    }
  }, [refreshNotifications]);

  const enablePush = useCallback(async () => {
    setPushPending(true);
    setPushError('');
    try {
      setPushStatus(await NotificationService.enablePush());
    } catch (requestError) {
      setPushError(requestError.message || 'Unable to enable device notifications.');
      await refreshPushStatus();
      throw requestError;
    } finally {
      setPushPending(false);
    }
  }, [refreshPushStatus]);

  const disablePush = useCallback(async () => {
    setPushPending(true);
    setPushError('');
    try {
      setPushStatus(await NotificationService.disablePush());
    } catch (requestError) {
      setPushError(requestError.message || 'Unable to disable device notifications.');
      throw requestError;
    } finally {
      setPushPending(false);
    }
  }, []);

  const value = useMemo(() => ({
    notifications,
    unreadCount: countUnread(notifications),
    loading,
    error,
    refreshNotifications,
    markRead,
    markAllRead,
    pushStatus,
    pushError,
    pushPending,
    enablePush,
    disablePush,
    alertSoundsEnabled,
    soundBlocked,
    setAlertSounds,
    unlockAlertSounds,
    startCallRingtone,
    stopCallRingtone,
  }), [
    disablePush,
    enablePush,
    error,
    loading,
    markAllRead,
    markRead,
    notifications,
    alertSoundsEnabled,
    pushError,
    pushPending,
    pushStatus,
    refreshNotifications,
    setAlertSounds,
    soundBlocked,
    startCallRingtone,
    stopCallRingtone,
    unlockAlertSounds,
  ]);

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) throw new Error('useNotifications must be used within NotificationProvider');
  return context;
}
