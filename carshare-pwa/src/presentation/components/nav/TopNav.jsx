// ===== PRESENTATION LAYER (TopNav) =====
// The one persistent, shared element across every screen and every module -
// matches the nav bar spec used across the whole app (6 items: Home, Search,
// Ride, Message, Favourite, Profile). Only "Profile" is wired to real Module 1
// screens here; the rest route to a lightweight ComingSoonScreen until their
// module lands, so the nav's final shape is demonstrable without faking
// functionality that isn't built yet.
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import { getAuthNavigation } from '../../../business-logic/authAccess.js';
import { IconCar, IconHome, IconSearch, IconRoute, IconMessage, IconHeart, IconUser, IconBell, IconLogOut } from '../icons.jsx';

const NAV_ITEMS = [
  { to: '/home', label: 'Home', Icon: IconHome },
  { to: '/search', label: 'Search', Icon: IconSearch },
  { to: '/ride', label: 'Ride', Icon: IconRoute },
  { to: '/message', label: 'Message', Icon: IconMessage, requiresAuth: true },
  { to: '/favourite', label: 'Favourite', Icon: IconHeart, requiresAuth: true },
  { to: '/profile', label: 'Profile', Icon: IconUser, requiresAuth: true }
];

export default function TopNav() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
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
          <button className="icon-btn" title="Notifications" type="button">
            <IconBell size={18} />
          </button>
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
