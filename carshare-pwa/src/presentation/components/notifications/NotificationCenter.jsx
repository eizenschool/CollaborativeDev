import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '../../../context/NotificationContext.jsx';
import { IconBell, IconCheck, IconX } from '../icons.jsx';

function relativeTime(value) {
  const milliseconds = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(milliseconds / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(value));
}

function PushControl({ compact = false }) {
  const { pushStatus, pushError, pushPending, enablePush, disablePush } = useNotifications();
  const [actionError, setActionError] = useState('');

  async function changePush(action) {
    setActionError('');
    try { await action(); }
    catch (error) { setActionError(error.message || 'Unable to update device notifications.'); }
  }

  if (pushStatus === 'enabled') {
    return (
      <div className="notification-push-control">
        {!compact && <span>Device alerts are enabled.</span>}
        <button type="button" className="btn-link" disabled={pushPending} onClick={() => changePush(disablePush)}>
          {pushPending ? 'Updating…' : 'Disable device alerts'}
        </button>
      </div>
    );
  }
  if (pushStatus === 'available') {
    return (
      <div className="notification-push-control">
        {!compact && <span>Get alerts even when the app is closed.</span>}
        <button type="button" className="notification-enable-push" disabled={pushPending} onClick={() => changePush(enablePush)}>
          <IconBell size={15} /> {pushPending ? 'Enabling…' : 'Enable device notifications'}
        </button>
        {(actionError || pushError) && <p role="alert">{actionError || pushError}</p>}
      </div>
    );
  }
  if (pushStatus === 'denied') return <p className="notification-helper">Device alerts are blocked in this browser&apos;s settings.</p>;
  if (pushStatus === 'unconfigured') return <p className="notification-helper">Device alerts are not configured for this deployment yet.</p>;
  if (pushStatus === 'unsupported') return <p className="notification-helper">This browser or connection does not support device alerts.</p>;
  return null;
}

function NotificationRows({ compact = false, onNavigate }) {
  const {
    notifications, loading, error, markRead, markAllRead,
  } = useNotifications();

  async function openNotification(notification) {
    try {
      if (!notification.isRead) await markRead(notification.id);
      if (notification.actionPath) onNavigate(notification.actionPath);
    } catch {
      // NotificationContext refreshes and exposes the failed read-state update.
    }
  }

  if (loading && !notifications.length) return <p className="notification-state">Loading notifications…</p>;
  if (error) return <p className="notification-state notification-error" role="alert">{error}</p>;
  if (!notifications.length) return <p className="notification-state">You&apos;re all caught up.</p>;

  return (
    <>
      <div className="notification-list-actions">
        <span>{notifications.length} recent notification{notifications.length === 1 ? '' : 's'}</span>
        {notifications.some((item) => !item.isRead) && (
          <button type="button" className="btn-link" onClick={() => { void markAllRead().catch(() => {}); }}>
            <IconCheck size={14} /> Mark all read
          </button>
        )}
      </div>
      <div className={'notification-list' + (compact ? ' notification-list-compact' : '')}>
        {notifications.slice(0, compact ? 6 : notifications.length).map((notification) => (
          <button
            key={notification.id}
            type="button"
            className={'notification-row' + (notification.isRead ? '' : ' unread')}
            onClick={() => { void openNotification(notification); }}
          >
            <span className="notification-row-dot" aria-hidden="true" />
            <span className="notification-row-copy">
              <span className="notification-row-title">{notification.title}</span>
              <span className="notification-row-body">{notification.body}</span>
            </span>
            <time dateTime={notification.createdAt}>{relativeTime(notification.createdAt)}</time>
          </button>
        ))}
      </div>
    </>
  );
}

export function NotificationPopover({ onClose }) {
  const navigate = useNavigate();
  return (
    <section className="notification-popover" role="dialog" aria-label="Notifications">
      <div className="notification-popover-head">
        <div><strong>Notifications</strong><span>Ride, request, and account updates</span></div>
        <button className="icon-btn" type="button" onClick={onClose} aria-label="Close notifications"><IconX size={17} /></button>
      </div>
      <PushControl compact />
      <NotificationRows compact onNavigate={(path) => { onClose(); navigate(path); }} />
      <button type="button" className="notification-view-all" onClick={() => { onClose(); navigate('/notifications'); }}>
        View all notifications
      </button>
    </section>
  );
}

export default function NotificationCenter() {
  const navigate = useNavigate();
  return (
    <main className="notification-page">
      <div className="notification-page-head">
        <div><h1>Notifications</h1><p>Ride, request, reminder, and account updates.</p></div>
        <PushControl />
      </div>
      <section className="notification-card">
        <NotificationRows onNavigate={navigate} />
      </section>
    </main>
  );
}
