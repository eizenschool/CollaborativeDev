-- Module 4 destination-proximity search over Module 6's public place catalogue.
-- Depends on deployed migrations 020, 023, 024, 028-030 and the repository's
-- Module 4 favourite migration 034. Deployed and verified on 2026-08-20.

create schema if not exists private;
revoke all on schema private from public;

create function private.search_public_rides_near_destination(
  p_destination_place_id text,
  p_radius_km integer,
  p_pickup text default null,
  p_departure_start timestamptz default null,
  p_departure_end timestamptz default null
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
  if nullif(btrim(p_destination_place_id), '') is null then
    raise exception 'A recommended destination is required';
  end if;

  if p_radius_km is null or p_radius_km not in (5, 10, 25) then
    raise exception 'Destination radius must be 5, 10, or 25 kilometres';
  end if;

  return query
  with centre as (
    select p.lat, p.lng
    from public.places p
    where p.source_place_id = btrim(p_destination_place_id)
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
    round(n.distance_km::numeric, 1)::double precision,
    p.full_name,
    p.profile_photo_url,
    coalesce(h.completed_trips, 0),
    coalesce(h.co2_saved_kg, 0),
    coalesce(h.reputation_score, 0),
    h.rating
  from public.rides r
  join nearby_destinations n
    on n.source_place_id = r.destination_place_id
  join public.profiles p
    on p.id = r.host_id
   and p.status = 'active'
  left join public.host_impact_stats h
    on h.user_id = r.host_id
  where r.status = 'Published'
    and r.seats_available > 0
    and (nullif(btrim(p_pickup), '') is null or r.pickup ilike '%' || btrim(p_pickup) || '%')
    and (p_departure_start is null or r.departure_at >= p_departure_start)
    and (p_departure_end is null or r.departure_at < p_departure_end)
  order by r.departure_at, r.id;
end;
$$;

create function public.search_public_rides_near_destination(
  p_destination_place_id text,
  p_radius_km integer,
  p_pickup text default null,
  p_departure_start timestamptz default null,
  p_departure_end timestamptz default null
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
  from private.search_public_rides_near_destination(
    p_destination_place_id,
    p_radius_km,
    p_pickup,
    p_departure_start,
    p_departure_end
  );
$$;

revoke all on function private.search_public_rides_near_destination(
  text, integer, text, timestamptz, timestamptz
) from public, anon, authenticated;
grant usage on schema private to anon, authenticated;
grant execute on function private.search_public_rides_near_destination(
  text, integer, text, timestamptz, timestamptz
) to anon, authenticated;

revoke all on function public.search_public_rides_near_destination(
  text, integer, text, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.search_public_rides_near_destination(
  text, integer, text, timestamptz, timestamptz
) to anon, authenticated;
