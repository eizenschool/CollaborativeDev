import { isSupabaseConfigured, supabase } from '../shared/supabase/supabaseClient.js';

export const authSupabaseAdapter = {
  isConfigured: isSupabaseConfigured,

  signUp(credentials) {
    return supabase.auth.signUp(credentials);
  },

  signInWithPassword(credentials) {
    return supabase.auth.signInWithPassword(credentials);
  },

  signInWithOAuth(options) {
    return supabase.auth.signInWithOAuth(options);
  },

  signOut() {
    return supabase.auth.signOut();
  },

  getSession() {
    return supabase.auth.getSession();
  },

  getUser() {
    return supabase.auth.getUser();
  },

  onAuthStateChange(listener) {
    return supabase.auth.onAuthStateChange(listener);
  }
};
