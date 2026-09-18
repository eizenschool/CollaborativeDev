-- Public-first browsing contract for Modules 1 and 2.
-- Guests may read only Published rides from active Hosts and the safe public
-- profile/impact rows needed to render those ride cards. Precise coordinates,
-- Place IDs, pickup instructions, account-private data, vehicles, requests,
-- reviews, and messaging remain unavailable to anon.

drop policy if exists "anonymous users read active public profiles" on public.profiles;
drop policy if exists "anonymous users read active host impact stats" on public.host_impact_stats;
drop policy if exists "anonymous users browse active published rides" on public.rides;

create policy "anonymous users read active public profiles"
  on public.profiles for select to anon
  using (status = 'active');

create policy "anonymous users read active host impact stats"
  on public.host_impact_stats for select to anon
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = host_impact_stats.user_id
        and profiles.status = 'active'
    )
  );

create policy "anonymous users browse active published rides"
  on public.rides for select to anon
  using (
    status = 'Published'
    and exists (
      select 1
      from public.profiles
      where profiles.id = rides.host_id
        and profiles.status = 'active'
    )
  );

revoke all on table public.profiles from anon;
revoke all on table public.host_impact_stats from anon;
revoke all on table public.rides from anon;

grant select (id, full_name, profile_photo_url, status)
  on table public.profiles to anon;
grant select (user_id, completed_trips, co2_saved_kg, reputation_score, rating)
  on table public.host_impact_stats to anon;
grant select (
  id,
  host_id,
  pickup,
  destination,
  departure_at,
  journey_scale,
  seats_total,
  seats_available,
  contribution,
  restriction_tags,
  waypoints,
  status
) on table public.rides to anon;
