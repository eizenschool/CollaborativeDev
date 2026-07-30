// ===== PRESENTATION LAYER (Sidebar) =====
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { IconCar, IconHome, IconRoute, IconMessage, IconUser } from './icons.jsx';

// Home, Find/Publish Ride, and Messages belong to Modules 2-6 and aren't built yet -
// they're shown disabled so the global nav's final shape is visible without faking
// functionality. My Profile is Module 1 and is the only item that's live.
const COMING_SOON = [
  { Icon: IconHome, label: 'Home' },
  { Icon: IconRoute, label: 'Find / Publish Ride' },
  { Icon: IconMessage, label: 'Messages' }
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
        <div className="brand-icon"><IconCar size={18} /></div>
        <div>
          <div className="brand-title">Let's Tumpang</div>
          <div className="brand-subtitle">Community Carpooling</div>
        </div>
      </div>

      <nav>
        {COMING_SOON.map(({ Icon, label }) => (
          <div className="nav-item disabled" key={label} title="Coming in a later module">
            <span className="nav-icon"><Icon size={17} /></span>
            <span className="nav-label">{label}</span>
            <span className="nav-badge">Soon</span>
          </div>
        ))}
        <NavLink to="/profile" className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
          <span className="nav-icon"><IconUser size={17} /></span>
          <span className="nav-label">My Profile</span>
        </NavLink>
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
