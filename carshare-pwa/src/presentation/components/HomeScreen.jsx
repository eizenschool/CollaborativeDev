// ===== PRESENTATION LAYER (HomeScreen) =====
// The post-login landing page. Keeps the first screen a user sees simple - a
// greeting plus the handful of actions people actually come here to do -
// instead of dropping them straight into the denser Profile page.
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { IconRoute, IconCar, IconCheckCircle, IconUser, IconMapPin } from './icons.jsx';

const ACTIONS = [
  // Module 6. The greeting above asks "Where are you headed today?" - every other
  // action here assumes the user can already answer that. This one is for when
  // they cannot.
  { to: '/discover', Icon: IconMapPin, title: 'Not sure where to go?', sub: 'Discover destinations near you' },
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
        <h1>Hi, {firstName}</h1>
        <p>Where are you headed today?</p>
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
