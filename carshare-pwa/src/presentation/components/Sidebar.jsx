// ===== PRESENTATION LAYER (Sidebar) =====
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';

const NAV_ITEMS = [
  { to: '/profile', icon: '\u2699\uFE0F', label: 'Profile Settings', sub: 'Info, Photo & Emergency' },
  { to: '/vehicles', icon: '\uD83D\uDE97', label: 'My Vehicles', sub: 'Add & manage vehicles' },
  { to: '/reputation', icon: '\u2B50', label: 'Reputation', sub: 'Score & public profile' },
  { to: '/host', icon: '\uD83D\uDCCA', label: 'Host Dashboard', sub: 'Impact score & badges' }
];

export default function Sidebar() {
  const { user, signOut } = useAuth();
  const initials = (user?.fullName || user?.user_metadata?.full_name || user?.email || '?')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-icon">🚗</div>
        <div>
          <div className="brand-title">Let's Tumpang</div>
          <div className="brand-subtitle">Community Carpooling</div>
        </div>
      </div>

      <nav>
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
          >
            <span className="nav-icon">{item.icon}</span>
            <span>
              <span className="nav-label">{item.label}</span>
              <span className="nav-sub">{item.sub}</span>
            </span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="avatar-dot">{initials}</div>
        <div>
          <div className="sidebar-user-name">{user?.fullName || user?.user_metadata?.full_name || 'Guest'}</div>
          <div className="sidebar-user-email">{user?.email}</div>
        </div>
        <button className="signout-btn" onClick={signOut}>Sign out</button>
      </div>
    </aside>
  );
}
