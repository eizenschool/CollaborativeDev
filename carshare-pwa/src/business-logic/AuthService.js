// ===== BUSINESS LOGIC LAYER (AuthService) =====
import { supabase, isSupabaseConfigured } from '../data-access/supabaseClient.js';
import { mockDb } from '../data-access/mockDataStore.js';

// --- Business Logic Layer (3.1.2) ---
// 3.1.5(b): all reads/writes to the Data Processing Layer pass through service
// functions like this one, which validate and shape data before/after it reaches
// Supabase. src/presentation components must only ever import from src/business-logic,
// never from src/data-access directly.

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '');
}

function validatePassword(password) {
  return typeof password === 'string' && password.length >= 8;
}

export const AuthService = {
  backend: isSupabaseConfigured ? 'supabase' : 'mock',

  async signUp({ fullName, email, phone, password, method }) {
    if (method === 'email') {
      if (!fullName?.trim()) throw new Error('Full name is required.');
      if (!validateEmail(email)) throw new Error('Enter a valid email address.');
      if (!validatePassword(password)) throw new Error('Password must be at least 8 characters.');
    } else if (method === 'phone') {
      if (!fullName?.trim()) throw new Error('Full name is required.');
      if (!phone?.trim()) throw new Error('Enter a valid phone number.');
    }

    if (isSupabaseConfigured) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName, phone } }
      });
      if (error) {
        // Supabase returns a generic 422 for an already-registered email; normalize it
        // to the same DUPLICATE_EMAIL code the mock backend uses, so the GUI layer's
        // error handling doesn't need to know which backend is active.
        if (/already registered/i.test(error.message)) {
          const err = new Error('An account with this email already exists.');
          err.code = 'DUPLICATE_EMAIL';
          throw err;
        }
        throw error;
      }
      return data.user;
    }

    return mockDb.signUp({ fullName, email, password });
  },

  async signIn({ email, password }) {
    if (!validateEmail(email)) throw new Error('Enter a valid email address.');
    if (!password) throw new Error('Password is required.');

    if (isSupabaseConfigured) {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return data.user;
    }

    return mockDb.signIn({ email });
  },

  async signOut() {
    if (isSupabaseConfigured) {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      return;
    }
    // mock backend: no-op, session concept is simplified to "currentUserId"
  },

  async getCurrentUser() {
    if (isSupabaseConfigured) {
      const { data } = await supabase.auth.getUser();
      return data.user;
    }
    return mockDb.getCurrentUser();
  }
};
