-- Module 2 confirmed route references and public pickup instructions.
-- Existing rides remain valid without route references; all newly created rides
-- must provide a confirmed pickup reference and destination Place ID.

alter table public.rides
  add column pickup_place_id text,
  add column pickup_latitude double precision,
  add column pickup_longitude double precision,
  add column destination_place_id text,
  add column pickup_instructions text,
  add constraint rides_pickup_coordinates_pair_check check (
    (pickup_latitude is null and pickup_longitude is null)
    or (pickup_latitude is not null and pickup_longitude is not null)
  ),
  add constraint rides_pickup_latitude_check check (
    pickup_latitude is null or pickup_latitude between -90 and 90
  ),
  add constraint rides_pickup_longitude_check check (
    pickup_longitude is null or pickup_longitude between -180 and 180
  ),
  add constraint rides_pickup_instructions_length_check check (
    char_length(pickup_instructions) <= 300
  );

-- Drop the previous signatures inside this transaction so PostgREST sees one
-- unambiguous function name after the replacement is committed.
drop function public.create_ride(uuid, text, text, timestamptz, text, integer, text, text[], jsonb, boolean);
drop function public.update_ride(uuid, uuid, text, text, timestamptz, text, integer, text, text[], jsonb);

create function public.create_ride(
  p_vehicle_id uuid,
  p_pickup text,
  p_destination text,
  p_departure_at timestamptz,
  p_journey_scale text,
  p_seats_total integer,
  p_pickup_place_id text default null,
  p_pickup_latitude double precision default null,
  p_pickup_longitude double precision default null,
  p_destination_place_id text default null,
  p_pickup_instructions text default '',
  p_contribution text default '',
  p_restriction_tags text[] default '{}',
  p_waypoints jsonb default '[]'::jsonb,
  p_publish boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_vehicle_seats integer;
  v_ride_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if nullif(btrim(p_pickup), '') is null
     or nullif(btrim(p_destination), '') is null
     or p_departure_at is null
     or p_journey_scale not in ('Urban', 'Intercity')
     or p_seats_total is null
     or p_seats_total < 1 then
    raise exception 'Complete ride details are required';
  end if;

  if nullif(btrim(p_pickup_place_id), '') is null
     and (p_pickup_latitude is null or p_pickup_longitude is null) then
    raise exception 'Choose a confirmed pickup location';
  end if;

  if nullif(btrim(p_destination_place_id), '') is null then
    raise exception 'Choose a confirmed destination';
  end if;

  if (p_pickup_latitude is null) <> (p_pickup_longitude is null)
     or (p_pickup_latitude is not null and p_pickup_latitude not between -90 and 90)
     or (p_pickup_longitude is not null and p_pickup_longitude not between -180 and 180) then
    raise exception 'Pickup coordinates are invalid';
  end if;

  if char_length(coalesce(p_pickup_instructions, '')) > 300 then
    raise exception 'Pickup instructions must be 300 characters or fewer';
  end if;

  if jsonb_typeof(p_waypoints) <> 'array' then
    raise exception 'Waypoints must be an array';
  end if;

  select v.seats
  into v_vehicle_seats
  from public.vehicles v
  where v.id = p_vehicle_id
    and v.owner_id = v_user_id;

  if v_vehicle_seats is null then
    raise exception 'Select a vehicle you own';
  end if;

  if p_seats_total > v_vehicle_seats then
    raise exception 'Available seats exceed vehicle capacity';
  end if;

  if p_publish and p_departure_at < now() + interval '5 hours' then
    raise exception 'Published rides must depart at least 5 hours from now';
  end if;

  insert into public.rides (
    host_id, vehicle_id, pickup, destination, pickup_place_id,
    pickup_latitude, pickup_longitude, destination_place_id,
    pickup_instructions, departure_at, journey_scale, seats_total,
    seats_available, contribution, restriction_tags, status, waypoints,
    published_at
  ) values (
    v_user_id, p_vehicle_id, btrim(p_pickup), btrim(p_destination),
    nullif(btrim(p_pickup_place_id), ''), p_pickup_latitude,
    p_pickup_longitude, nullif(btrim(p_destination_place_id), ''),
    btrim(coalesce(p_pickup_instructions, '')), p_departure_at,
    p_journey_scale, p_seats_total, p_seats_total,
    coalesce(p_contribution, ''), coalesce(p_restriction_tags, '{}'),
    case when p_publish then 'Published' else 'Draft' end,
    p_waypoints, case when p_publish then now() else null end
  )
  returning id into v_ride_id;

  return v_ride_id;
end;
$$;

create function public.update_ride(
  p_ride_id uuid,
  p_vehicle_id uuid,
  p_pickup text,
  p_destination text,
  p_departure_at timestamptz,
  p_journey_scale text,
  p_seats_total integer,
  p_pickup_place_id text default null,
  p_pickup_latitude double precision default null,
  p_pickup_longitude double precision default null,
  p_destination_place_id text default null,
  p_pickup_instructions text default '',
  p_contribution text default '',
  p_restriction_tags text[] default '{}',
  p_waypoints jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_ride public.rides%rowtype;
  v_vehicle_seats integer;
  v_legacy_route boolean;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into v_ride
  from public.rides
  where id = p_ride_id
  for update;

  if not found or v_ride.host_id <> v_user_id then
    raise exception 'Ride not found or permission denied';
  end if;

  if v_ride.status not in ('Draft', 'Published') then
    raise exception 'Only Draft or Published rides can be edited';
  end if;

  if exists (
    select 1 from public.ride_requests
    where ride_id = p_ride_id and status = 'Accepted'
  ) then
    raise exception 'A ride with accepted requests cannot be edited';
  end if;

  if nullif(btrim(p_pickup), '') is null
     or nullif(btrim(p_destination), '') is null
     or p_departure_at is null
     or p_journey_scale not in ('Urban', 'Intercity')
     or p_seats_total is null
     or p_seats_total < 1 then
    raise exception 'Complete ride details are required';
  end if;

  v_legacy_route := v_ride.pickup_place_id is null
    and v_ride.pickup_latitude is null
    and v_ride.pickup_longitude is null
    and v_ride.destination_place_id is null
    and nullif(btrim(p_pickup_place_id), '') is null
    and p_pickup_latitude is null
    and p_pickup_longitude is null
    and nullif(btrim(p_destination_place_id), '') is null;

  if not v_legacy_route then
    if nullif(btrim(p_pickup_place_id), '') is null
       and (p_pickup_latitude is null or p_pickup_longitude is null) then
      raise exception 'Choose a confirmed pickup location';
    end if;

    if nullif(btrim(p_destination_place_id), '') is null then
      raise exception 'Choose a confirmed destination';
    end if;
  elsif btrim(p_pickup) <> v_ride.pickup
     or btrim(p_destination) <> v_ride.destination then
    raise exception 'Legacy route locations cannot be changed without confirmed location references';
  end if;

  if (p_pickup_latitude is null) <> (p_pickup_longitude is null)
     or (p_pickup_latitude is not null and p_pickup_latitude not between -90 and 90)
     or (p_pickup_longitude is not null and p_pickup_longitude not between -180 and 180) then
    raise exception 'Pickup coordinates are invalid';
  end if;

  if char_length(coalesce(p_pickup_instructions, '')) > 300 then
    raise exception 'Pickup instructions must be 300 characters or fewer';
  end if;

  if jsonb_typeof(p_waypoints) <> 'array' then
    raise exception 'Waypoints must be an array';
  end if;

  select v.seats into v_vehicle_seats
  from public.vehicles v
  where v.id = p_vehicle_id
    and v.owner_id = v_user_id;

  if v_vehicle_seats is null then
    raise exception 'Select a vehicle you own';
  end if;

  if p_seats_total > v_vehicle_seats then
    raise exception 'Available seats exceed vehicle capacity';
  end if;

  if v_ride.status = 'Published' and p_departure_at < now() + interval '5 hours' then
    raise exception 'Published rides must depart at least 5 hours from now';
  end if;

  update public.rides
  set vehicle_id = p_vehicle_id,
      pickup = btrim(p_pickup),
      destination = btrim(p_destination),
      pickup_place_id = nullif(btrim(p_pickup_place_id), ''),
      pickup_latitude = p_pickup_latitude,
      pickup_longitude = p_pickup_longitude,
      destination_place_id = nullif(btrim(p_destination_place_id), ''),
      pickup_instructions = btrim(coalesce(p_pickup_instructions, '')),
      departure_at = p_departure_at,
      journey_scale = p_journey_scale,
      seats_total = p_seats_total,
      seats_available = p_seats_total,
      contribution = coalesce(p_contribution, ''),
      restriction_tags = coalesce(p_restriction_tags, '{}'),
      waypoints = p_waypoints
  where id = p_ride_id;

  return p_ride_id;
end;
$$;

revoke all on function public.create_ride(uuid, text, text, timestamptz, text, integer, text, double precision, double precision, text, text, text, text[], jsonb, boolean) from public, anon, authenticated;
revoke all on function public.update_ride(uuid, uuid, text, text, timestamptz, text, integer, text, double precision, double precision, text, text, text, text[], jsonb) from public, anon, authenticated;

grant execute on function public.create_ride(uuid, text, text, timestamptz, text, integer, text, double precision, double precision, text, text, text, text[], jsonb, boolean) to authenticated;
grant execute on function public.update_ride(uuid, uuid, text, text, timestamptz, text, integer, text, double precision, double precision, text, text, text, text[], jsonb) to authenticated;
