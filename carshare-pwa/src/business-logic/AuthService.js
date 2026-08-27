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

// Malaysian MyKad format: 6-digit birthdate (YYMMDD) + 2-digit birthplace/state
// code + 4-digit serial, with or without the conventional dashes. This is a
// format-only sign-up gate - the value is never persisted or sent to Supabase.
export function validateMalaysianIC(ic) {
  return /^\d{6}-?\d{2}-?\d{4}$/.test((ic || '').trim());
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

export function buildSessionUser(authUser) {
  if (!authUser) return null;
  const metadata = authUser.user_metadata || {};
  const email = authUser.email || '';

  // This is a presentation-only fallback while the private profile query runs.
  // Server authorization continues to rely on the authenticated JWT and RLS,
  // never on editable user metadata.
  return {
    id: authUser.id,
    fullName: metadata.full_name || metadata.name || email.split('@')[0] || 'Member',
    spokenLanguages: [],
    email,
    phone: '',
    emergencyContact: { name: '', phone: '', relationship: '' },
    profilePhotoUrl: metadata.avatar_url || metadata.picture || null,
    status: 'active',
    createdAt: authUser.created_at || null
  };
}

export const AuthService = {
  backend: isSupabaseConfigured ? 'supabase' : 'mock',

  async signUp({ fullName, email, password, icNumber }) {
    if (!fullName?.trim()) throw new Error('Full name is required.');
    if (!validateEmail(email)) throw new Error('Enter a valid email address.');
    if (!validatePassword(password)) throw new Error('Password must be at least 8 characters.');
    if (!validateMalaysianIC(icNumber)) {
      throw new Error('Enter a valid Malaysian IC number, e.g. 990101-14-5678.');
    }

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

  // Google Sign-In/Sign-Up share one Supabase call: `signInWithOAuth` upserts
  // the auth.users row either way, then the 008 handle_new_user() trigger
  // creates the matching profiles/profile_private/host_impact_stats rows the
  // same as email/password sign-up does (it already reads raw_user_meta_data's
  // full_name/name/avatar_url/picture fallbacks, which is what Google supplies).
  // This redirects the browser away and back, so unlike signUp/signIn it does
  // not return the signed-in user directly - AuthContext's onAuthStateChange
  // listener picks up the SIGNED_IN event after the redirect completes.
  async signInWithGoogle() {
    if (!isSupabaseConfigured) {
      throw new Error('Google sign-in needs a live Supabase connection. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.local first.');
    }

    const options = {};
    if (typeof window !== 'undefined') options.redirectTo = window.location.origin;

    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options });
    if (error) throw error;
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

  sessionUser(authUser) {
    return buildSessionUser(authUser);
  },

  async getProfileForAuthUser(authUser) {
    if (!authUser) return null;
    if (isSupabaseConfigured) {
      return ProfileService.getProfile(authUser.id, authUser);
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
