import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { MessagingSessionProvider } from './context/MessagingSessionContext.jsx';
import { NotificationProvider } from './context/NotificationContext.jsx';
import { CallSessionProvider } from './context/CallSessionContext.jsx';
import CallOverlay from './presentation/components/messaging/CallOverlay.jsx';
import SOSAlertOverlay from './presentation/components/ride/SOSAlertOverlay.jsx';
import './presentation/styles/theme.css';

// Registers the offline-resilience Service Worker described in 3.1(a).
// vite-plugin-pwa injects this virtual module at build time.
import { registerSW } from 'virtual:pwa-register';

const SOS_ENABLED = import.meta.env.VITE_M2_SOS_ENABLED === 'true';

async function clearDevelopmentPwaState() {
  if (!('serviceWorker' in navigator)) return;
  const resetKey = 'lets-tumpang-dev-pwa-reset-v1';
  if (sessionStorage.getItem(resetKey)) return;

  const registrations = await navigator.serviceWorker.getRegistrations();
  const wasControlled = Boolean(navigator.serviceWorker.controller);
  if (!registrations.length && !wasControlled) return;

  sessionStorage.setItem(resetKey, 'done');
  await Promise.all(registrations.map((registration) => registration.unregister()));
  if ('caches' in globalThis) {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
  }
  if (wasControlled) globalThis.location.reload();
}

if (import.meta.env.DEV) {
  // A production worker previously installed on localhost can otherwise keep
  // serving an old application bundle to one Chrome profile while Vite serves
  // current source to another. Development must always be network-fresh.
  void clearDevelopmentPwaState();
} else {
  let updateSW;
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh: () => { void updateSW?.(true); },
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <NotificationProvider>
          <MessagingSessionProvider>
            <CallSessionProvider>
              <App />
              <CallOverlay />
              {SOS_ENABLED && <SOSAlertOverlay />}
            </CallSessionProvider>
          </MessagingSessionProvider>
        </NotificationProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
