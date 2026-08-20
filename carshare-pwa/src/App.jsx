import { useEffect, useState } from 'react';
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { resolveAuthReturnPath } from './business-logic/authAccess.js';
import { legacyRideSearchUrlFromParams } from './business-logic/SmartSearchService.js';
import TopNav from './presentation/components/nav/TopNav.jsx';
import AuthPage from './presentation/components/AuthPage.jsx';
import HomeScreen from './presentation/components/HomeScreen.jsx';
import MyProfile from './presentation/components/MyProfile.jsx';
import RideHub from './presentation/components/ride/RideHub.jsx';
import PublishRide from './presentation/components/ride/PublishRide.jsx';
import SafetyRoutes from './presentation/components/safety/SafetyRoutes.jsx';
import DiscoverRoutes from './presentation/components/discover/DiscoverRoutes.jsx';
import RideDetail from './presentation/components/ride/RideDetail.jsx';
import ManageRequests from './presentation/components/ride/ManageRequests.jsx';
import MyRequests from './presentation/components/ride/MyRequests.jsx';
import EditRide from './presentation/components/ride/EditRide.jsx';
import RateReview from './presentation/components/ride/RateReview.jsx';
import MessageModule from './presentation/components/messaging/MessageModule.jsx';
import TripModule from './presentation/components/trip/TripModule.jsx';
import TripDetail from './presentation/components/trip/TripDetail.jsx';
import NotificationCenter from './presentation/components/notifications/NotificationCenter.jsx';
import SearchModule from './presentation/components/search/SearchModule.jsx';
import FavouritePage from './presentation/components/search/FavouritePage.jsx';

function RequireAuth({ children, reason = 'Sign in to use this service.' }) {
  const { user } = useAuth();
  const location = useLocation();

  if (!user) {
    const from = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to="/auth" replace state={{ from, reason }} />;
  }

  return children;
}

function AuthEntry() {
  const { user } = useAuth();
  const location = useLocation();
  return user
    ? <Navigate to={resolveAuthReturnPath(location.state)} replace />
    : <AuthPage />;
}

function RideEntry() {
  const location = useLocation();
  const legacySearchUrl = legacyRideSearchUrlFromParams(location.search);

  if (legacySearchUrl) return <Navigate to={legacySearchUrl} replace />;

  return (
    <RequireAuth reason="Sign in to manage the rides you host or requested.">
      <RideHub />
    </RequireAuth>
  );
}

function ServiceWorkerNotificationNavigation() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!navigator.serviceWorker) return undefined;
    const handleMessage = (event) => {
      const actionPath = event.data?.type === 'notification-click' ? event.data.actionPath : null;
      if (typeof actionPath === 'string' && actionPath.startsWith('/') && !actionPath.startsWith('//') && !actionPath.includes('\\')) {
        navigate(actionPath);
      }
    };
    navigator.serviceWorker.addEventListener('message', handleMessage);
    return () => navigator.serviceWorker.removeEventListener('message', handleMessage);
  }, [navigate]);

  return null;
}

function AppShell() {
  return (
    <div className="app-shell">
      <TopNav />
      <ServiceWorkerNotificationNavigation />

      <Routes>
        {/* Profile Settings, My Vehicles, Reputation, Host Dashboard, and Account
            Settings are consolidated into one "My Profile" page (hero + in-page
            section rail) - see MyProfile.jsx. Old links to /vehicles, /reputation,
            /host still land on the right panel. */}
        <Route path="/profile" element={<RequireAuth reason="Sign in to view your profile."><MyProfile /></RequireAuth>} />
        <Route path="/vehicles" element={<Navigate to="/profile" replace />} />
        <Route path="/reputation" element={<Navigate to="/profile" replace />} />
        <Route path="/host" element={<Navigate to="/profile" replace />} />
        {/* Module 2 - Ride Sharing Management mobile flow. */}
        <Route path="/ride" element={<RideEntry />} />
        <Route path="/ride/publish" element={<RequireAuth reason="Sign in before publishing a ride."><PublishRide /></RequireAuth>} />
        <Route path="/ride/requests" element={<RequireAuth reason="Sign in to view your ride requests."><MyRequests /></RequireAuth>} />
        <Route path="/ride/:rideId/requests" element={<RequireAuth reason="Sign in to manage ride requests."><ManageRequests /></RequireAuth>} />
        <Route path="/ride/:rideId/edit" element={<RequireAuth reason="Sign in to edit this ride."><EditRide /></RequireAuth>} />
        <Route path="/ride/:rideId/review" element={<RequireAuth reason="Sign in to review this ride."><RateReview /></RequireAuth>} />
        <Route path="/ride/:rideId" element={<RideDetail />} />
        {/* Home, Search, and Published Ride Detail form the public browsing
            surface. The Ride workspace and other personal destinations are guarded. */}
        <Route path="/home" element={<HomeScreen />} />
        <Route path="/search" element={<SearchModule />} />
        {/* Module 3 - Messaging */}
        <Route path="/message" element={<RequireAuth reason="Sign in to open your messages."><MessageModule /></RequireAuth>} />
        <Route path="/message/:conversationId" element={<RequireAuth reason="Sign in to open this conversation."><MessageModule /></RequireAuth>} />
        <Route path="/message/:conversationId/history" element={<RequireAuth reason="Sign in to view message history."><MessageModule /></RequireAuth>} />
        <Route path="/notifications" element={<RequireAuth reason="Sign in to view your notifications."><NotificationCenter /></RequireAuth>} />
        <Route path="/favourite" element={<RequireAuth reason="Sign in to view your favourite rides."><FavouritePage /></RequireAuth>} />
        {/* Module 5 - Trip Management & Eco Impact */}
        <Route path="/trip" element={<RequireAuth reason="Sign in to view your trips."><TripModule /></RequireAuth>} />
        <Route path="/trip/:tripId" element={<RequireAuth reason="Sign in to view this trip."><TripDetail /></RequireAuth>} />
        {/* Trip Verification, Exchange Settlement & Safety. Built under Module 6's
            former scope; now owned by Modules 1/2/3/5 - see
            docs/ai/modules/TRUST_SAFETY_HANDOVER.md. Everything under /safety is
            its own sub-router (SafetyRoutes.jsx). */}
        <Route path="/safety/*" element={<RequireAuth reason="Sign in to use trust and safety services."><SafetyRoutes /></RequireAuth>} />
        {/* Module 6 - Destination Discovery: recommends where to go to a traveller
            who has no destination in mind, then hands off to Module 4 (find a ride)
            or Module 2 (publish one). Public, like the other browsing surfaces: a
            visitor who cannot yet name a destination is precisely who this module
            exists for, and the service already scores an anonymous request with a
            neutral affinity rather than requiring an account. */}
        <Route path="/discover/*" element={<DiscoverRoutes />} />
        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </div>
  );
}

function useOnlineStatus() {
  const [online, setOnline] = useState(
    navigator.onLine,
  );

  useEffect(() => {
    function handleGoOnline() {
      setOnline(true);
    }

    function handleGoOffline() {
      setOnline(false);
    }

    window.addEventListener(
      'online',
      handleGoOnline,
    );

    window.addEventListener(
      'offline',
      handleGoOffline,
    );

    return () => {
      window.removeEventListener(
        'online',
        handleGoOnline,
      );

      window.removeEventListener(
        'offline',
        handleGoOffline,
      );
    };
  }, []);

  return online;
}

export default function App() {
  const { loading } = useAuth();
  const online = useOnlineStatus();

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        Loading…
      </div>
    );
  }

  return (
    <>
      {!online && (
        <div className="offline-banner">
          You&apos;re offline — viewing cached screens.
          Anything you change here will sync once
          you&apos;re back online.
        </div>
      )}

      <Routes>
        <Route path="/auth" element={<AuthEntry />} />
        <Route path="*" element={<AppShell />} />
      </Routes>
    </>
  );
}
