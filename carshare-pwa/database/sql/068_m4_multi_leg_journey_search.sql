-- Module 4: privacy-safe two-leg journey fallback.
--
-- Matching uses confirmed ride endpoints privately. Only public ride-card data,
-- an approved catalogue transfer name/category, waiting time, and ETAs cross
-- the RPC boundary. No route geometry or confirmed endpoint identifiers do.

create index if not exists rides_transfer_destination_idx
  on public.rides (destination_place_id, departure_at)
  where status = 'Published' and seats_available > 0 and estimated_arrival_at is not null;

create index if not exists rides_transfer_pickup_idx
  on public.rides (pickup_place_id, departure_at)
  where status = 'Published' and seats_available > 0 and estimated_arrival_at is not null;

create or replace function private.search_public_multi_leg_journeys(
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
  p_language text default null
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
  v_pickup text := nullif(btrim(p_pickup), '');
  v_destination text := nullif(btrim(p_destination), '');
  v_destination_place_id text := nullif(btrim(p_destination_place_id), '');
  v_journey_scale text := nullif(btrim(p_journey_scale), '');
  v_vehicle_type text := lower(nullif(btrim(p_vehicle_type), ''));
  v_language text := lower(nullif(btrim(p_language), ''));
begin
  if v_pickup is null or (v_destination is null and v_destination_place_id is null) then
    raise exception 'Multi-leg matching requires a pickup and destination';
  end if;
  if char_length(v_pickup) > 120 or char_length(coalesce(v_destination, '')) > 120 then
    raise exception 'Search route text is too long';
  end if;
  if (v_destination_place_id is null) <> (p_radius_km is null) then
    raise exception 'Destination proximity requires both a place and radius';
  end if;
  if p_radius_km is not null and p_radius_km not in (5, 10, 25) then
    raise exception 'Destination radius must be 5, 10, or 25 kilometres';
  end if;
  if v_journey_scale is not null and v_journey_scale not in ('Urban', 'Intercity') then
    raise exception 'Unsupported journey scale';
  end if;
  if p_min_seats is null or p_min_seats not between 1 and 8 then
    raise exception 'Minimum seats must be between 1 and 8';
  end if;
  if cardinality(coalesce(p_tags, '{}')) > 8 then
    raise exception 'Too many restriction tags';
  end if;
  if p_min_rating is not null and p_min_rating not between 0 and 5 then
    raise exception 'Host rating must be between 0 and 5';
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
  ),
  transfer_points as (
    select p.source_place_id, p.name, p.category
    from public.places p
    where p.lifecycle_state in ('Active', 'Provisional', 'Stale')
      and (
        p.category = 'heritage'
        or lower(p.name) ~ '(^|[[:space:]])(r[[:space:]]*&[[:space:]]*r|rest[[:space:]]+(area|stop)|hentian)([[:space:]]|$)'
      )
  ),
  public_rides as (
    select
      r.id, r.host_id, r.pickup, r.destination,
      r.pickup_place_id, r.destination_place_id,
      r.departure_at, r.estimated_arrival_at, r.journey_scale,
      r.seats_total, r.seats_available, r.contribution, r.restriction_tags, r.status,
      v.vehicle_type,
      p.spoken_languages, p.full_name, p.profile_photo_url,
      coalesce(h.completed_trips, 0) as completed_trips,
      coalesce(h.co2_saved_kg, 0) as co2_saved_kg,
      coalesce(h.reputation_score, 0) as reputation_score,
      h.rating
    from public.rides r
    join public.vehicles v on v.id = r.vehicle_id and v.owner_id = r.host_id
    join public.profiles p on p.id = r.host_id and p.status = 'active'
    left join public.host_impact_stats h on h.user_id = r.host_id
    where r.status = 'Published'
      and r.seats_available >= p_min_seats
      and r.estimated_arrival_at is not null
      and r.estimated_arrival_at > r.departure_at
      and (v_journey_scale is null or r.journey_scale = v_journey_scale)
      and r.restriction_tags @> coalesce(p_tags, '{}')
      and (nullif(btrim(p_contribution), '') is null or r.contribution ilike '%' || btrim(p_contribution) || '%')
      and (p_min_rating is null or coalesce(h.rating, 0) >= p_min_rating)
      and (v_vehicle_type is null or v.vehicle_type = v_vehicle_type)
      and (v_language is null or v_language = any(p.spoken_languages))
  ),
  matched as (
    select
      l1, l2, tp.name as transfer_name, tp.category as transfer_category,
      round(extract(epoch from (l2.departure_at - l1.estimated_arrival_at)) / 60)::integer as transfer_wait_minutes,
      n.distance_km
    from public_rides l1
    join transfer_points tp on tp.source_place_id = l1.destination_place_id
    join public_rides l2 on l2.pickup_place_id = tp.source_place_id and l2.id <> l1.id
    left join nearby_destinations n on n.source_place_id = l2.destination_place_id
    where l1.pickup ilike '%' || v_pickup || '%'
      and (p_departure_start is null or l1.departure_at >= p_departure_start)
      and (p_departure_end is null or l1.departure_at < p_departure_end)
      and (p_depart_after is null or (l1.departure_at at time zone 'Asia/Kuala_Lumpur')::time >= p_depart_after)
      and (
        (v_destination_place_id is null and l2.destination ilike '%' || v_destination || '%')
        or (v_destination_place_id is not null and n.source_place_id is not null)
      )
      and l2.departure_at >= l1.estimated_arrival_at + case
        when l1.journey_scale = 'Intercity' or l2.journey_scale = 'Intercity'
          then interval '3 hours'
        else interval '0 hours'
      end
  )
  select
    'multileg:' || (m.l1).id::text || ':' || (m.l2).id::text,
    'multi-leg'::text,
    m.transfer_name,
    m.transfer_category,
    m.transfer_wait_minutes,
    (m.l2).estimated_arrival_at,
    least((m.l1).seats_available, (m.l2).seats_available),
    case when (m.l1).journey_scale = 'Intercity' or (m.l2).journey_scale = 'Intercity'
      then 'Intercity' else 'Urban' end,
    case when m.distance_km is null then null
      else round(m.distance_km::numeric, 1)::double precision end,
    jsonb_build_array(
      jsonb_build_object(
        'id', (m.l1).id, 'hostId', (m.l1).host_id,
        'pickup', (m.l1).pickup, 'destination', (m.l1).destination,
        'departureAt', (m.l1).departure_at, 'estimatedArrivalAt', (m.l1).estimated_arrival_at,
        'journeyScale', (m.l1).journey_scale, 'seatsTotal', (m.l1).seats_total,
        'seatsAvailable', (m.l1).seats_available, 'contribution', (m.l1).contribution,
        'restrictionTags', (m.l1).restriction_tags, 'status', (m.l1).status,
        'vehicleType', (m.l1).vehicle_type,
        'host', jsonb_build_object(
          'id', (m.l1).host_id, 'fullName', (m.l1).full_name,
          'profilePhotoUrl', (m.l1).profile_photo_url,
          'completedTrips', (m.l1).completed_trips, 'co2SavedKg', (m.l1).co2_saved_kg,
          'reputationScore', (m.l1).reputation_score, 'rating', (m.l1).rating,
          'spokenLanguages', (m.l1).spoken_languages
        )
      ),
      jsonb_build_object(
        'id', (m.l2).id, 'hostId', (m.l2).host_id,
        'pickup', (m.l2).pickup, 'destination', (m.l2).destination,
        'departureAt', (m.l2).departure_at, 'estimatedArrivalAt', (m.l2).estimated_arrival_at,
        'journeyScale', (m.l2).journey_scale, 'seatsTotal', (m.l2).seats_total,
        'seatsAvailable', (m.l2).seats_available, 'contribution', (m.l2).contribution,
        'restrictionTags', (m.l2).restriction_tags, 'status', (m.l2).status,
        'vehicleType', (m.l2).vehicle_type,
        'host', jsonb_build_object(
          'id', (m.l2).host_id, 'fullName', (m.l2).full_name,
          'profilePhotoUrl', (m.l2).profile_photo_url,
          'completedTrips', (m.l2).completed_trips, 'co2SavedKg', (m.l2).co2_saved_kg,
          'reputationScore', (m.l2).reputation_score, 'rating', (m.l2).rating,
          'spokenLanguages', (m.l2).spoken_languages
        )
      )
    )
  from matched m
  order by (m.l1).departure_at, (m.l1).id, (m.l2).id
  limit 50;
end;
$$;

create or replace function public.search_public_multi_leg_journeys(
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
  p_language text default null
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
  select * from private.search_public_multi_leg_journeys(
    p_pickup, p_destination, p_departure_start, p_departure_end, p_depart_after,
    p_destination_place_id, p_radius_km, p_journey_scale, p_min_seats, p_tags,
    p_contribution, p_min_rating, p_vehicle_type, p_language
  );
$$;

revoke all on function private.search_public_multi_leg_journeys(
  text, text, timestamptz, timestamptz, time, text, integer, text, integer,
  text[], text, numeric, text, text
) from public, anon, authenticated;
grant usage on schema private to anon, authenticated;
grant execute on function private.search_public_multi_leg_journeys(
  text, text, timestamptz, timestamptz, time, text, integer, text, integer,
  text[], text, numeric, text, text
) to anon, authenticated;

revoke all on function public.search_public_multi_leg_journeys(
  text, text, timestamptz, timestamptz, time, text, integer, text, integer,
  text[], text, numeric, text, text
) from public, anon, authenticated;
grant execute on function public.search_public_multi_leg_journeys(
  text, text, timestamptz, timestamptz, time, text, integer, text, integer,
  text[], text, numeric, text, text
) to anon, authenticated;
