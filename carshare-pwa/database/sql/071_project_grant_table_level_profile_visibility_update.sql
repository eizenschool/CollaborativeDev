-- 073_m1_public_profile_visibility.sql and 070 granted only a column-
-- restricted UPDATE (show_profile_photo, show_spoken_languages,
-- show_completed_trips, show_eco_impact, updated_at) on profile_visibility.
-- Confirmed live: supabase-js's .upsert(), which PostgREST turns into
-- INSERT ... ON CONFLICT (user_id) DO UPDATE SET ..., does not accept that
-- column-restricted grant - Postgres itself reports "permission denied for
-- table profile_visibility" and its own hint asks for the plain table-level
-- grant below, not a narrower one.

grant update on table public.profile_visibility to authenticated;
