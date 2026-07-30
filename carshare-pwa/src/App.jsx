import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import Sidebar from './presentation/components/Sidebar.jsx';
import AuthPage from './presentation/components/AuthPage.jsx';
import MyProfile from './presentation/components/MyProfile.jsx';

function AppShell() {
  return (
    <div className="app-shell">
      <Sidebar />
      <Routes>
        {/* Profile Settings, My Vehicles, Reputation, and Host Dashboard are consolidated
            into one "My Profile" page (hero + in-page section rail) - see MyProfile.jsx.
            Old links to /vehicles, /reputation, /host still land on the right panel. */}
        <Route path="/profile" element={<MyProfile />} />
        <Route path="/vehicles" element={<Navigate to="/profile" replace />} />
        <Route path="/reputation" element={<Navigate to="/profile" replace />} />
        <Route path="/host" element={<Navigate to="/profile" replace />} />
        {/* Module 2-6 routes get added here as they're built, without touching Module 1 */}
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
