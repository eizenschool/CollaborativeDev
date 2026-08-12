// ===== DATA ACCESS LAYER (supabaseClient) =====
import { createClient } from '@supabase/supabase-js';

// --- Data Processing Layer (3.1.3) ---
// Per 3.1.5(a): the GUI layer is PROHIBITED from importing this file directly.
// Only src/business-logic/* service modules may import supabaseClient.
//
// This project ships with no live Supabase project wired in (a student prototype
// should not embed real keys in a submitted assignment). Set VITE_SUPABASE_URL and
// VITE_SUPABASE_PUBLISHABLE_KEY in .env.local (see .env.example) to point this at a real
// Supabase project. Until then, `isSupabaseConfigured` is false and the Business
// Logic Layer services transparently fall back to the in-memory mock store in
// mockDataStore.js, so Module 1's screens are fully clickable out of the box.

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabasePublishableKey)
  : null;

// 3.1.3(f): the Microsoft Translator key is intentionally NOT referenced anywhere in
// src/presentation or src/business-logic. Translation (Module 3) will call a Supabase Edge
// Function (e.g. supabase.functions.invoke('translate', {...})) so the key only ever
// lives server-side as an env var on Supabase, never in this client bundle.
