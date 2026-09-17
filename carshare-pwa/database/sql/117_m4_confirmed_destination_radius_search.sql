-- Module 4: radius search around any passenger-confirmed destination.
--
-- The passenger's selected centre and private verified Ride destination
-- anchors are compared only inside the private schema. Public wrappers return
-- the established card/itinerary projection plus a rounded distance; they do
-- not return coordinates, endpoint identifiers, instructions, or geometry.

create schema if not exists private;
revoke all on schema private from public;

create function private.search_public_rides_near_confirmed_destination(
  p_pickup text default null,
  p_departure_start timestamptz default null,
  p_departure_end timestamptz default null,
  p_destination_search_place_id text default null,
  p_center_latitude double precision default null,
  p_center_longitude double precision default null,
  p_radius_km integer default null,
  p_vehicle_type text default null,
  p_language text default null,
  p_pickup_place_id text default null
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
  v_pickup text := nullif(btrim(p_pickup), '');
  v_destination_id text := nullif(btrim(p_destination_search_place_id), '');
  v_pickup_id text := nullif(btrim(p_pickup_place_id), '');
begin
  if v_destination_id is null then
    raise exception 'A confirmed destination is required';
  end if;
  if char_length(v_destination_id) > 512 or char_length(coalesce(v_pickup_id, '')) > 512 then
    raise exception 'Confirmed location identifier is too long';
  end if;
  if v_pickup_id is not null and v_pickup is null then
    raise exception 'Confirmed pickup requires its display text';
  end if;
  if p_center_latitude is null or p_center_latitude not between -90 and 90
    or p_center_longitude is null or p_center_longitude not between -180 and 180 then
    raise exception 'Destination coordinates are invalid';
  end if;
  if p_radius_km is null or p_radius_km not in (5, 10, 25) then
    raise exception 'Destination radius must be 5, 10, or 25 kilometres';
  end if;

  return query
  with candidates as (
    select c.*, r.pickup_place_id, v.destination_anchor_latitude, v.destination_anchor_longitude
    from private.search_public_rides_with_compatibility(
      case when v_pickup_id is null then v_pickup else null end,
      null,
      p_departure_start,
      p_departure_end,
      null,
      null,
      p_vehicle_type,
      p_language
    ) c
    join public.rides r on r.id = c.ride_id
    join private.m2_ride_verification v on v.ride_id = r.id
    where v_pickup_id is null
      or r.pickup_place_id = v_pickup_id
      or (r.pickup_place_id is null and r.pickup ilike '%' || v_pickup || '%')
  ),
  measured as (
    select c.*, private.m2_distance_metres(
      p_center_latitude,
      p_center_longitude,
      c.destination_anchor_latitude,
      c.destination_anchor_longitude
    ) / 1000.0 as distance_km
    from candidates c
  )
  select
    m.ride_id, m.host_id, m.pickup, m.destination, m.departure_at,
    m.journey_scale, m.seats_total, m.seats_available, m.contribution,
    m.restriction_tags, m.status, m.estimated_arrival_at,
    round(m.distance_km::numeric, 1)::double precision,
    m.vehicle_type, m.host_spoken_languages, m.host_full_name,
    m.host_profile_photo_url, m.host_completed_trips, m.host_co2_saved_kg,
    m.host_reputation_score, m.host_rating
  from measured m
  where m.distance_km <= p_radius_km
  order by m.departure_at, m.ride_id;
end;
$$;

create function public.search_public_rides_near_confirmed_destination(
  p_pickup text default null,
  p_departure_start timestamptz default null,
  p_departure_end timestamptz default null,
  p_destination_search_place_id text default null,
  p_center_latitude double precision default null,
  p_center_longitude double precision default null,
  p_radius_km integer default null,
  p_vehicle_type text default null,
  p_language text default null,
  p_pickup_place_id text default null
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
  select * from private.search_public_rides_near_confirmed_destination(
    p_pickup, p_departure_start, p_departure_end,
    p_destination_search_place_id, p_center_latitude, p_center_longitude,
    p_radius_km, p_vehicle_type, p_language, p_pickup_place_id
  );
$$;

revoke all on function private.search_public_rides_near_confirmed_destination(
  text, timestamptz, timestamptz, text, double precision, double precision,
  integer, text, text, text
) from public, anon, authenticated;
grant usage on schema private to anon, authenticated;
grant execute on function private.search_public_rides_near_confirmed_destination(
  text, timestamptz, timestamptz, text, double precision, double precision,
  integer, text, text, text
) to anon, authenticated;

revoke all on function public.search_public_rides_near_confirmed_destination(
  text, timestamptz, timestamptz, text, double precision, double precision,
  integer, text, text, text
) from public, anon, authenticated;
grant execute on function public.search_public_rides_near_confirmed_destination(
  text, timestamptz, timestamptz, text, double precision, double precision,
  integer, text, text, text
) to anon, authenticated;

create function private.search_public_multi_leg_journeys_near_confirmed_destination(
  p_pickup text,
  p_destination text default null,
  p_departure_start timestamptz default null,
  p_departure_end timestamptz default null,
  p_depart_after time default null,
  p_destination_place_id text default null,
  p_radius_km integer default null,
  p_journey_scale text default null,
  p_min_seats integer default 1,
  p_tags text[] default '{}',
  p_contribution text default null,
  p_min_rating numeric default null,
  p_vehicle_type text default null,
  p_language text default null,
  p_pickup_place_id text default null,
  p_destination_search_place_id text default null,
  p_center_latitude double precision default null,
  p_center_longitude double precision default null
)
returns table (
  journey_id text,
  journey_type text,
  transfer_point_name text,
  transfer_point_category text,
  wait_minutes integer,
  estimated_arrival_at timestamptz,
  seats_available integer,
  journey_scale text,
  proximity_distance_km double precision,
  legs jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_destination_id text := nullif(btrim(p_destination_search_place_id), '');
begin
  if nullif(btrim(p_pickup), '') is null or nullif(btrim(p_pickup_place_id), '') is null
    or v_destination_id is null then
    raise exception 'Multi-leg matching requires confirmed route endpoints';
  end if;
  if nullif(btrim(p_destination_place_id), '') is not null then
    raise exception 'Catalogue and confirmed-destination radius modes cannot be combined';
  end if;
  if char_length(v_destination_id) > 512 then
    raise exception 'Confirmed destination identifier is too long';
  end if;
  if p_center_latitude is null or p_center_latitude not between -90 and 90
    or p_center_longitude is null or p_center_longitude not between -180 and 180 then
    raise exception 'Destination coordinates are invalid';
  end if;
  if p_radius_km is null or p_radius_km not in (5, 10, 25) then
    raise exception 'Destination radius must be 5, 10, or 25 kilometres';
  end if;

  return query
  with candidate_destination_ids as (
    select distinct r.destination_place_id
    from public.rides r
    join private.m2_ride_verification v on v.ride_id = r.id
    where r.status = 'Published'
      and r.seats_available > 0
      and r.destination_place_id is not null
      and private.m2_distance_metres(
        p_center_latitude, p_center_longitude,
        v.destination_anchor_latitude, v.destination_anchor_longitude
      ) <= p_radius_km * 1000.0
  ),
  exact_journeys as (
    select j.*
    from candidate_destination_ids d
    cross join lateral private.search_public_multi_leg_journeys_with_confirmed_locations(
      p_pickup,
      coalesce(nullif(btrim(p_destination), ''), 'Confirmed destination'),
      p_departure_start,
      p_departure_end,
      p_depart_after,
      null,
      null,
      p_journey_scale,
      p_min_seats,
      p_tags,
      p_contribution,
      p_min_rating,
      p_vehicle_type,
      p_language,
      p_pickup_place_id,
      d.destination_place_id
    ) j
  ),
  measured as (
    select j.*, private.m2_distance_metres(
      p_center_latitude,
      p_center_longitude,
      v.destination_anchor_latitude,
      v.destination_anchor_longitude
    ) / 1000.0 as distance_km
    from exact_journeys j
    join private.m2_ride_verification v
      on v.ride_id = split_part(j.journey_id, ':', 3)::uuid
  )
  select
    m.journey_id, m.journey_type, m.transfer_point_name,
    m.transfer_point_category, m.wait_minutes, m.estimated_arrival_at,
    m.seats_available, m.journey_scale,
    round(m.distance_km::numeric, 1)::double precision,
    m.legs
  from measured m
  where m.distance_km <= p_radius_km
  order by m.estimated_arrival_at, m.journey_id
  limit 50;
end;
$$;

create function public.search_public_multi_leg_journeys_near_confirmed_destination(
  p_pickup text,
  p_destination text default null,
  p_departure_start timestamptz default null,
  p_departure_end timestamptz default null,
  p_depart_after time default null,
  p_destination_place_id text default null,
  p_radius_km integer default null,
  p_journey_scale text default null,
  p_min_seats integer default 1,
  p_tags text[] default '{}',
  p_contribution text default null,
  p_min_rating numeric default null,
  p_vehicle_type text default null,
  p_language text default null,
  p_pickup_place_id text default null,
  p_destination_search_place_id text default null,
  p_center_latitude double precision default null,
  p_center_longitude double precision default null
)
returns table (
  journey_id text,
  journey_type text,
  transfer_point_name text,
  transfer_point_category text,
  wait_minutes integer,
  estimated_arrival_at timestamptz,
  seats_available integer,
  journey_scale text,
  proximity_distance_km double precision,
  legs jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.search_public_multi_leg_journeys_near_confirmed_destination(
    p_pickup, p_destination, p_departure_start, p_departure_end, p_depart_after,
    p_destination_place_id, p_radius_km, p_journey_scale, p_min_seats, p_tags,
    p_contribution, p_min_rating, p_vehicle_type, p_language,
    p_pickup_place_id, p_destination_search_place_id,
    p_center_latitude, p_center_longitude
  );
$$;

revoke all on function private.search_public_multi_leg_journeys_near_confirmed_destination(
  text, text, timestamptz, timestamptz, time, text, integer, text, integer,
  text[], text, numeric, text, text, text, text, double precision, double precision
) from public, anon, authenticated;
grant execute on function private.search_public_multi_leg_journeys_near_confirmed_destination(
  text, text, timestamptz, timestamptz, time, text, integer, text, integer,
  text[], text, numeric, text, text, text, text, double precision, double precision
) to anon, authenticated;

revoke all on function public.search_public_multi_leg_journeys_near_confirmed_destination(
  text, text, timestamptz, timestamptz, time, text, integer, text, integer,
  text[], text, numeric, text, text, text, text, double precision, double precision
) from public, anon, authenticated;
grant execute on function public.search_public_multi_leg_journeys_near_confirmed_destination(
  text, text, timestamptz, timestamptz, time, text, integer, text, integer,
  text[], text, numeric, text, text, text, text, double precision, double precision
) to anon, authenticated;
