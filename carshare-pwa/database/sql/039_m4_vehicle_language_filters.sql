-- Module 4 vehicle-category and Host-language compatibility filters.
-- Existing rows deliberately remain unclassified rather than receiving guessed values.
-- Depends on migrations 034 and 035.

alter table public.vehicles
  add column vehicle_type text,
  add constraint vehicles_vehicle_type_check
    check (
      vehicle_type is null
      or vehicle_type in ('sedan', 'hatchback', 'suv', 'mpv', 'pickup', 'van', 'other')
    );

alter table public.profiles
  add column spoken_languages text[] not null default '{}',
  add constraint profiles_spoken_languages_check
    check (
      cardinality(spoken_languages) <= 6
      and spoken_languages <@ array[
        'malay', 'english', 'mandarin', 'cantonese', 'tamil', 'other'
      ]::text[]
    );

grant insert (vehicle_type) on table public.vehicles to authenticated;
grant update (vehicle_type) on table public.vehicles to authenticated;
grant update (spoken_languages) on table public.profiles to authenticated;

create schema if not exists private;
revoke all on schema private from public;

create function private.search_public_rides_with_compatibility(
  p_pickup text default null,
  p_destination text default null,
  p_departure_start timestamptz default null,
  p_departure_end timestamptz default null,
  p_destination_place_id text default null,
  p_radius_km integer default null,
  p_vehicle_type text default null,
  p_language text default null
)
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
  estimated_arrival_at timestamptz,
  proximity_distance_km double precision,
  vehicle_type text,
  host_spoken_languages text[],
  host_full_name text,
  host_profile_photo_url text,
  host_completed_trips integer,
  host_co2_saved_kg numeric,
  host_reputation_score integer,
  host_rating numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_destination_place_id text := nullif(btrim(p_destination_place_id), '');
  v_vehicle_type text := lower(nullif(btrim(p_vehicle_type), ''));
  v_language text := lower(nullif(btrim(p_language), ''));
begin
  if (v_destination_place_id is null) <> (p_radius_km is null) then
    raise exception 'Destination proximity requires both a place and radius';
  end if;

  if p_radius_km is not null and p_radius_km not in (5, 10, 25) then
    raise exception 'Destination radius must be 5, 10, or 25 kilometres';
  end if;

  if v_vehicle_type is not null and v_vehicle_type not in (
    'sedan', 'hatchback', 'suv', 'mpv', 'pickup', 'van', 'other'
  ) then
    raise exception 'Unsupported vehicle category';
  end if;

  if v_language is not null and v_language not in (
    'malay', 'english', 'mandarin', 'cantonese', 'tamil', 'other'
  ) then
    raise exception 'Unsupported spoken language';
  end if;

  return query
  with centre as (
    select p.lat, p.lng
    from public.places p
    where p.source_place_id = v_destination_place_id
      and p.lifecycle_state in ('Active', 'Provisional', 'Stale')
    limit 1
  ),
  destination_distances as (
    select
      p.source_place_id,
      6371 * acos(
        least(1, greatest(-1,
          cos(radians(c.lat)) * cos(radians(p.lat))
            * cos(radians(p.lng) - radians(c.lng))
          + sin(radians(c.lat)) * sin(radians(p.lat))
        ))
      ) as distance_km
    from public.places p
    cross join centre c
    where p.lifecycle_state in ('Active', 'Provisional', 'Stale')
  ),
  nearby_destinations as (
    select d.source_place_id, d.distance_km
    from destination_distances d
    where d.distance_km <= p_radius_km
  )
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
    r.estimated_arrival_at,
    case when n.distance_km is null then null
      else round(n.distance_km::numeric, 1)::double precision end,
    v.vehicle_type,
    p.spoken_languages,
    p.full_name,
    p.profile_photo_url,
    coalesce(h.completed_trips, 0),
    coalesce(h.co2_saved_kg, 0),
    coalesce(h.reputation_score, 0),
    h.rating
  from public.rides r
  join public.vehicles v
    on v.id = r.vehicle_id
   and v.owner_id = r.host_id
  join public.profiles p
    on p.id = r.host_id
   and p.status = 'active'
  left join nearby_destinations n
    on n.source_place_id = r.destination_place_id
  left join public.host_impact_stats h
    on h.user_id = r.host_id
  where r.status = 'Published'
    and r.seats_available > 0
    and (nullif(btrim(p_pickup), '') is null or r.pickup ilike '%' || btrim(p_pickup) || '%')
    and (
      (v_destination_place_id is null
        and (nullif(btrim(p_destination), '') is null or r.destination ilike '%' || btrim(p_destination) || '%'))
      or (v_destination_place_id is not null and n.source_place_id is not null)
    )
    and (p_departure_start is null or r.departure_at >= p_departure_start)
    and (p_departure_end is null or r.departure_at < p_departure_end)
    and (v_vehicle_type is null or v.vehicle_type = v_vehicle_type)
    and (v_language is null or v_language = any(p.spoken_languages))
  order by r.departure_at, r.id;
end;
$$;

create function public.search_public_rides_with_compatibility(
  p_pickup text default null,
  p_destination text default null,
  p_departure_start timestamptz default null,
  p_departure_end timestamptz default null,
  p_destination_place_id text default null,
  p_radius_km integer default null,
  p_vehicle_type text default null,
  p_language text default null
)
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
  estimated_arrival_at timestamptz,
  proximity_distance_km double precision,
  vehicle_type text,
  host_spoken_languages text[],
  host_full_name text,
  host_profile_photo_url text,
  host_completed_trips integer,
  host_co2_saved_kg numeric,
  host_reputation_score integer,
  host_rating numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from private.search_public_rides_with_compatibility(
    p_pickup,
    p_destination,
    p_departure_start,
    p_departure_end,
    p_destination_place_id,
    p_radius_km,
    p_vehicle_type,
    p_language
  );
$$;

revoke all on function private.search_public_rides_with_compatibility(
  text, text, timestamptz, timestamptz, text, integer, text, text
) from public, anon, authenticated;
grant usage on schema private to anon, authenticated;
grant execute on function private.search_public_rides_with_compatibility(
  text, text, timestamptz, timestamptz, text, integer, text, text
) to anon, authenticated;

revoke all on function public.search_public_rides_with_compatibility(
  text, text, timestamptz, timestamptz, text, integer, text, text
) from public, anon, authenticated;
grant execute on function public.search_public_rides_with_compatibility(
  text, text, timestamptz, timestamptz, text, integer, text, text
) to anon, authenticated;

-- Keep Favourite cards on the same safe compatibility projection. The public
-- signature is replaced because PostgreSQL cannot alter a table return shape in place.
drop function public.list_my_favourite_rides();
drop function private.list_my_favourite_rides();

create function private.list_my_favourite_rides()
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
  vehicle_type text,
  host_spoken_languages text[],
  host_full_name text,
  host_profile_photo_url text,
  host_completed_trips integer,
  host_co2_saved_kg numeric,
  host_reputation_score integer,
  host_rating numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  return query
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
    v.vehicle_type,
    p.spoken_languages,
    p.full_name,
    p.profile_photo_url,
    coalesce(h.completed_trips, 0),
    coalesce(h.co2_saved_kg, 0),
    coalesce(h.reputation_score, 0),
    h.rating
  from public.ride_favourites f
  join public.rides r on r.id = f.ride_id
  join public.vehicles v on v.id = r.vehicle_id and v.owner_id = r.host_id
  join public.profiles p on p.id = r.host_id
  left join public.host_impact_stats h on h.user_id = r.host_id
  where f.user_id = auth.uid()
  order by f.created_at desc;
end;
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
  vehicle_type text,
  host_spoken_languages text[],
  host_full_name text,
  host_profile_photo_url text,
  host_completed_trips integer,
  host_co2_saved_kg numeric,
  host_reputation_score integer,
  host_rating numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.list_my_favourite_rides();
$$;

revoke all on function private.list_my_favourite_rides() from public, anon, authenticated;
grant execute on function private.list_my_favourite_rides() to authenticated;
revoke all on function public.list_my_favourite_rides() from public, anon, authenticated;
grant execute on function public.list_my_favourite_rides() to authenticated;
