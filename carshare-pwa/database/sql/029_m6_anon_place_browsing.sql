-- Module 6 Destination Discovery: anonymous read access for the place
-- catalogue, extending the public browsing surface D017 already accepted for
-- rides (023) to Destination Discovery.
--
-- D017 (docs/ai/DECISIONS.md) says it directly: "a visitor who cannot yet name
-- a destination is exactly who [Discovery] serves, and it scores an anonymous
-- request with a neutral personal-affinity value rather than requiring an
-- account." `024_m6_destination_discovery.sql` granted SELECT to `authenticated`
-- only, which the module's own handover document (§8) already flagged as the
-- one piece of D017 left undeployed - "deliberately not widened unilaterally."
-- This is that deployment.
--
-- Same three-step shape as 023: a row-filtering policy, revoke all, then a
-- column-restricted grant - not `select *`.
--
-- Unlike 023, this policy filters rows where the authenticated policy (024,
-- `using (true)`) does not. That existing policy trusts the JS scoring layer
-- to keep Retired and Pending-Enrichment places out of view for a known,
-- accountable audience. Anonymous traffic is a new audience with no equivalent
-- guarantee - it can read PostgREST directly, bypassing any frontend filter -
-- so the filter goes in the policy instead of being assumed from the app.
-- Pending Enrichment is excluded too: a place awaiting its first enrichment
-- pass has no rating, photos, or description yet, so showing it would be a
-- broken card, not a hidden one.
drop policy if exists "anonymous users browse recommendable places" on public.places;

create policy "anonymous users browse recommendable places"
  on public.places for select to anon
  using (lifecycle_state in ('Active', 'Provisional', 'Stale'));

revoke all on table public.places from anon;

-- Column list mirrors 024's schema plus `reviews` (027), minus three fields:
--   source_place_id     - the one field Google's terms permit storing
--                          indefinitely; not ours to hand to an
--                          unauthenticated caller, and no frontend read path
--                          needs it.
--   state_before_demotion,
--   absence_counter     - internal lifecycle bookkeeping with no frontend
--                          consumer; absence_counter in particular would let
--                          a caller infer ingestion-cycle timing, which is
--                          operational detail, not catalogue content.
grant select (
  id, name, category, description, description_is_template,
  rating, review_count, lat, lng, state, photo_references, reviews,
  lifecycle_state, last_seen_at, created_at, updated_at
) on table public.places to anon;

-- Aggregate-only per SQL.md: place_latent_demand returns interest counts per
-- place, never per-user identities, so granting anon execute does not widen
-- what any caller can learn about a specific person.
grant execute on function public.place_latent_demand(date) to anon;
