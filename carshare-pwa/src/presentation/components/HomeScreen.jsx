// ===== PRESENTATION LAYER (HomeScreen) =====
// The public landing page. Guests can browse Home and Ride content first;
// account-specific actions are protected by the shared route gate.
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { IconRoute, IconCar, IconCheckCircle, IconUser } from './icons.jsx';

const ACTIONS = [
  { to: '/ride/publish', Icon: IconRoute, title: 'Publish a ride', sub: 'Offer your empty seats' },
  { to: '/ride', Icon: IconCar, title: 'Find a ride', sub: 'Browse available rides' },
  { to: '/ride/requests', Icon: IconCheckCircle, title: 'My requests', sub: 'Track rides you asked to join' },
  { to: '/profile', Icon: IconUser, title: 'My profile', sub: 'Vehicles, reputation & settings' }
];

export default function HomeScreen() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const firstName = (user?.fullName || '').split(' ')[0] || 'there';

  return (
    <div className="home-page">
      <div className="home-greeting">
        <h1>{user ? `Hi, ${firstName}` : 'Travel better, together'}</h1>
        <p>{user ? 'Where are you headed today?' : 'Browse shared rides freely. Sign in only when you are ready to join, host, or manage your account.'}</p>
      </div>

      <div className="home-actions">
        {ACTIONS.map(({ to, Icon, title, sub }) => (
          <button key={to} className="home-action-card" onClick={() => navigate(to)} type="button">
            <span className="home-action-icon"><Icon size={20} /></span>
            <span>
              <span className="home-action-title" style={{ display: 'block' }}>{title}</span>
              <span className="home-action-sub">{sub}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
