import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { NotificationService, countUnread } from '../business-logic/NotificationService.js';
import { useAuth } from './AuthContext.jsx';

const NotificationContext = createContext(null);

export function NotificationProvider({ children }) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pushStatus, setPushStatus] = useState('unsupported');
  const [pushError, setPushError] = useState('');
  const [pushPending, setPushPending] = useState(false);

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
    if (!user) return undefined;
    return NotificationService.subscribeToNotifications(() => { void refreshNotifications(); });
  }, [refreshNotifications, user]);

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
  }), [
    disablePush,
    enablePush,
    error,
    loading,
    markAllRead,
    markRead,
    notifications,
    pushError,
    pushPending,
    pushStatus,
    refreshNotifications,
  ]);

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) throw new Error('useNotifications must be used within NotificationProvider');
  return context;
}
