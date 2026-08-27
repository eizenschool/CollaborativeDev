// ===== PRESENTATION LAYER SUPPORT (AuthContext - shares session state across GUI components; delegates all real logic to business-logic/AuthService) =====
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { AuthService } from '../business-logic/AuthService.js';
import {
  AUTH_BOOTSTRAP_TIMEOUT_MS,
  getAuthProfileRefreshOptions,
  parseOAuthHashError,
  promiseWithTimeout
} from '../business-logic/authAccess.js';

const AuthContext = createContext(null);
const AUTH_RECOVERY_MESSAGE = 'Sign-in restoration is taking longer than expected.';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [oauthError, setOauthError] = useState(null);
  const [authRecoveryError, setAuthRecoveryError] = useState(null);
  const [retryingAuth, setRetryingAuth] = useState(false);

  // Runs once on the page load that Google/Supabase redirects back to. A
  // failed round trip (see parseOAuthHashError) never surfaces through
  // AuthService, so it has to be read directly off the URL here, then
  // stripped so it doesn't linger in the address bar or resurface on refresh.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const message = parseOAuthHashError(window.location.hash);
    if (!message) return;
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    setOauthError(message);
  }, []);

  const clearOauthError = useCallback(() => setOauthError(null), []);

  const refresh = useCallback(async ({ showLoading = true, preserveUser = false } = {}) => {
    if (showLoading) setLoading(true);
    try {
      const u = await promiseWithTimeout(AuthService.getCurrentUser());
      setUser(u);
      setAuthRecoveryError(null);
      return u;
    } catch {
      if (!preserveUser) setUser(null);
      setAuthRecoveryError(AUTH_RECOVERY_MESSAGE);
      return null;
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    let bootstrapFinished = false;
    let bootstrapTimer;

    const finishBootstrap = (authUser) => {
      if (!active) return;
      bootstrapFinished = true;
      window.clearTimeout(bootstrapTimer);
      setUser(AuthService.sessionUser(authUser));
      setAuthRecoveryError(null);
      setLoading(false);
    };

    const syncProfile = (authUser) => {
      if (!authUser) return;
      // Supabase recommends keeping onAuthStateChange callbacks short. Defer
      // profile I/O so it cannot hold up INITIAL_SESSION or the App Shell.
      window.setTimeout(() => {
        if (!active) return;
        void AuthService.getProfileForAuthUser(authUser)
          .then((profile) => {
            if (active && profile) setUser(profile);
          })
          .catch(() => {
            // Keep the session-derived user mounted. A transient profile error
            // must not turn a signed-in screen into a sign-out or loading loop.
          });
      }, 0);
    };

    bootstrapTimer = window.setTimeout(() => {
      if (!active || bootstrapFinished) return;
      bootstrapFinished = true;
      setLoading(false);
      setAuthRecoveryError(AUTH_RECOVERY_MESSAGE);
    }, AUTH_BOOTSTRAP_TIMEOUT_MS);

    const unsubscribe = AuthService.onAuthStateChange((event, authUser) => {
      if (!active) return;
      if (event === 'SIGNED_OUT') {
        finishBootstrap(null);
        return;
      }

      if (event === 'INITIAL_SESSION') {
        finishBootstrap(authUser);
        syncProfile(authUser);
        return;
      }

      const refreshOptions = getAuthProfileRefreshOptions(event);
      if (refreshOptions && authUser) {
        if (!bootstrapFinished) finishBootstrap(authUser);
        // Supabase re-emits SIGNED_IN or TOKEN_REFRESHED when a hidden tab
        // returns to the foreground. Keep the profile fresh without replacing
        // the current route with the app-wide startup screen.
        syncProfile(authUser);
      }
    });

    if (AuthService.backend !== 'supabase') {
      void AuthService.getCurrentUser()
        .then((currentUser) => {
          if (!active) return;
          bootstrapFinished = true;
          window.clearTimeout(bootstrapTimer);
          setUser(currentUser);
          setLoading(false);
        })
        .catch(() => finishBootstrap(null));
    }

    return () => {
      active = false;
      window.clearTimeout(bootstrapTimer);
      unsubscribe();
    };
  }, []);

  const retryAuth = useCallback(async () => {
    setRetryingAuth(true);
    try {
      const currentUser = await promiseWithTimeout(AuthService.getCurrentUser());
      setUser(currentUser);
      setAuthRecoveryError(null);
      return currentUser;
    } catch {
      setAuthRecoveryError(AUTH_RECOVERY_MESSAGE);
      return null;
    } finally {
      setRetryingAuth(false);
    }
  }, []);

  const signUp = async (form) => {
    const result = await AuthService.signUp(form);
    setUser(result.user);
    setAuthRecoveryError(null);
    return result;
  };

  const signIn = async (form) => {
    const u = await AuthService.signIn(form);
    setUser(u);
    setAuthRecoveryError(null);
    return u;
  };

  // No `setUser` here: this redirects the browser to Google and back, so the
  // signed-in user only becomes known once Supabase emits the restored session
  // after the redirect; the listener above mounts it without a second auth call.
  const signInWithGoogle = async () => {
    await AuthService.signInWithGoogle();
  };

  const signOut = async () => {
    await AuthService.signOut();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      signUp,
      signIn,
      signInWithGoogle,
      signOut,
      refresh,
      retryAuth,
      retryingAuth,
      authRecoveryError,
      setUser,
      oauthError,
      clearOauthError
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
