// ===== PRESENTATION LAYER SUPPORT (AuthContext - shares session state across GUI components; delegates all real logic to business-logic/AuthService) =====
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { AuthService } from '../business-logic/AuthService.js';
import { getAuthProfileRefreshOptions, parseOAuthHashError } from '../business-logic/authAccess.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [oauthError, setOauthError] = useState(null);

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

  const refresh = useCallback(async ({ showLoading = true } = {}) => {
    if (showLoading) setLoading(true);
    try {
      const u = await AuthService.getCurrentUser();
      setUser(u);
    } catch {
      setUser(null);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    let active = true;
    const unsubscribe = AuthService.onAuthStateChange((event) => {
      if (!active) return;
      if (event === 'SIGNED_OUT') {
        setUser(null);
        setLoading(false);
        return;
      }
      const refreshOptions = getAuthProfileRefreshOptions(event);
      if (refreshOptions) {
        // Supabase re-emits SIGNED_IN or TOKEN_REFRESHED when a hidden tab
        // returns to the foreground. Keep the profile fresh without replacing
        // the current route with the app-wide startup screen.
        window.setTimeout(() => active && refresh(refreshOptions), 0);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [refresh]);

  const signUp = async (form) => {
    const result = await AuthService.signUp(form);
    setUser(result.user);
    return result;
  };

  const signIn = async (form) => {
    const u = await AuthService.signIn(form);
    setUser(u);
    return u;
  };

  // No `setUser` here: this redirects the browser to Google and back, so the
  // signed-in user only becomes known once Supabase fires SIGNED_IN after the
  // redirect - the effect above already listens for that and calls refresh().
  const signInWithGoogle = async () => {
    await AuthService.signInWithGoogle();
  };

  const signOut = async () => {
    await AuthService.signOut();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signUp, signIn, signInWithGoogle, signOut, refresh, setUser, oauthError, clearOauthError }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
