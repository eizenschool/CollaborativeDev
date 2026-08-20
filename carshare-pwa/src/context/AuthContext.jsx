// ===== PRESENTATION LAYER SUPPORT (AuthContext - shares session state across GUI components; delegates all real logic to business-logic/AuthService) =====
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { AuthService } from '../business-logic/AuthService.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const u = await AuthService.getCurrentUser();
      setUser(u);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
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
      if (['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED'].includes(event)) {
        window.setTimeout(() => active && refresh(), 0);
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
    <AuthContext.Provider value={{ user, loading, signUp, signIn, signInWithGoogle, signOut, refresh, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
