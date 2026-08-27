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
import {
  AlertSoundService,
  createRingtoneCoordinator,
  normalizeAlertVolume,
} from '../business-logic/AlertSoundService.js';
import { SOS_ACTIVATED_EVENT_TYPE } from '../business-logic/SOSAlertService.js';
import { useAuth } from './AuthContext.jsx';

const NotificationContext = createContext(null);
const SOS_ALERT_ENABLED = import.meta.env.VITE_M2_SOS_ENABLED === 'true';

function soundPreferenceKey(userId) {
  return `m3-alert-sounds:${userId}`;
}

function volumePreferenceKey(userId, kind) {
  return `m3-alert-${kind}-volume:${userId}`;
}

function readSoundPreference(userId) {
  if (!userId) return true;
  try { return localStorage.getItem(soundPreferenceKey(userId)) !== 'off'; }
  catch { return true; }
}

function readVolumePreference(userId, kind) {
  if (!userId) return 1;
  try {
    const stored = localStorage.getItem(volumePreferenceKey(userId, kind));
    return stored == null ? 1 : normalizeAlertVolume(stored);
  } catch { return 1; }
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
  const [notificationVolume, setNotificationVolumeState] = useState(1);
  const [callRingtoneVolume, setCallRingtoneVolumeState] = useState(1);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const playedNotificationIdsRef = useRef(new Set());
  const ringtoneCoordinatorRef = useRef(null);
  if (!ringtoneCoordinatorRef.current) {
    ringtoneCoordinatorRef.current = createRingtoneCoordinator(AlertSoundService);
  }

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
    setNotificationVolumeState(readVolumePreference(user?.id, 'notification'));
    const nextCallVolume = readVolumePreference(user?.id, 'call');
    setCallRingtoneVolumeState(nextCallVolume);
    ringtoneCoordinatorRef.current.setCallVolume(nextCallVolume);
    setSoundBlocked(false);
    playedNotificationIdsRef.current.clear();
    ringtoneCoordinatorRef.current.reset();
  }, [user?.id]);

  const unlockAlertSounds = useCallback(async () => {
    const unlocked = await AlertSoundService.unlock();
    setSoundBlocked(!unlocked);
    return unlocked;
  }, []);

  useEffect(() => {
    if (!user || (!alertSoundsEnabled && !SOS_ALERT_ENABLED)) return undefined;
    const unlock = () => { void unlockAlertSounds(); };
    globalThis.addEventListener?.('pointerdown', unlock, { once: true, capture: true });
    globalThis.addEventListener?.('keydown', unlock, { once: true, capture: true });
    return () => {
      globalThis.removeEventListener?.('pointerdown', unlock, { capture: true });
      globalThis.removeEventListener?.('keydown', unlock, { capture: true });
    };
  }, [alertSoundsEnabled, unlockAlertSounds, user]);

  const playNotificationBell = useCallback(() => {
    if (!alertSoundsEnabled || notificationVolume === 0) return false;
    const played = AlertSoundService.playBell(notificationVolume);
    setSoundBlocked(!played);
    return played;
  }, [alertSoundsEnabled, notificationVolume]);

  const startCallRingtone = useCallback((callId) => {
    const played = ringtoneCoordinatorRef.current.startCall(callId, alertSoundsEnabled, callRingtoneVolume);
    if (!alertSoundsEnabled || callRingtoneVolume === 0) return false;
    setSoundBlocked(!played);
    return played;
  }, [alertSoundsEnabled, callRingtoneVolume]);

  const stopCallRingtone = useCallback(() => {
    ringtoneCoordinatorRef.current.stopCall();
  }, []);

  const startSOSRingtone = useCallback((eventId) => {
    const played = ringtoneCoordinatorRef.current.startSOS(eventId);
    setSoundBlocked(!played);
    return played;
  }, []);

  const stopSOSRingtone = useCallback((eventId) => {
    return ringtoneCoordinatorRef.current.stopSOS(eventId);
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
    if (next) {
      await unlockAlertSounds();
      ringtoneCoordinatorRef.current.setCallSoundEnabled(true);
    } else {
      ringtoneCoordinatorRef.current.setCallSoundEnabled(false);
    }
  }, [unlockAlertSounds, user?.id]);

  const saveVolumePreference = useCallback((kind, value) => {
    const next = normalizeAlertVolume(value);
    if (kind === 'notification') setNotificationVolumeState(next);
    else {
      setCallRingtoneVolumeState(next);
      ringtoneCoordinatorRef.current.setCallVolume(next);
    }
    try {
      if (user?.id) localStorage.setItem(volumePreferenceKey(user.id, kind), String(next));
    } catch {
      // The preference remains active for this session when storage is unavailable.
    }
    return next;
  }, [user?.id]);

  const setNotificationVolume = useCallback((value) => {
    return saveVolumePreference('notification', value);
  }, [saveVolumePreference]);

  const setCallRingtoneVolume = useCallback((value) => {
    return saveVolumePreference('call', value);
  }, [saveVolumePreference]);

  const previewNotificationSound = useCallback(async () => {
    if (!alertSoundsEnabled || notificationVolume === 0) return false;
    if (!await unlockAlertSounds()) return false;
    const played = AlertSoundService.playBell(notificationVolume);
    setSoundBlocked(!played);
    return played;
  }, [alertSoundsEnabled, notificationVolume, unlockAlertSounds]);

  const previewCallRingtone = useCallback(async () => {
    if (!alertSoundsEnabled || callRingtoneVolume === 0) return false;
    if (!await unlockAlertSounds()) return false;
    const played = AlertSoundService.previewRingtone(callRingtoneVolume);
    setSoundBlocked(!played);
    return played;
  }, [alertSoundsEnabled, callRingtoneVolume, unlockAlertSounds]);

  useEffect(() => {
    if (!user) return undefined;
    return NotificationService.subscribeToNotifications((change) => {
      const notificationId = change?.new?.id;
      const isNewAudibleNotification = change?.eventType === 'INSERT'
        && change.new?.event_type !== 'voice_call'
        && (!SOS_ALERT_ENABLED || change.new?.event_type !== SOS_ACTIVATED_EVENT_TYPE)
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
    notificationVolume,
    callRingtoneVolume,
    soundBlocked,
    setAlertSounds,
    setNotificationVolume,
    setCallRingtoneVolume,
    previewNotificationSound,
    previewCallRingtone,
    unlockAlertSounds,
    startCallRingtone,
    stopCallRingtone,
    startSOSRingtone,
    stopSOSRingtone,
  }), [
    disablePush,
    enablePush,
    error,
    loading,
    markAllRead,
    markRead,
    notifications,
    alertSoundsEnabled,
    notificationVolume,
    callRingtoneVolume,
    pushError,
    pushPending,
    pushStatus,
    refreshNotifications,
    setAlertSounds,
    setNotificationVolume,
    setCallRingtoneVolume,
    previewNotificationSound,
    previewCallRingtone,
    soundBlocked,
    startCallRingtone,
    startSOSRingtone,
    stopCallRingtone,
    stopSOSRingtone,
    unlockAlertSounds,
  ]);

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) throw new Error('useNotifications must be used within NotificationProvider');
  return context;
}
