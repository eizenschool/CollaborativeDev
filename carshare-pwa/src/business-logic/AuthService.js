// ===== BUSINESS LOGIC LAYER (AuthService) =====
import { supabase, isSupabaseConfigured } from '../data-access/supabaseClient.js';
import { mockDb } from '../data-access/mockDataStore.js';
import { ProfileService } from './ProfileService.js';

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '');
}

function validatePassword(password) {
  return typeof password === 'string' && password.length >= 8;
}

export function buildSignUpResult({ authUser, session, appUser }) {
  if (!session) {
    return {
      user: null,
      email: authUser?.email || '',
      requiresEmailConfirmation: true
    };
  }
  return {
    user: appUser,
    email: authUser?.email || appUser?.email || '',
    requiresEmailConfirmation: false
  };
}

export const AuthService = {
  backend: isSupabaseConfigured ? 'supabase' : 'mock',

  async signUp({ fullName, email, password }) {
    if (!fullName?.trim()) throw new Error('Full name is required.');
    if (!validateEmail(email)) throw new Error('Enter a valid email address.');
    if (!validatePassword(password)) throw new Error('Password must be at least 8 characters.');

    if (isSupabaseConfigured) {
      const options = { data: { full_name: fullName.trim() } };
      if (typeof window !== 'undefined') options.emailRedirectTo = window.location.origin;

      const { data, error } = await supabase.auth.signUp({ email, password, options });
      if (error) {
        if (/already registered/i.test(error.message)) {
          const duplicateError = new Error('An account with this email already exists.');
          duplicateError.code = 'DUPLICATE_EMAIL';
          throw duplicateError;
        }
        throw error;
      }

      const appUser = data.session
        ? await ProfileService.getProfile(data.user.id, data.user)
        : null;
      return buildSignUpResult({ authUser: data.user, session: data.session, appUser });
    }

    const user = await mockDb.signUp({ fullName, email, password });
    return buildSignUpResult({ authUser: user, session: { user }, appUser: user });
  },

  async signIn({ email, password }) {
    if (!validateEmail(email)) throw new Error('Enter a valid email address.');
    if (!password) throw new Error('Password is required.');

    if (isSupabaseConfigured) {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await ProfileService.reactivateAccount(data.user.id);
      return ProfileService.getProfile(data.user.id, data.user);
    }

    return mockDb.signIn({ email });
  },

  async signOut() {
    if (isSupabaseConfigured) {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    }
  },

  async getCurrentUser() {
    if (isSupabaseConfigured) {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionData.session) return null;
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      return data.user ? ProfileService.getProfile(data.user.id, data.user) : null;
    }
    return mockDb.getCurrentUser();
  },

  onAuthStateChange(listener) {
    if (!isSupabaseConfigured) return () => {};
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      listener(event, session?.user || null);
    });
    return () => data.subscription.unsubscribe();
  }
};
