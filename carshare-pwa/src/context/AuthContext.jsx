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
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const signUp = async (form) => {
    const u = await AuthService.signUp(form);
    setUser(u);
    return u;
  };

  const signIn = async (form) => {
    const u = await AuthService.signIn(form);
    setUser(u);
    return u;
  };

  const signOut = async () => {
    await AuthService.signOut();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signUp, signIn, signOut, refresh, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
