import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import TopNav from './presentation/components/nav/TopNav.jsx';
import ComingSoonScreen from './presentation/components/placeholders/ComingSoonScreen.jsx';
import AuthPage from './presentation/components/AuthPage.jsx';
import MyProfile from './presentation/components/MyProfile.jsx';
import RideHub from './presentation/components/ride/RideHub.jsx';
import PublishRide from './presentation/components/ride/PublishRide.jsx';
import RideDetail from './presentation/components/ride/RideDetail.jsx';
import ManageRequests from './presentation/components/ride/ManageRequests.jsx';
import MyRequests from './presentation/components/ride/MyRequests.jsx';
import EditRide from './presentation/components/ride/EditRide.jsx';
import RateReview from './presentation/components/ride/RateReview.jsx';
import { IconHome, IconSearch, IconMessage, IconHeart } from './presentation/components/icons.jsx';

function AppShell() {
  return (
    <div className="app-shell">
      <TopNav />
      <Routes>
        {/* Profile Settings, My Vehicles, Reputation, Host Dashboard, and Account
            Settings are consolidated into one "My Profile" page (hero + in-page
            section rail) - see MyProfile.jsx. Old links to /vehicles, /reputation,
            /host still land on the right panel. */}
        <Route path="/profile" element={<MyProfile />} />
        <Route path="/vehicles" element={<Navigate to="/profile" replace />} />
        <Route path="/reputation" element={<Navigate to="/profile" replace />} />
        <Route path="/host" element={<Navigate to="/profile" replace />} />
        {/* Module 2 - Ride Sharing Management mobile flow. */}
        <Route path="/ride" element={<RideHub />} />
        <Route path="/ride/publish" element={<PublishRide />} />
        <Route path="/ride/requests" element={<MyRequests />} />
        <Route path="/ride/:rideId/requests" element={<ManageRequests />} />
        <Route path="/ride/:rideId/edit" element={<EditRide />} />
        <Route path="/ride/:rideId/review" element={<RateReview />} />
        <Route path="/ride/:rideId" element={<RideDetail />} />
        {/* Home, Search, Message, Favourite belong to Modules 3-6 and aren't
            built yet - each nav tab is a real, clickable route so the shared nav
            bar's final shape is demonstrable, backed by one shared stub screen
            instead of faking each one individually. */}
        <Route path="/home" element={<ComingSoonScreen icon={IconHome} label="Home" />} />
        <Route path="/search" element={<ComingSoonScreen icon={IconSearch} label="Search" />} />
        <Route path="/message" element={<ComingSoonScreen icon={IconMessage} label="Message" />} />
        <Route path="/favourite" element={<ComingSoonScreen icon={IconHeart} label="Favourite" />} />
        <Route path="*" element={<Navigate to="/profile" replace />} />
      </Routes>
    </div>
  );
}

function useOnlineStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);
  return online;
}

export default function App() {
  const { user, loading } = useAuth();
  const online = useOnlineStatus();

  if (loading) {
    return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading…</div>;
  }

  return (
    <>
      {!online && (
        <div className="offline-banner">
          You're offline — viewing cached screens. Anything you change here (writes) will sync once you're back online.
        </div>
      )}
      {!user ? (
        <Routes>
          <Route path="*" element={<AuthPage />} />
        </Routes>
      ) : (
        <AppShell />
      )}
    </>
  );
}
