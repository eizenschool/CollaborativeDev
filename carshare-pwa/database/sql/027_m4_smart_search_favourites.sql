-- Module 4 Smart Search & Favourites core persistence.
-- Numbered after Module 3's 025/026 migrations to keep deployment order unambiguous.
-- Depends on the deployed Module 1 and Module 2 schema through 020.
-- This file is repository-authored but must be deployed separately.

create table public.ride_favourites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  ride_id uuid not null references public.rides(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, ride_id)
);

create index ride_favourites_user_created_idx
  on public.ride_favourites (user_id, created_at desc);

alter table public.ride_favourites enable row level security;

create policy "users read their own ride favourites"
  on public.ride_favourites for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "users delete their own ride favourites"
  on public.ride_favourites for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.ride_favourites from public, anon, authenticated;

create function public.add_ride_favourite(p_ride_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.rides r
    join public.profiles p on p.id = r.host_id
    where r.id = p_ride_id
      and r.status = 'Published'
      and r.seats_available > 0
      and p.status = 'active'
  ) then
    raise exception 'Only an available published ride can be saved';
  end if;

  insert into public.ride_favourites (user_id, ride_id)
  values (v_user_id, p_ride_id)
  on conflict (user_id, ride_id) do nothing;
end;
$$;

create function public.remove_ride_favourite(p_ride_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.ride_favourites
  where user_id = auth.uid()
    and ride_id = p_ride_id;
$$;

create function public.list_my_favourite_rides()
returns table (
  ride_id uuid,
  host_id uuid,
  pickup text,
  destination text,
  departure_at timestamptz,
  journey_scale text,
  seats_total integer,
  seats_available integer,
  contribution text,
  restriction_tags text[],
  status text,
  favourited_at timestamptz,
  host_full_name text,
  host_profile_photo_url text,
  host_completed_trips integer,
  host_co2_saved_kg numeric,
  host_reputation_score integer,
  host_rating numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.id,
    r.host_id,
    r.pickup,
    r.destination,
    r.departure_at,
    r.journey_scale,
    r.seats_total,
    r.seats_available,
    r.contribution,
    r.restriction_tags,
    r.status,
    f.created_at,
    p.full_name,
    p.profile_photo_url,
    coalesce(h.completed_trips, 0),
    coalesce(h.co2_saved_kg, 0),
    coalesce(h.reputation_score, 0),
    h.rating
  from public.ride_favourites f
  join public.rides r on r.id = f.ride_id
  join public.profiles p on p.id = r.host_id
  left join public.host_impact_stats h on h.user_id = r.host_id
  where f.user_id = auth.uid()
  order by f.created_at desc;
$$;

revoke all on function public.add_ride_favourite(uuid) from public, anon, authenticated;
revoke all on function public.remove_ride_favourite(uuid) from public, anon, authenticated;
revoke all on function public.list_my_favourite_rides() from public, anon, authenticated;

grant execute on function public.add_ride_favourite(uuid) to authenticated;
grant execute on function public.remove_ride_favourite(uuid) to authenticated;
grant execute on function public.list_my_favourite_rides() to authenticated;
