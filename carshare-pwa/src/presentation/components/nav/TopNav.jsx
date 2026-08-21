// ===== PRESENTATION LAYER (TopNav) =====
// The one persistent, shared element across every screen and every module -
// matches the nav bar spec used across the whole app (7 items: Home, Search,
// Ride, Trips, Message, Favourite, Profile). Search is the public ride-browsing
// surface; Ride is the authenticated hosting and joining workspace; Trips is the
// record of what already happened, which every ride app of this kind promotes to
// the bar rather than burying in a profile.
import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import { useNotifications } from '../../../context/NotificationContext.jsx';
import { getAuthNavigation } from '../../../business-logic/authAccess.js';
import { IconCar, IconHome, IconSearch, IconRoute, IconClock, IconMessage, IconHeart, IconUser, IconBell, IconLogOut } from '../icons.jsx';
import { NotificationPopover } from '../notifications/NotificationCenter.jsx';

const NAV_ITEMS = [
  { to: '/home', label: 'Home', Icon: IconHome },
  { to: '/search', label: 'Search', Icon: IconSearch },
  { to: '/ride', label: 'Ride', Icon: IconRoute, requiresAuth: true },
  { to: '/trip', label: 'Trips', Icon: IconClock, requiresAuth: true },
  { to: '/message', label: 'Message', Icon: IconMessage, requiresAuth: true },
  { to: '/favourite', label: 'Favourite', Icon: IconHeart, requiresAuth: true },
  { to: '/profile', label: 'Profile', Icon: IconUser, requiresAuth: true }
];

export default function TopNav() {
  const { user, signOut } = useAuth();
  const { unreadCount } = useNotifications();
  const navigate = useNavigate();
  const location = useLocation();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const notificationRef = useRef(null);
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
    const handlePointerDown = (event) => {
      if (!notificationRef.current?.contains(event.target)) setNotificationsOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setNotificationsOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [notificationsOpen]);

  return (
    <header className="topnav">
      <div className="topnav-brand">
        <div className="brand-icon"><IconCar size={18} /></div>
        <span className="brand-title">Let's Tumpang</span>
      </div>

      <nav className="topnav-links">
        {NAV_ITEMS.map(({ to, label, Icon, requiresAuth }) => {
          const target = requiresAuth
            ? getAuthNavigation(user, to, `Sign in to open ${label}.`)
            : { to };
          return (
            <NavLink key={to} to={target.to} state={target.state} className={({ isActive }) => 'topnav-item' + (isActive ? ' active' : '')}>
              <span className="topnav-icon"><Icon size={18} /></span>
              <span className="nav-label">{label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="topnav-actions">
        {user ? <>
          <div className="notification-nav-wrap" ref={notificationRef}>
            <button
              className="icon-btn notification-bell"
              title="Notifications"
              type="button"
              aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}
              aria-expanded={notificationsOpen}
              aria-haspopup="dialog"
              onClick={() => setNotificationsOpen((open) => !open)}
            >
              <IconBell size={18} />
              {unreadCount > 0 && <span className="notification-badge" aria-hidden="true">{unreadCount > 99 ? '99+' : unreadCount}</span>}
            </button>
            {notificationsOpen && <NotificationPopover onClose={() => setNotificationsOpen(false)} />}
          </div>
          <div
            className="topnav-avatar"
            style={user.profilePhotoUrl ? { backgroundImage: `url(${user.profilePhotoUrl})` } : undefined}
            title={user.fullName || 'Profile'}
          >
            {!user.profilePhotoUrl && initials}
          </div>
          <button className="icon-btn" title="Sign out" aria-label="Sign out" onClick={handleSignOut} type="button">
            <IconLogOut size={17} />
          </button>
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
  );
}
