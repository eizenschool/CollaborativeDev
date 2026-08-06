// ===== PRESENTATION LAYER (TopNav) =====
// The one persistent, shared element across every screen and every module -
// matches the nav bar spec used across the whole app (6 items: Home, Search,
// Ride, Message, Favourite, Profile). Only "Profile" is wired to real Module 1
// screens here; the rest route to a lightweight ComingSoonScreen until their
// module lands, so the nav's final shape is demonstrable without faking
// functionality that isn't built yet.
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import { IconCar, IconHome, IconSearch, IconRoute, IconMessage, IconHeart, IconUser, IconBell, IconLogOut } from '../icons.jsx';

const NAV_ITEMS = [
  { to: '/home', label: 'Home', Icon: IconHome },
  { to: '/search', label: 'Search', Icon: IconSearch },
  { to: '/ride', label: 'Ride', Icon: IconRoute },
  { to: '/message', label: 'Message', Icon: IconMessage },
  { to: '/favourite', label: 'Favourite', Icon: IconHeart },
  { to: '/profile', label: 'Profile', Icon: IconUser }
];

export default function TopNav() {
  const { user, signOut } = useAuth();
  const initials = (user?.fullName || user?.user_metadata?.full_name || user?.email || '?')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <header className="topnav">
      <div className="topnav-brand">
        <div className="brand-icon"><IconCar size={18} /></div>
        <span className="brand-title">Let's Tumpang</span>
      </div>

      <nav className="topnav-links">
        {NAV_ITEMS.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => 'topnav-item' + (isActive ? ' active' : '')}>
            <span className="topnav-icon"><Icon size={18} /></span>
            <span className="nav-label">{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="topnav-actions">
        <button className="icon-btn" title="Notifications" type="button">
          <IconBell size={18} />
        </button>
        <div
          className="topnav-avatar"
          style={user?.profilePhotoUrl ? { backgroundImage: `url(${user.profilePhotoUrl})` } : undefined}
          title={user?.fullName || 'Profile'}
        >
          {!user?.profilePhotoUrl && initials}
        </div>
        <button className="icon-btn" title="Sign out" onClick={signOut} type="button">
          <IconLogOut size={17} />
        </button>
      </div>
    </header>
  );
}
