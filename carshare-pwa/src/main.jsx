import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { MessagingSessionProvider } from './context/MessagingSessionContext.jsx';
import './presentation/styles/theme.css';

// Registers the offline-resilience Service Worker described in 3.1(a).
// vite-plugin-pwa injects this virtual module at build time.
import { registerSW } from 'virtual:pwa-register';
registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <MessagingSessionProvider>
          <App />
        </MessagingSessionProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
