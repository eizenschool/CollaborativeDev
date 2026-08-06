import { useEffect, useState } from 'react';
import {
  Navigate,
  Route,
  Routes,
} from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import TopNav from './presentation/components/nav/TopNav.jsx';
import ComingSoonScreen from './presentation/components/placeholders/ComingSoonScreen.jsx';
import AuthPage from './presentation/components/AuthPage.jsx';
import MyProfile from './presentation/components/MyProfile.jsx';
import RideHub from './presentation/components/ride/RideHub.jsx';
import PublishRide from './presentation/components/ride/PublishRide.jsx';
import MessageModule from './presentation/components/messaging/MessageModule.jsx';
import {
  IconHome,
  IconSearch,
  IconHeart,
} from './presentation/components/icons.jsx';

function AppShell() {
  return (
    <div className="app-shell">
      <TopNav />

      <Routes>
        {/* Profile Settings, My Vehicles, Reputation, Host Dashboard,
            and Account Settings are consolidated into one "My Profile"
            page. */}
        <Route
          path="/profile"
          element={<MyProfile />}
        />

        <Route
          path="/vehicles"
          element={
            <Navigate
              to="/profile"
              replace
            />
          }
        />

        <Route
          path="/reputation"
          element={
            <Navigate
              to="/profile"
              replace
            />
          }
        />

        <Route
          path="/host"
          element={
            <Navigate
              to="/profile"
              replace
            />
          }
        />

        {/* Module 2 - Ride Sharing Management */}
        <Route
          path="/ride"
          element={<RideHub />}
        />

        <Route
          path="/ride/publish"
          element={<PublishRide />}
        />

        {/* Shared navigation routes */}
        <Route
          path="/home"
          element={
            <ComingSoonScreen
              icon={IconHome}
              label="Home"
            />
          }
        />

        <Route
          path="/search"
          element={
            <ComingSoonScreen
              icon={IconSearch}
              label="Search"
            />
          }
        />

        {/* Module 3 - Messaging */}
        <Route
          path="/message"
          element={<MessageModule />}
        />

        <Route
          path="/favourite"
          element={
            <ComingSoonScreen
              icon={IconHeart}
              label="Favourite"
            />
          }
        />

        <Route
          path="*"
          element={
            <Navigate
              to="/profile"
              replace
            />
          }
        />
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
  const { user, loading } = useAuth();
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

      {!user ? (
        <Routes>
          <Route
            path="*"
            element={<AuthPage />}
          />
        </Routes>
      ) : (
        <AppShell />
      )}
    </>
  );
}