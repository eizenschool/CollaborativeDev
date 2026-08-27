-- Restores anon/authenticated access to the shared `private` schema after
-- 067_m1_reputation_events_and_eligibility.sql reset it (create schema if
-- not exists private; revoke all on schema private from public, anon,
-- authenticated;) without re-granting usage afterward, unlike every other
-- migration that touches this shared schema (016_m3, 034_m4, 035_m4,
-- 039_m4). Because `revoke all` clears the schema's whole ACL regardless of
-- which earlier migration built it up, this broke Module 3 messaging,
-- Module 4 search/favourites, and 068_m1's own new profile RLS policies for
-- every anon/authenticated caller, not just Module 1's.

grant usage on schema private to anon, authenticated;

-- 068_m1_public_profile_visibility.sql revoked execute on this helper right
-- after defining it, but it is called directly inside the "anonymous users
-- read active published drivers" and "authenticated users read relevant
-- profiles" RLS policies on public.profiles, so both roles need to run it
-- for an ordinary profiles read, not just the function's owner.
grant execute on function private.profile_is_relevant_to_viewer(uuid, uuid)
  to anon, authenticated;
