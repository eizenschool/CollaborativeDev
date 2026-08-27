// ===== PRESENTATION LAYER (HomeScreen) =====
// The public landing page. Guests can browse Home, Search, and Published Ride Detail;
// account-specific actions are protected by the shared route gate.
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { IconRoute, IconCar, IconCheckCircle, IconUser, IconLeaf } from './icons.jsx';
import DiscoverRail from './discover/DiscoverRail.jsx';
import { PageShell } from './ui/Primitives.jsx';

const ACTIONS = [
  { to: '/ride/publish', Icon: IconRoute, title: 'Publish a ride', sub: 'Offer your empty seats' },
  { to: '/search', Icon: IconCar, title: 'Find a ride', sub: 'Browse available rides' },
  { to: '/ride/requests', Icon: IconCheckCircle, title: 'My requests', sub: 'Track rides you asked to join' },
  { to: '/trip', Icon: IconLeaf, title: 'My impact', sub: 'CO₂ saved, trip history & leaderboard' },
  { to: '/profile', Icon: IconUser, title: 'My profile', sub: 'Vehicles, reputation & settings' }
];

export default function HomeScreen() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const firstName = (user?.fullName || '').split(' ')[0] || 'there';
  const initials = (user?.fullName || '?').split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase();

  return (
    <PageShell as="main" className="home-page" size="narrow">
      <div className="home-greeting">
        <div>
          <h1>{user ? `Hi, ${firstName}` : 'Travel better, together'}</h1>
          <p>{user ? 'Where are you headed today?' : 'Browse shared rides freely. Sign in only when you are ready to join, host, or manage your account.'}</p>
        </div>
        {user && (
          <button className="home-profile-shortcut" type="button" onClick={() => navigate('/profile')} aria-label="Open my profile">
            <span style={user.profilePhotoUrl ? { backgroundImage: `url(${user.profilePhotoUrl})` } : undefined}>
              {!user.profilePhotoUrl && initials}
            </span>
            <small>My profile</small>
          </button>
        )}
      </div>

      <section aria-labelledby="home-actions-title">
        <h2 className="home-section-title" id="home-actions-title">Plan your journey</h2>
        <div className="home-actions">
          {ACTIONS.map(({ to, Icon, title, sub }, index) => (
            <button
              key={to}
              className="home-action-card"
              onClick={() => navigate(to)}
              style={{ '--motion-delay': `${index * 40}ms` }}
              type="button"
            >
              <span className="home-action-icon"><Icon size={20} aria-hidden="true" /></span>
              <span>
                <span className="home-action-title">{title}</span>
                <span className="home-action-sub">{sub}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Module 6 - Destination Discovery. Every action above assumes the visitor
          can already name a destination; this is for when they cannot, which is
          most of the point for the guest arriving here for the first time. The
          rail owns its own data and renders nothing when it has nothing to show. */}
      <DiscoverRail />
    </PageShell>
  );
}
