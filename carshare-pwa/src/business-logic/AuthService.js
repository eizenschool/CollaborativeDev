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

// Birthplace codes that JPN has never assigned. Everything else in 01-99 is a
// state, a federal territory, a foreign country of birth, or a documented
// "unknown" marker, so only this set can be rejected without turning away real
// MyKad holders.
const UNASSIGNED_BIRTHPLACE_CODES = new Set([
  '00', '17', '18', '19', '20', '69', '70', '73', '80', '81', '94', '95', '96', '97'
]);

// MyKad carries no check digit, so structural validity is the most an offline
// gate can prove: the YYMMDD segment must be a real calendar date and the
// birthplace code must be one JPN actually issues. The last four digits are a
// registration serial with no public rule, so they stay unchecked.
function isRealBirthDate(yymmdd) {
  const year = Number(yymmdd.slice(0, 2));
  const month = Number(yymmdd.slice(2, 4));
  const day = Number(yymmdd.slice(4, 6));
  if (month < 1 || month > 12 || day < 1) return false;
  // The century is not encoded, so the date is real when either reading is -
  // this only changes the answer for 29 February.
  return [1900 + year, 2000 + year].some(
    (fullYear) => day <= new Date(Date.UTC(fullYear, month, 0)).getUTCDate()
  );
}

// Malaysian MyKad format: 6-digit birthdate (YYMMDD) + 2-digit birthplace/state
// code + 4-digit serial, with or without the conventional dashes. This is a
// structural sign-up gate, not identity verification: nothing here proves the
// number belongs to the person entering it, so it must never grant a verified
// badge or reputation. The value itself is never persisted or sent to Supabase.
export function validateMalaysianIC(ic) {
  const trimmed = (ic || '').trim();
  if (!/^\d{6}-?\d{2}-?\d{4}$/.test(trimmed)) return false;
  const digits = trimmed.replace(/-/g, '');
  if (!isRealBirthDate(digits.slice(0, 6))) return false;
  return !UNASSIGNED_BIRTHPLACE_CODES.has(digits.slice(6, 8));
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
      // Migration 088 has handle_new_user() stamp profile_private.ic_checked_at
      // from this flag at account creation - the only point both the confirmed
      // and pending-confirmation sign-up paths pass through. The IC number
      // itself is still never sent.
      const options = { data: { full_name: fullName.trim(), ic_format_checked: true } };
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

  // AuthContext calls this from its onAuthStateChange listener on every
  // SIGNED_IN event, since that's the only sign-in-completion signal a
  // redirect-based flow (Google) fires - unlike signIn() above, which reactivates
  // inline because it gets the result of its own direct API call. Best-effort:
  // a failure here must not turn a successful sign-in into an error screen.
  async reactivateOnSignIn(userId) {
    if (!isSupabaseConfigured) return;
    await ProfileService.reactivateAccount(userId).catch(() => {});
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
