// ===== PRESENTATION LAYER (TopNav) =====
// The one persistent, shared element across every screen and every module -
// matches the nav bar spec used across the whole app (7 items: Home, Search,
// Ride, Trips, Message, Favourite, Profile). Search is the public ride-browsing
// surface; Ride is the authenticated hosting and joining workspace; Trips is the
// record of what already happened, which every ride app of this kind promotes to
// the bar rather than burying in a profile.
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import { useNotifications } from '../../../context/NotificationContext.jsx';
import { useMessagingSession } from '../../../context/MessagingSessionContext.jsx';
import { getAuthNavigation } from '../../../business-logic/authAccess.js';
import { IconCar, IconBell, IconLogOut } from '../icons.jsx';
import { IconButton } from '../ui/Button.jsx';
import { PRIMARY_NAV_ITEMS } from './primaryNavigation.js';

const NotificationPopover = lazy(() => import('../notifications/NotificationCenter.jsx')
  .then((module) => ({ default: module.NotificationPopover })));

export default function TopNav() {
  const { user, signOut } = useAuth();
  const { unreadCount } = useNotifications();
  const { unreadMessageCount } = useMessagingSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const notificationRef = useRef(null);
  const notificationButtonRef = useRef(null);
  const initials = (user?.fullName || user?.user_metadata?.full_name || user?.email || '?')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  async function handleSignOut() {
    await signOut();
    navigate('/home', { replace: true });
  }

  useEffect(() => {
    if (!notificationsOpen) return undefined;
    const focusFrame = window.requestAnimationFrame(() => {
      notificationRef.current?.querySelector('.notification-popover button')?.focus();
    });
    const handlePointerDown = (event) => {
      if (!notificationRef.current?.contains(event.target)) setNotificationsOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setNotificationsOpen(false);
        notificationButtonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [notificationsOpen]);

  return (
    <>
      <header className="mobile-appbar">
        <NavLink className="mobile-appbar-brand" to="/home" aria-label="Let's Tumpang home">
          <div className="brand-icon"><IconCar size={18} /></div>
          <span className="brand-title">Let&apos;s Tumpang</span>
        </NavLink>
        {user && (
          <IconButton
            className="icon-btn notification-bell mobile-notification-bell"
            label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}
            aria-current={location.pathname === '/notifications' ? 'page' : undefined}
            onClick={() => navigate('/notifications')}
          >
            <IconBell size={20} aria-hidden="true" />
            {unreadCount > 0 && <span key={unreadCount} className="notification-badge" aria-hidden="true">{unreadCount > 99 ? '99+' : unreadCount}</span>}
          </IconButton>
        )}
      </header>

      <header className="topnav">
        <NavLink className="topnav-brand" to="/home" aria-label="Let's Tumpang home">
          <div className="brand-icon"><IconCar size={18} /></div>
          <span className="brand-title">Let's Tumpang</span>
        </NavLink>

        <nav className="topnav-links" aria-label="Primary navigation">
          {PRIMARY_NAV_ITEMS.map(({ to, label, Icon, requiresAuth }) => {
            const target = requiresAuth
              ? getAuthNavigation(user, to, `Sign in to open ${label}.`)
              : { to };
            const isMessageItem = to === '/message';
            return (
              <NavLink
                key={to}
                to={target.to}
                state={target.state}
                aria-label={isMessageItem && unreadMessageCount > 0 ? `${label}, ${unreadMessageCount} unread messages` : label}
                className={({ isActive }) => 'topnav-item' + (isActive ? ' active' : '')}
              >
                <span className="topnav-icon">
                  <Icon size={18} aria-hidden="true" />
                  {isMessageItem && unreadMessageCount > 0 && (
                    <span key={unreadMessageCount} className="nav-unread-badge" aria-hidden="true">
                      {unreadMessageCount > 99 ? '99+' : unreadMessageCount}
                    </span>
                  )}
                </span>
                <span className="nav-label">{label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="topnav-actions">
          {user ? <>
            <div className="notification-nav-wrap" ref={notificationRef}>
              <IconButton
                ref={notificationButtonRef}
                className="icon-btn notification-bell"
                label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}
                aria-expanded={notificationsOpen}
                aria-haspopup="dialog"
                aria-controls="notification-popover"
                onClick={() => setNotificationsOpen((open) => !open)}
              >
                <IconBell size={18} aria-hidden="true" />
                {unreadCount > 0 && <span key={unreadCount} className="notification-badge" aria-hidden="true">{unreadCount > 99 ? '99+' : unreadCount}</span>}
              </IconButton>
              {notificationsOpen && (
                <Suspense fallback={<div className="notification-popover notification-popover-loading" role="status">Loading notifications…</div>}>
                  <NotificationPopover
                    onClose={() => {
                      setNotificationsOpen(false);
                      notificationButtonRef.current?.focus();
                    }}
                  />
                </Suspense>
              )}
            </div>
            <NavLink
              to="/profile"
              className="topnav-avatar"
              style={user.profilePhotoUrl ? { backgroundImage: `url(${user.profilePhotoUrl})` } : undefined}
              title={user.fullName || 'Profile'}
              aria-label="Open my profile"
            >
              {!user.profilePhotoUrl && initials}
            </NavLink>
            <IconButton className="icon-btn" label="Sign out" onClick={handleSignOut}>
              <IconLogOut size={17} aria-hidden="true" />
            </IconButton>
          </> : (
            <NavLink
              className="topnav-signin"
              to="/auth"
              state={{ from: `${location.pathname}${location.search}`, reason: 'Sign in to use member services.' }}
            >
              Sign in
            </NavLink>
          )}
        </div>
      </header>
    </>
  );
}
