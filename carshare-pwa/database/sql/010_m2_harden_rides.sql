-- Module 2 ride persistence, ownership constraints, indexes, grants, and RLS.

alter table public.rides
  add column waypoints jsonb not null default '[]'::jsonb,
  add constraint rides_waypoints_array_check
    check (jsonb_typeof(waypoints) = 'array');

alter table public.rides
  drop constraint rides_seats_available_check,
  add constraint rides_seats_available_check
    check (seats_available between 0 and seats_total);

alter table public.rides
  drop constraint rides_vehicle_id_fkey,
  add constraint rides_vehicle_owned_by_host_fkey
    foreign key (vehicle_id, host_id)
    references public.vehicles (id, owner_id)
    on delete set null (vehicle_id);

create index rides_host_created_at_idx
  on public.rides (host_id, created_at desc);
create index rides_status_date_idx
  on public.rides (status, date);
create index rides_vehicle_id_idx
  on public.rides (vehicle_id);

drop policy if exists "published rides are publicly readable" on public.rides;
drop policy if exists "hosts create their own rides" on public.rides;
drop policy if exists "hosts update their own rides" on public.rides;
drop policy if exists "hosts delete their own rides" on public.rides;

create policy "authenticated users browse active published rides"
  on public.rides for select to authenticated
  using (
    (select auth.uid()) = host_id
    or (
      status = 'Published'
      and exists (
        select 1
        from public.profiles
        where profiles.id = rides.host_id
          and profiles.status = 'active'
      )
    )
  );

create policy "hosts create their own rides"
  on public.rides for insert to authenticated
  with check ((select auth.uid()) = host_id);

create policy "hosts update their own rides"
  on public.rides for update to authenticated
  using ((select auth.uid()) = host_id)
  with check ((select auth.uid()) = host_id);

create policy "hosts delete their own rides"
  on public.rides for delete to authenticated
  using ((select auth.uid()) = host_id);

revoke all on table public.rides from public, anon, authenticated;
grant select on table public.rides to authenticated;
grant insert (
  host_id, vehicle_id, pickup, destination, date, time, journey_scale,
  seats_total, seats_available, contribution, restriction_tags, status, waypoints
) on table public.rides to authenticated;
grant update (
  vehicle_id, pickup, destination, date, time, journey_scale,
  seats_total, seats_available, contribution, restriction_tags, status, waypoints
) on table public.rides to authenticated;
grant delete on table public.rides to authenticated;
