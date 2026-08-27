-- Re-applies public.profile_visibility's table-level grants in isolation.
-- Kept separate from 073_m1_public_profile_visibility.sql on purpose: that
-- file also revokes execute on private.profile_is_relevant_to_viewer, which
-- undoes 069_project_restore_private_schema_grants.sql's fix whenever 073
-- is re-run. Do not re-run 073 to fix a profile_visibility grant gap - run
-- this file instead, in any order relative to 069.

revoke all on table public.profile_visibility from public, anon, authenticated;
grant select, insert on table public.profile_visibility to authenticated;
grant update (show_profile_photo, show_spoken_languages, show_completed_trips, show_eco_impact, updated_at)
  on table public.profile_visibility to authenticated;
