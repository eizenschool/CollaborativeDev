import { lazy, useEffect, useState } from 'react';
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
import { Button } from './presentation/components/ui/Button.jsx';
import {
  RouteBoundary,
  RouteFocusManager,
  RouteLoading,
} from './presentation/components/ui/RouteState.jsx';
const SwipeRouteViewport = lazy(() => import('./presentation/components/ui/SwipeRouteViewport.jsx'));

const AuthPage = lazy(() => import('./presentation/components/AuthPage.jsx'));
const HomeScreen = lazy(() => import('./presentation/components/HomeScreen.jsx'));
const MyProfile = lazy(() => import('./presentation/components/MyProfile.jsx'));
const PublicProfile = lazy(() => import('./presentation/components/PublicProfile.jsx'));
const RideHub = lazy(() => import('./presentation/components/ride/RideHub.jsx'));
const PublishRide = lazy(() => import('./presentation/components/ride/PublishRide.jsx'));
const SafetyRoutes = lazy(() => import('./presentation/components/safety/SafetyRoutes.jsx'));
const DiscoverRoutes = lazy(() => import('./presentation/components/discover/DiscoverRoutes.jsx'));
const RideDetail = lazy(() => import('./presentation/components/ride/RideDetail.jsx'));
const ManageRequests = lazy(() => import('./presentation/components/ride/ManageRequests.jsx'));
const MyRequests = lazy(() => import('./presentation/components/ride/MyRequests.jsx'));
const EditRide = lazy(() => import('./presentation/components/ride/EditRide.jsx'));
const RateReview = lazy(() => import('./presentation/components/ride/RateReview.jsx'));
const MessageModule = lazy(() => import('./presentation/components/messaging/MessageModule.jsx'));
const TripModule = lazy(() => import('./presentation/components/trip/TripModule.jsx'));
const TripDetail = lazy(() => import('./presentation/components/trip/TripDetail.jsx'));
const NotificationCenter = lazy(() => import('./presentation/components/notifications/NotificationCenter.jsx'));
const SearchModule = lazy(() => import('./presentation/components/search/SearchModule.jsx'));
const FavouritePage = lazy(() => import('./presentation/components/search/FavouritePage.jsx'));
const FamilyLocationShare = lazy(() => import('./presentation/components/ride/FamilyLocationShare.jsx'));
const TrustedFamilyInvite = lazy(() => import('./presentation/components/ride/TrustedFamilyInvite.jsx'));
const SOSFamilyView = lazy(() => import('./presentation/components/ride/SOSFamilyView.jsx'));
const SOS_ENABLED = import.meta.env.VITE_M2_SOS_ENABLED === 'true';

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

function AppShell({ routeLocation }) {
  return (
    <div id="main-content" className="app-main" tabIndex={-1}>
      <ServiceWorkerNotificationNavigation />
      <div className="ui-route-transition" key={routeLocation.pathname}>
        <RouteBoundary>
          <Routes location={routeLocation}>
        {/* Profile Settings, My Vehicles, Reputation, Host Dashboard, and Account
            Settings are consolidated into one "My Profile" page (hero + in-page
            section rail) - see MyProfile.jsx. Old links to /vehicles, /reputation,
            /host still land on the right panel. */}
        <Route path="/profile" element={<RequireAuth reason="Sign in to view your profile."><MyProfile /></RequireAuth>} />
        <Route path="/users/:userId" element={<PublicProfile />} />
        <Route path="/vehicles" element={<Navigate to="/profile" replace />} />
        <Route path="/reputation" element={<Navigate to="/profile" replace />} />
        <Route path="/host" element={<Navigate to="/profile" replace />} />
        {/* Module 2 - Ride Sharing Management mobile flow. */}
        <Route path="/ride" element={<RideEntry />} />
        <Route path="/ride/publish" element={<RequireAuth reason="Sign in before publishing a ride."><PublishRide /></RequireAuth>} />
        <Route path="/ride/:rideId/publish" element={<RequireAuth reason="Sign in to continue this Draft."><PublishRide /></RequireAuth>} />
        <Route path="/ride/requests" element={<RequireAuth reason="Sign in to view your ride requests."><MyRequests /></RequireAuth>} />
        <Route path="/ride/:rideId/requests" element={<RequireAuth reason="Sign in to manage ride requests."><ManageRequests /></RequireAuth>} />
        <Route path="/ride/:rideId/edit" element={<RequireAuth reason="Sign in to edit this ride."><EditRide /></RequireAuth>} />
        <Route path="/ride/:rideId/review" element={<RequireAuth reason="Sign in to review this ride."><RateReview /></RequireAuth>} />
        <Route path="/ride/:rideId" element={<RideDetail />} />
        <Route path="/share/ride-location" element={<FamilyLocationShare />} />
        {SOS_ENABLED && <Route path="/family/invite" element={<RequireAuth reason="Sign in to accept this trusted family invitation."><TrustedFamilyInvite /></RequireAuth>} />}
        {SOS_ENABLED && <Route path="/sos/:eventId" element={<RequireAuth reason="Sign in to open this trusted family SOS alert."><SOSFamilyView /></RequireAuth>} />}
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
        </RouteBoundary>
      </div>
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

function OAuthErrorRedirect() {
  const { oauthError, clearOauthError } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!oauthError) return;
    navigate('/auth', { replace: true, state: { reason: oauthError } });
    clearOauthError();
  }, [oauthError, clearOauthError, navigate]);

  return null;
}

function AuthRecoveryNotice() {
  const { authRecoveryError, retryAuth, retryingAuth } = useAuth();
  if (!authRecoveryError) return null;

  return (
    <div className="auth-recovery-banner" role="alert" aria-live="assertive">
      <span>{authRecoveryError} You can keep browsing public pages or retry.</span>
      <Button
        className="auth-recovery-banner__button"
        loading={retryingAuth}
        loadingLabel="Retrying"
        onClick={retryAuth}
        size="small"
        variant="secondary"
      >
        Retry sign-in
      </Button>
    </div>
  );
}

export default function App() {
  const { loading } = useAuth();
  const online = useOnlineStatus();
  const location = useLocation();
  const showNavigation = location.pathname !== '/auth';

  if (loading) {
    return <RouteLoading label="Preparing Let's Tumpang" />;
  }

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <OAuthErrorRedirect />
      <RouteFocusManager />
      <AuthRecoveryNotice />
      {!online && (
        <div className="offline-banner" role="status" aria-live="polite">
          You&apos;re offline — viewing cached screens.
          Anything you change here will sync once
          you&apos;re back online.
        </div>
      )}

      <div className={showNavigation ? 'app-shell' : 'app-route-shell'}>
        {showNavigation && <TopNav />}
        <SwipeRouteViewport>
          <RouteBoundary>
            <Routes location={location}>
              <Route
                path="/auth"
                element={<div id="main-content" className="auth-main ui-route-transition" tabIndex={-1}><AuthEntry /></div>}
              />
              <Route path="*" element={<AppShell routeLocation={location} />} />
            </Routes>
          </RouteBoundary>
        </SwipeRouteViewport>
      </div>
    </>
  );
}
