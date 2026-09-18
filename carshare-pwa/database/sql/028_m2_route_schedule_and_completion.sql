-- Module 2 server-quoted routes, serialized Driver schedules, one-hour
-- publication/request cutoff, GPS check-in, and dual-confirmation completion.
--
-- This migration intentionally does not call Google. A trusted Edge Function
-- consumes the service-role-only quote RPCs after it has called Routes API and
-- verified the five-minute signed quote.

alter table public.rides
  add column route_distance_meters integer,
  add column route_duration_seconds integer,
  add column route_stopover_seconds integer,
  add column estimated_arrival_at timestamptz,
  add column schedule_buffer_until timestamptz,
  add column route_quoted_at timestamptz,
  add column route_quote_expires_at timestamptz,
  add column route_quote_id uuid,
  add constraint rides_route_distance_check check (
    route_distance_meters is null or route_distance_meters >= 0
  ),
  add constraint rides_route_duration_check check (
    route_duration_seconds is null or route_duration_seconds > 0
  ),
  add constraint rides_route_stopover_check check (
    route_stopover_seconds is null or route_stopover_seconds >= 0
  ),
  add constraint rides_route_schedule_pair_check check (
    (estimated_arrival_at is null and schedule_buffer_until is null)
    or (
      estimated_arrival_at is not null
      and schedule_buffer_until = estimated_arrival_at + interval '30 minutes'
      and estimated_arrival_at > departure_at
    )
  ),
  add constraint rides_route_quote_pair_check check (
    (route_quote_id is null and route_quoted_at is null and route_quote_expires_at is null)
    or (
      route_quote_id is not null
      and route_quoted_at is not null
      and route_quote_expires_at is not null
      and route_quote_expires_at <= route_quoted_at + interval '5 minutes'
      and route_quote_expires_at > route_quoted_at
    )
  );

alter table public.ride_requests
  add column boarding_status text not null default 'Pending',
  add column checked_in_at timestamptz,
  add column check_in_distance_meters integer,
  add column no_show_at timestamptz,
  add column no_show_marked_by uuid references public.profiles(id),
  add column arrival_confirmed_at timestamptz,
  add constraint ride_requests_boarding_status_check check (
    boarding_status in ('Pending', 'Checked In', 'No-show')
  ),
  add constraint ride_requests_check_in_pair_check check (
    (boarding_status <> 'Checked In' and checked_in_at is null and check_in_distance_meters is null)
    or (
      boarding_status = 'Checked In'
      and checked_in_at is not null
      and check_in_distance_meters between 0 and 200
      and no_show_at is null
      and no_show_marked_by is null
    )
  ),
  add constraint ride_requests_no_show_pair_check check (
    (boarding_status <> 'No-show' and no_show_at is null and no_show_marked_by is null)
    or (
      boarding_status = 'No-show'
      and no_show_at is not null
      and no_show_marked_by is not null
      and checked_in_at is null
      and check_in_distance_meters is null
      and arrival_confirmed_at is null
    )
  ),
  add constraint ride_requests_arrival_check check (
    arrival_confirmed_at is null or boarding_status = 'Checked In'
  );

create index rides_host_active_schedule_idx
  on public.rides (host_id, departure_at, schedule_buffer_until)
  where status in ('Published', 'Matched', 'In Transit');

create index ride_requests_ride_boarding_idx
  on public.ride_requests (ride_id, boarding_status)
  where status = 'Accepted';

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.m2_ride_verification (
  ride_id uuid primary key references public.rides(id) on delete cascade,
  pickup_anchor_latitude double precision not null check (pickup_anchor_latitude between -90 and 90),
  pickup_anchor_longitude double precision not null check (pickup_anchor_longitude between -180 and 180),
  destination_anchor_latitude double precision not null check (destination_anchor_latitude between -90 and 90),
  destination_anchor_longitude double precision not null check (destination_anchor_longitude between -180 and 180),
  driver_arrived_at timestamptz,
  driver_arrival_distance_meters integer check (
    driver_arrival_distance_meters is null or driver_arrival_distance_meters between 0 and 200
  ),
  passenger_confirmation_due_at timestamptz,
  completed_at timestamptz,
  constraint m2_driver_arrival_pair_check check (
    (driver_arrived_at is null and driver_arrival_distance_meters is null and passenger_confirmation_due_at is null)
    or (
      driver_arrived_at is not null
      and driver_arrival_distance_meters is not null
      and passenger_confirmation_due_at = driver_arrived_at + interval '24 hours'
    )
  )
);

create table private.m2_route_daily_usage (
  usage_date date primary key,
  request_count integer not null default 0 check (request_count between 0 and 250),
  updated_at timestamptz not null default now()
);

create table private.m2_route_usage_requests (
  request_id uuid primary key,
  usage_date date not null references private.m2_route_daily_usage(usage_date) on delete cascade,
  created_at timestamptz not null default now()
);

revoke all on table private.m2_ride_verification from public, anon, authenticated;
revoke all on table private.m2_route_daily_usage from public, anon, authenticated;
revoke all on table private.m2_route_usage_requests from public, anon, authenticated;

create or replace function private.m2_validate_waypoints(
  p_waypoints jsonb,
  p_require_confirmed boolean default true
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_waypoints is null or jsonb_typeof(p_waypoints) <> 'array' then
    raise exception 'Waypoints must be an array';
  end if;

  if jsonb_array_length(p_waypoints) > 10 then
    raise exception 'A ride can have at most 10 waypoints';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_waypoints) with ordinality as item(value, ordinal)
    where jsonb_typeof(value) <> 'object'
      or nullif(btrim(value ->> 'name'), '') is null
      or not case
        when coalesce(value ->> 'order', '') ~ '^[0-9]+$'
          then (value ->> 'order')::integer = ordinal - 1
        else false
      end
      or not case
        when coalesce(value ->> 'stopMinutes', '') ~ '^[0-9]+$'
          then (value ->> 'stopMinutes')::integer between 0 and 180
        else false
      end
      or (p_require_confirmed and nullif(btrim(value ->> 'placeId'), '') is null)
  ) then
    raise exception 'Each waypoint needs a confirmed place and a 0-180 minute stop';
  end if;
end;
$$;

revoke all on function private.m2_validate_waypoints(jsonb, boolean)
  from public, anon, authenticated;

create or replace function private.m2_distance_metres(
  p_latitude_a double precision,
  p_longitude_a double precision,
  p_latitude_b double precision,
  p_longitude_b double precision
)
returns double precision
language sql
immutable
strict
set search_path = ''
as $$
  select 6371000 * 2 * pg_catalog.asin(pg_catalog.sqrt(
    least(1.0,
      pg_catalog.power(pg_catalog.sin(pg_catalog.radians(p_latitude_b - p_latitude_a) / 2), 2)
      + pg_catalog.cos(pg_catalog.radians(p_latitude_a))
      * pg_catalog.cos(pg_catalog.radians(p_latitude_b))
      * pg_catalog.power(pg_catalog.sin(pg_catalog.radians(p_longitude_b - p_longitude_a) / 2), 2)
    )
  ));
$$;

revoke all on function private.m2_distance_metres(double precision, double precision, double precision, double precision)
  from public, anon, authenticated;

create or replace function private.m2_assert_schedule_available(
  p_host_id uuid,
  p_departure_at timestamptz,
  p_schedule_buffer_until timestamptz,
  p_exclude_ride_id uuid default null,
  p_reject_unquoted boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The profile row is the per-Driver mutex. Two concurrent publications for
  -- the same Driver cannot both pass the overlap check.
  perform 1
  from public.profiles
  where id = p_host_id
  for update;

  if not found then
    raise exception 'Driver profile not found';
  end if;

  if exists (
    select 1
    from public.rides r
    where r.host_id = p_host_id
      and r.status = 'In Transit'
      and (p_exclude_ride_id is null or r.id <> p_exclude_ride_id)
  ) then
    raise exception 'Complete your current In Transit ride before publishing another ride';
  end if;

  if p_reject_unquoted and exists (
    select 1
    from public.rides r
    where r.host_id = p_host_id
      and r.status in ('Published', 'Matched', 'In Transit')
      and r.schedule_buffer_until is null
      and (p_exclude_ride_id is null or r.id <> p_exclude_ride_id)
  ) then
    raise exception 'Reconfirm the route for your existing active Ride before publishing another Ride';
  end if;

  if exists (
    select 1
    from public.rides r
    where r.host_id = p_host_id
      and r.status in ('Published', 'Matched', 'In Transit')
      and r.schedule_buffer_until is not null
      and (p_exclude_ride_id is null or r.id <> p_exclude_ride_id)
      and r.departure_at < p_schedule_buffer_until
      and p_departure_at < r.schedule_buffer_until
  ) then
    raise exception 'This ride overlaps another active ride, including its 30-minute arrival buffer';
  end if;
end;
$$;

revoke all on function private.m2_assert_schedule_available(uuid, timestamptz, timestamptz, uuid, boolean)
  from public, anon, authenticated;

create or replace function public.consume_m2_route_quota(p_request_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usage_date date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_count integer;
begin
  if p_request_id is null then
    raise exception 'A route request id is required';
  end if;

  select d.request_count into v_count
  from private.m2_route_usage_requests r
  join private.m2_route_daily_usage d on d.usage_date = r.usage_date
  where r.request_id = p_request_id;

  if found then
    return v_count;
  end if;

  insert into private.m2_route_daily_usage (usage_date)
  values (v_usage_date)
  on conflict (usage_date) do nothing;

  select request_count into v_count
  from private.m2_route_daily_usage
  where usage_date = v_usage_date
  for update;

  if exists (select 1 from private.m2_route_usage_requests where request_id = p_request_id) then
    return v_count;
  end if;

  if v_count >= 250 then
    raise exception 'Daily Routes API limit reached. Try again after midnight Malaysia time';
  end if;

  insert into private.m2_route_usage_requests (request_id, usage_date)
  values (p_request_id, v_usage_date);

  update private.m2_route_daily_usage
  set request_count = request_count + 1,
      updated_at = now()
  where usage_date = v_usage_date
  returning request_count into v_count;

  return v_count;
end;
$$;

revoke all on function public.consume_m2_route_quota(uuid)
  from public, anon, authenticated;
grant execute on function public.consume_m2_route_quota(uuid) to service_role;

create or replace function public.preflight_m2_route_quote(
  p_host_id uuid,
  p_vehicle_id uuid,
  p_seats_total integer,
  p_ride_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vehicle_seats integer;
  v_ride public.rides%rowtype;
begin
  select seats into v_vehicle_seats
  from public.vehicles
  where id = p_vehicle_id and owner_id = p_host_id;
  if v_vehicle_seats is null then raise exception 'Select a vehicle you own'; end if;
  if p_seats_total > v_vehicle_seats then raise exception 'Available seats exceed vehicle capacity'; end if;

  if p_ride_id is not null then
    select * into v_ride from public.rides where id = p_ride_id;
    if not found or v_ride.host_id <> p_host_id or v_ride.status not in ('Draft', 'Published') then
      raise exception 'Ride not found or permission denied';
    end if;
    if exists (
      select 1 from public.ride_requests
      where ride_id = p_ride_id and status = 'Accepted'
    ) then
      raise exception 'A ride with accepted requests cannot be edited or newly published';
    end if;
  end if;

  if exists (
    select 1 from public.rides
    where host_id = p_host_id and status = 'In Transit'
      and (p_ride_id is null or id <> p_ride_id)
  ) then
    raise exception 'Complete your current In Transit ride before publishing another ride';
  end if;
  if p_ride_id is null and exists (
    select 1 from public.rides
    where host_id = p_host_id
      and status in ('Published', 'Matched', 'In Transit')
      and schedule_buffer_until is null
      and (p_ride_id is null or id <> p_ride_id)
  ) then
    raise exception 'Reconfirm the route for your existing active Ride before publishing another Ride';
  end if;
end;
$$;

revoke all on function public.preflight_m2_route_quote(uuid, uuid, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.preflight_m2_route_quote(uuid, uuid, integer, uuid)
  to service_role;

-- Browser clients may still create complete Drafts, but cannot publish through
-- this RPC. Published creation is service-mediated below.
create or replace function public.create_ride(
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
  if p_publish then
    raise exception 'Published rides require a fresh server route quote';
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

  perform private.m2_validate_waypoints(p_waypoints, true);

  select v.seats into v_vehicle_seats
  from public.vehicles v
  where v.id = p_vehicle_id and v.owner_id = v_user_id;

  if v_vehicle_seats is null then
    raise exception 'Select a vehicle you own';
  end if;
  if p_seats_total > v_vehicle_seats then
    raise exception 'Available seats exceed vehicle capacity';
  end if;

  insert into public.rides (
    host_id, vehicle_id, pickup, destination, pickup_place_id,
    pickup_latitude, pickup_longitude, destination_place_id,
    pickup_instructions, departure_at, journey_scale, seats_total,
    seats_available, contribution, restriction_tags, status, waypoints
  ) values (
    v_user_id, p_vehicle_id, btrim(p_pickup), btrim(p_destination),
    nullif(btrim(p_pickup_place_id), ''), p_pickup_latitude,
    p_pickup_longitude, nullif(btrim(p_destination_place_id), ''),
    btrim(coalesce(p_pickup_instructions, '')), p_departure_at,
    p_journey_scale, p_seats_total, p_seats_total,
    coalesce(p_contribution, ''), coalesce(p_restriction_tags, '{}'),
    'Draft', p_waypoints
  ) returning id into v_ride_id;

  return v_ride_id;
end;
$$;

-- Direct browser updates are restricted to Drafts. A Published Ride must be
-- re-quoted and updated through persist_quoted_ride().
create or replace function public.update_ride(
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
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found or v_ride.host_id <> v_user_id then
    raise exception 'Ride not found or permission denied';
  end if;
  if v_ride.status <> 'Draft' then
    raise exception 'Published rides must be edited through the route validation service';
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

  -- Legacy Draft waypoints may remain readable/editable, but the trusted
  -- publication function below always requires confirmed Place IDs.
  perform private.m2_validate_waypoints(p_waypoints, false);

  select v.seats into v_vehicle_seats
  from public.vehicles v
  where v.id = p_vehicle_id and v.owner_id = v_user_id;
  if v_vehicle_seats is null then
    raise exception 'Select a vehicle you own';
  end if;
  if p_seats_total > v_vehicle_seats then
    raise exception 'Available seats exceed vehicle capacity';
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
      waypoints = p_waypoints,
      route_distance_meters = null,
      route_duration_seconds = null,
      route_stopover_seconds = null,
      estimated_arrival_at = null,
      schedule_buffer_until = null,
      route_quoted_at = null,
      route_quote_expires_at = null,
      route_quote_id = null
  where id = p_ride_id;

  delete from private.m2_ride_verification where ride_id = p_ride_id;
  return p_ride_id;
end;
$$;

create or replace function public.persist_quoted_ride(
  p_host_id uuid,
  p_mode text,
  p_ride_id uuid,
  p_vehicle_id uuid,
  p_pickup text,
  p_destination text,
  p_departure_at timestamptz,
  p_journey_scale text,
  p_seats_total integer,
  p_pickup_place_id text,
  p_pickup_latitude double precision,
  p_pickup_longitude double precision,
  p_destination_place_id text,
  p_pickup_instructions text,
  p_contribution text,
  p_restriction_tags text[],
  p_waypoints jsonb,
  p_route_quote_id uuid,
  p_route_quoted_at timestamptz,
  p_route_quote_expires_at timestamptz,
  p_route_distance_meters integer,
  p_route_duration_seconds integer,
  p_route_stopover_seconds integer,
  p_estimated_arrival_at timestamptz,
  p_pickup_anchor_latitude double precision,
  p_pickup_anchor_longitude double precision,
  p_destination_anchor_latitude double precision,
  p_destination_anchor_longitude double precision
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ride public.rides%rowtype;
  v_ride_id uuid;
  v_vehicle_seats integer;
  v_expected_arrival timestamptz;
  v_buffer_until timestamptz;
begin
  if p_mode not in ('create', 'update', 'publish_draft') then
    raise exception 'Unsupported quoted Ride operation';
  end if;
  if p_host_id is null then
    raise exception 'Driver identity is required';
  end if;
  if nullif(btrim(p_pickup), '') is null
     or nullif(btrim(p_destination), '') is null
     or p_departure_at is null
     or p_journey_scale not in ('Urban', 'Intercity')
     or p_seats_total is null
     or p_seats_total < 1 then
    raise exception 'Complete ride details are required';
  end if;
  if p_departure_at < now() + interval '1 hour' then
    raise exception 'Published rides must depart at least 1 hour from now';
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
     or (p_pickup_longitude is not null and p_pickup_longitude not between -180 and 180)
     or p_pickup_anchor_latitude is null or p_pickup_anchor_latitude not between -90 and 90
     or p_pickup_anchor_longitude is null or p_pickup_anchor_longitude not between -180 and 180
     or p_destination_anchor_latitude is null or p_destination_anchor_latitude not between -90 and 90
     or p_destination_anchor_longitude is null or p_destination_anchor_longitude not between -180 and 180 then
    raise exception 'Route coordinates are invalid';
  end if;
  if char_length(coalesce(p_pickup_instructions, '')) > 300 then
    raise exception 'Pickup instructions must be 300 characters or fewer';
  end if;

  perform private.m2_validate_waypoints(p_waypoints, true);

  if p_route_quote_id is null
     or p_route_quoted_at is null
     or p_route_quote_expires_at is null
     or p_route_quote_expires_at <= now()
     or p_route_quote_expires_at > p_route_quoted_at + interval '5 minutes'
     or p_route_quoted_at > now() + interval '1 minute' then
    raise exception 'The route quote has expired. Calculate the route again';
  end if;
  if p_route_distance_meters is null or p_route_distance_meters < 0
     or p_route_duration_seconds is null or p_route_duration_seconds <= 0
     or p_route_duration_seconds > 604800
     or p_route_stopover_seconds is null or p_route_stopover_seconds < 0
     or p_route_stopover_seconds > 108000 then
    raise exception 'The route quote is invalid';
  end if;

  select coalesce(sum(((value ->> 'stopMinutes')::integer) * 60), 0)
  into v_vehicle_seats
  from jsonb_array_elements(p_waypoints);
  if v_vehicle_seats <> p_route_stopover_seconds then
    raise exception 'Waypoint stop time does not match the route quote';
  end if;

  v_expected_arrival := p_departure_at
    + pg_catalog.make_interval(secs => p_route_duration_seconds + p_route_stopover_seconds);
  if p_estimated_arrival_at is null
     or abs(extract(epoch from (p_estimated_arrival_at - v_expected_arrival))) > 1 then
    raise exception 'Estimated arrival does not match the quoted route';
  end if;
  v_buffer_until := p_estimated_arrival_at + interval '30 minutes';

  select v.seats into v_vehicle_seats
  from public.vehicles v
  where v.id = p_vehicle_id and v.owner_id = p_host_id;
  if v_vehicle_seats is null then
    raise exception 'Select a vehicle you own';
  end if;
  if p_seats_total > v_vehicle_seats then
    raise exception 'Available seats exceed vehicle capacity';
  end if;

  if p_mode = 'create' then
    if p_ride_id is not null then
      raise exception 'A new Ride cannot include an existing Ride id';
    end if;
  else
    select * into v_ride from public.rides where id = p_ride_id for update;
    if not found or v_ride.host_id <> p_host_id then
      raise exception 'Ride not found or permission denied';
    end if;
    if p_mode = 'update' and v_ride.status <> 'Published' then
      raise exception 'Only a Published Ride can use the quoted update operation';
    end if;
    if p_mode = 'publish_draft' and v_ride.status <> 'Draft' then
      raise exception 'Only a Draft Ride can be published';
    end if;
    if exists (
      select 1 from public.ride_requests
      where ride_id = p_ride_id and status = 'Accepted'
    ) then
      raise exception 'A ride with accepted requests cannot be edited or newly published';
    end if;
  end if;

  perform private.m2_assert_schedule_available(
    p_host_id,
    p_departure_at,
    v_buffer_until,
    case when p_mode = 'create' then null else p_ride_id end,
    not (p_mode = 'update' and v_ride.schedule_buffer_until is null)
  );

  if p_mode = 'create' then
    insert into public.rides (
      host_id, vehicle_id, pickup, destination, pickup_place_id,
      pickup_latitude, pickup_longitude, destination_place_id,
      pickup_instructions, departure_at, journey_scale, seats_total,
      seats_available, contribution, restriction_tags, status, waypoints,
      published_at, route_distance_meters, route_duration_seconds,
      route_stopover_seconds, estimated_arrival_at, schedule_buffer_until,
      route_quoted_at, route_quote_expires_at, route_quote_id
    ) values (
      p_host_id, p_vehicle_id, btrim(p_pickup), btrim(p_destination),
      nullif(btrim(p_pickup_place_id), ''), p_pickup_latitude,
      p_pickup_longitude, nullif(btrim(p_destination_place_id), ''),
      btrim(coalesce(p_pickup_instructions, '')), p_departure_at,
      p_journey_scale, p_seats_total, p_seats_total,
      coalesce(p_contribution, ''), coalesce(p_restriction_tags, '{}'),
      'Published', p_waypoints, now(), p_route_distance_meters,
      p_route_duration_seconds, p_route_stopover_seconds,
      p_estimated_arrival_at, v_buffer_until, p_route_quoted_at,
      p_route_quote_expires_at, p_route_quote_id
    ) returning id into v_ride_id;
  else
    v_ride_id := p_ride_id;
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
        waypoints = p_waypoints,
        status = 'Published',
        published_at = case when p_mode = 'publish_draft' then now() else published_at end,
        route_distance_meters = p_route_distance_meters,
        route_duration_seconds = p_route_duration_seconds,
        route_stopover_seconds = p_route_stopover_seconds,
        estimated_arrival_at = p_estimated_arrival_at,
        schedule_buffer_until = v_buffer_until,
        route_quoted_at = p_route_quoted_at,
        route_quote_expires_at = p_route_quote_expires_at,
        route_quote_id = p_route_quote_id
    where id = p_ride_id;
  end if;

  insert into private.m2_ride_verification (
    ride_id, pickup_anchor_latitude, pickup_anchor_longitude,
    destination_anchor_latitude, destination_anchor_longitude
  ) values (
    v_ride_id, p_pickup_anchor_latitude, p_pickup_anchor_longitude,
    p_destination_anchor_latitude, p_destination_anchor_longitude
  )
  on conflict (ride_id) do update set
    pickup_anchor_latitude = excluded.pickup_anchor_latitude,
    pickup_anchor_longitude = excluded.pickup_anchor_longitude,
    destination_anchor_latitude = excluded.destination_anchor_latitude,
    destination_anchor_longitude = excluded.destination_anchor_longitude,
    driver_arrived_at = null,
    driver_arrival_distance_meters = null,
    passenger_confirmation_due_at = null,
    completed_at = null;

  return v_ride_id;
end;
$$;

create or replace function public.backfill_quoted_ride(
  p_ride_id uuid,
  p_route_quote_id uuid,
  p_route_quoted_at timestamptz,
  p_route_distance_meters integer,
  p_route_duration_seconds integer,
  p_route_stopover_seconds integer,
  p_estimated_arrival_at timestamptz,
  p_pickup_anchor_latitude double precision,
  p_pickup_anchor_longitude double precision,
  p_destination_anchor_latitude double precision,
  p_destination_anchor_longitude double precision
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ride public.rides%rowtype;
  v_buffer_until timestamptz;
  v_stopover_seconds integer;
begin
  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found or v_ride.status not in ('Published', 'Matched') or v_ride.departure_at <= now() then
    raise exception 'Only an upcoming active Ride can be backfilled';
  end if;
  if v_ride.estimated_arrival_at is not null then
    return p_ride_id;
  end if;
  perform private.m2_validate_waypoints(v_ride.waypoints, true);
  if p_route_quote_id is null or p_route_quoted_at is null
     or p_route_distance_meters is null or p_route_distance_meters < 0
     or p_route_duration_seconds is null or p_route_duration_seconds <= 0
     or p_route_duration_seconds > 604800
     or p_route_stopover_seconds is null or p_route_stopover_seconds < 0
     or p_route_stopover_seconds > 108000
     or p_estimated_arrival_at is null then
    raise exception 'The route backfill is invalid';
  end if;
  if p_pickup_anchor_latitude is null or p_pickup_anchor_latitude not between -90 and 90
     or p_pickup_anchor_longitude is null or p_pickup_anchor_longitude not between -180 and 180
     or p_destination_anchor_latitude is null or p_destination_anchor_latitude not between -90 and 90
     or p_destination_anchor_longitude is null or p_destination_anchor_longitude not between -180 and 180 then
    raise exception 'The route backfill coordinates are invalid';
  end if;
  select coalesce(sum(((value ->> 'stopMinutes')::integer) * 60), 0)
  into v_stopover_seconds
  from jsonb_array_elements(v_ride.waypoints);
  if v_stopover_seconds <> p_route_stopover_seconds then
    raise exception 'Waypoint stop time does not match the route backfill';
  end if;
  if abs(extract(epoch from (
    p_estimated_arrival_at
    - (v_ride.departure_at + pg_catalog.make_interval(secs => p_route_duration_seconds + p_route_stopover_seconds))
  ))) > 1 then
    raise exception 'Estimated arrival does not match the backfilled route';
  end if;

  v_buffer_until := p_estimated_arrival_at + interval '30 minutes';
  perform private.m2_assert_schedule_available(
    v_ride.host_id, v_ride.departure_at, v_buffer_until, p_ride_id, false
  );

  update public.rides
  set route_distance_meters = p_route_distance_meters,
      route_duration_seconds = p_route_duration_seconds,
      route_stopover_seconds = p_route_stopover_seconds,
      estimated_arrival_at = p_estimated_arrival_at,
      schedule_buffer_until = v_buffer_until,
      route_quoted_at = p_route_quoted_at,
      route_quote_expires_at = p_route_quoted_at + interval '5 minutes',
      route_quote_id = p_route_quote_id
  where id = p_ride_id;

  insert into private.m2_ride_verification (
    ride_id, pickup_anchor_latitude, pickup_anchor_longitude,
    destination_anchor_latitude, destination_anchor_longitude
  ) values (
    p_ride_id, p_pickup_anchor_latitude, p_pickup_anchor_longitude,
    p_destination_anchor_latitude, p_destination_anchor_longitude
  )
  on conflict (ride_id) do update set
    pickup_anchor_latitude = excluded.pickup_anchor_latitude,
    pickup_anchor_longitude = excluded.pickup_anchor_longitude,
    destination_anchor_latitude = excluded.destination_anchor_latitude,
    destination_anchor_longitude = excluded.destination_anchor_longitude;

  return p_ride_id;
end;
$$;

revoke all on function public.persist_quoted_ride(uuid, text, uuid, uuid, text, text, timestamptz, text, integer, text, double precision, double precision, text, text, text, text[], jsonb, uuid, timestamptz, timestamptz, integer, integer, integer, timestamptz, double precision, double precision, double precision, double precision)
  from public, anon, authenticated;
grant execute on function public.persist_quoted_ride(uuid, text, uuid, uuid, text, text, timestamptz, text, integer, text, double precision, double precision, text, text, text, text[], jsonb, uuid, timestamptz, timestamptz, integer, integer, integer, timestamptz, double precision, double precision, double precision, double precision)
  to service_role;

revoke all on function public.backfill_quoted_ride(uuid, uuid, timestamptz, integer, integer, integer, timestamptz, double precision, double precision, double precision, double precision)
  from public, anon, authenticated;
grant execute on function public.backfill_quoted_ride(uuid, uuid, timestamptz, integer, integer, integer, timestamptz, double precision, double precision, double precision, double precision)
  to service_role;

create or replace function public.reopen_ride_recruitment(p_ride_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_ride public.rides%rowtype;
begin
  select * into v_ride from public.rides where id = p_ride_id for update;
  if v_user_id is null or not found or v_ride.host_id <> v_user_id then
    raise exception 'Ride not found or permission denied';
  end if;
  if v_ride.status <> 'Matched' then
    raise exception 'Only Matched rides can reopen recruitment';
  end if;
  if now() > v_ride.departure_at - interval '1 hour' then
    raise exception 'Recruitment can only reopen at least 1 hour before departure';
  end if;

  update public.rides set status = 'Published', recruitment_closed_at = null
  where id = p_ride_id;
  return p_ride_id;
end;
$$;

create or replace function public.submit_ride_request(
  p_ride_id uuid,
  p_seats_requested integer,
  p_companion_names text[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_ride public.rides%rowtype;
  v_request_id uuid;
  v_clean_names text[];
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  if p_seats_requested is null or p_seats_requested < 1 or p_seats_requested > 8 then
    raise exception 'Seats requested must be between 1 and 8';
  end if;

  select coalesce(array_agg(btrim(name) order by ordinal), '{}')
  into v_clean_names
  from unnest(coalesce(p_companion_names, '{}')) with ordinality as names(name, ordinal);

  if cardinality(v_clean_names) <> p_seats_requested - 1
     or exists (select 1 from unnest(v_clean_names) as n(name) where nullif(name, '') is null) then
    raise exception 'Provide one companion name for each additional seat';
  end if;

  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found then raise exception 'Ride not found'; end if;
  if v_ride.host_id = v_user_id then raise exception 'Hosts cannot request their own ride'; end if;
  if v_ride.status <> 'Published' then raise exception 'This ride is not accepting requests'; end if;
  if now() > v_ride.departure_at - interval '1 hour' then
    raise exception 'Requests close 1 hour before departure';
  end if;
  if p_seats_requested > v_ride.seats_available then
    raise exception 'Not enough seats are currently available';
  end if;
  if exists (
    select 1 from public.ride_requests
    where ride_id = p_ride_id and requester_id = v_user_id and status = 'Rejected'
  ) then
    raise exception 'A rejected request cannot be submitted again';
  end if;
  if exists (
    select 1 from public.ride_requests
    where ride_id = p_ride_id and requester_id = v_user_id and status in ('Pending', 'Accepted')
  ) then
    raise exception 'You already have an active request for this ride';
  end if;

  insert into public.ride_requests (ride_id, requester_id, seats_requested, companion_names)
  values (p_ride_id, v_user_id, p_seats_requested, v_clean_names)
  returning id into v_request_id;
  return v_request_id;
end;
$$;

create or replace function public.check_in_ride_request(
  p_request_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters double precision
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_request public.ride_requests%rowtype;
  v_ride public.rides%rowtype;
  v_verification private.m2_ride_verification%rowtype;
  v_distance integer;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_accuracy_meters is null or p_accuracy_meters < 0 or p_accuracy_meters > 100 then
    raise exception 'GPS accuracy must be 100 metres or better';
  end if;
  if p_latitude is null or p_longitude is null
     or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    raise exception 'Location coordinates are invalid';
  end if;

  select * into v_request from public.ride_requests where id = p_request_id for update;
  if not found or v_request.requester_id <> v_user_id then
    raise exception 'Ride request not found or permission denied';
  end if;
  select * into v_ride from public.rides where id = v_request.ride_id for update;
  select * into v_verification from private.m2_ride_verification where ride_id = v_ride.id;

  if v_request.status <> 'Accepted' then raise exception 'Only accepted passengers can check in'; end if;
  if v_request.boarding_status <> 'Pending' then raise exception 'This passenger is already resolved'; end if;
  if v_ride.status not in ('Published', 'Matched') then raise exception 'This Ride is not accepting check-ins'; end if;
  if now() < v_ride.departure_at - interval '1 hour' then raise exception 'Check-in opens 1 hour before departure'; end if;
  if v_verification.ride_id is null then raise exception 'This Ride needs a confirmed route before check-in'; end if;

  v_distance := round(private.m2_distance_metres(
    p_latitude, p_longitude,
    v_verification.pickup_anchor_latitude,
    v_verification.pickup_anchor_longitude
  ));
  if v_distance > 200 then raise exception 'You must be within 200 metres of the pickup point'; end if;

  update public.ride_requests
  set boarding_status = 'Checked In',
      checked_in_at = now(),
      check_in_distance_meters = v_distance
  where id = p_request_id;
  return v_distance;
end;
$$;

create or replace function public.mark_ride_request_no_show(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_request public.ride_requests%rowtype;
  v_ride public.rides%rowtype;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select * into v_request from public.ride_requests where id = p_request_id for update;
  if not found then raise exception 'Ride request not found'; end if;
  select * into v_ride from public.rides where id = v_request.ride_id for update;
  if v_ride.host_id <> v_user_id then raise exception 'Only the Driver can mark a no-show'; end if;
  if v_request.status <> 'Accepted' or v_request.boarding_status <> 'Pending' then
    raise exception 'Only an unresolved accepted passenger can be marked No-show';
  end if;
  if v_ride.status not in ('Published', 'Matched') or now() < v_ride.departure_at then
    raise exception 'No-show can only be marked at or after departure';
  end if;

  update public.ride_requests
  set boarding_status = 'No-show', no_show_at = now(), no_show_marked_by = v_user_id
  where id = p_request_id;
  return p_request_id;
end;
$$;

create or replace function public.start_ride(p_ride_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_ride public.rides%rowtype;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found or v_ride.host_id <> v_user_id then raise exception 'Ride not found or permission denied'; end if;
  if v_ride.status not in ('Published', 'Matched') then raise exception 'Only a ready Ride can start'; end if;
  if now() < v_ride.departure_at then raise exception 'A Ride cannot start before departure'; end if;
  if not exists (
    select 1 from public.ride_requests
    where ride_id = p_ride_id and status = 'Accepted'
  ) then
    raise exception 'At least one accepted passenger is required before departure';
  end if;
  if exists (
    select 1 from public.ride_requests
    where ride_id = p_ride_id and status = 'Accepted' and boarding_status = 'Pending'
  ) then
    raise exception 'Check in or mark No-show for every accepted passenger before starting';
  end if;

  update public.ride_requests
  set status = 'Expired',
      decision_reason = 'Ride started',
      cancelled_by = 'System',
      processed_at = now()
  where ride_id = p_ride_id and status = 'Pending';

  update public.rides
  set status = 'In Transit', recruitment_closed_at = coalesce(recruitment_closed_at, now())
  where id = p_ride_id;
  return p_ride_id;
end;
$$;

create or replace function public.confirm_driver_arrival(
  p_ride_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters double precision
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_ride public.rides%rowtype;
  v_verification private.m2_ride_verification%rowtype;
  v_distance integer;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_accuracy_meters is null or p_accuracy_meters < 0 or p_accuracy_meters > 100 then
    raise exception 'GPS accuracy must be 100 metres or better';
  end if;
  if p_latitude is null or p_longitude is null
     or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    raise exception 'Location coordinates are invalid';
  end if;

  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found or v_ride.host_id <> v_user_id then raise exception 'Ride not found or permission denied'; end if;
  if v_ride.status <> 'In Transit' then raise exception 'Only an In Transit Ride can arrive'; end if;
  select * into v_verification from private.m2_ride_verification where ride_id = p_ride_id for update;
  if not found then raise exception 'This Ride has no verified destination'; end if;
  if v_verification.driver_arrived_at is not null then return v_verification.driver_arrival_distance_meters; end if;

  v_distance := round(private.m2_distance_metres(
    p_latitude, p_longitude,
    v_verification.destination_anchor_latitude,
    v_verification.destination_anchor_longitude
  ));
  if v_distance > 200 then raise exception 'You must be within 200 metres of the destination'; end if;

  update private.m2_ride_verification
  set driver_arrived_at = now(),
      driver_arrival_distance_meters = v_distance,
      passenger_confirmation_due_at = now() + interval '24 hours'
  where ride_id = p_ride_id;

  if not exists (
    select 1 from public.ride_requests
    where ride_id = p_ride_id
      and status = 'Accepted'
      and boarding_status = 'Checked In'
  ) then
    update public.rides set status = 'Completed' where id = p_ride_id;
    update private.m2_ride_verification set completed_at = now() where ride_id = p_ride_id;
  end if;
  return v_distance;
end;
$$;

create or replace function public.confirm_passenger_arrival(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_request public.ride_requests%rowtype;
  v_ride public.rides%rowtype;
  v_driver_arrived_at timestamptz;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select * into v_request from public.ride_requests where id = p_request_id for update;
  if not found or v_request.requester_id <> v_user_id then
    raise exception 'Ride request not found or permission denied';
  end if;
  select * into v_ride from public.rides where id = v_request.ride_id for update;
  select driver_arrived_at into v_driver_arrived_at
  from private.m2_ride_verification where ride_id = v_ride.id for update;

  if v_ride.status <> 'In Transit' then raise exception 'This Ride is not awaiting arrival confirmation'; end if;
  if v_request.status <> 'Accepted' or v_request.boarding_status <> 'Checked In' then
    raise exception 'Only a checked-in passenger can confirm arrival';
  end if;
  if v_driver_arrived_at is null then raise exception 'The Driver has not confirmed destination arrival'; end if;

  update public.ride_requests
  set arrival_confirmed_at = coalesce(arrival_confirmed_at, now())
  where id = p_request_id;

  if not exists (
    select 1 from public.ride_requests
    where ride_id = v_ride.id
      and status = 'Accepted'
      and boarding_status = 'Checked In'
      and arrival_confirmed_at is null
  ) then
    update public.rides set status = 'Completed' where id = v_ride.id;
    update private.m2_ride_verification set completed_at = now() where ride_id = v_ride.id;
  end if;
  return p_request_id;
end;
$$;

create or replace function public.get_ride_lifecycle_context(p_ride_id uuid)
returns table (
  driver_arrived_at timestamptz,
  passenger_confirmation_due_at timestamptz,
  completed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.rides r
    where r.id = p_ride_id
      and (
        r.host_id = v_user_id
        or exists (
          select 1 from public.ride_requests rr
          where rr.ride_id = r.id and rr.requester_id = v_user_id and rr.status = 'Accepted'
        )
      )
  ) then
    raise exception 'Ride lifecycle details are private to participants';
  end if;

  return query
  select v.driver_arrived_at, v.passenger_confirmation_due_at, v.completed_at
  from private.m2_ride_verification v
  where v.ride_id = p_ride_id;
end;
$$;

create or replace function public.get_participant_ride_detail(p_ride_id uuid)
returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  select to_jsonb(r)
    - 'route_quote_id'
    - 'route_quoted_at'
    - 'route_quote_expires_at'
  from public.rides r
  where r.id = p_ride_id
    and auth.uid() is not null
    and (
      r.host_id = auth.uid()
      or exists (
        select 1 from public.ride_requests rr
        where rr.ride_id = r.id
          and rr.requester_id = auth.uid()
          and rr.status = 'Accepted'
      )
    );
$$;

create or replace function private.process_ride_lifecycle()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_departure_processed integer := 0;
  v_completion_processed integer := 0;
begin
  perform 1
  from public.rides
  where status = 'Published' and departure_at <= now()
  order by id
  for update;

  update public.ride_requests rr
  set status = 'Expired',
      decision_reason = 'Departure time reached',
      cancelled_by = 'System',
      processed_at = now()
  from public.rides r
  where rr.ride_id = r.id and rr.status = 'Pending' and r.departure_at <= now();

  update public.rides r
  set status = case
        when exists (
          select 1 from public.ride_requests rr
          where rr.ride_id = r.id and rr.status = 'Accepted'
        ) then 'Matched'
        else 'Expired'
      end,
      recruitment_closed_at = case
        when exists (
          select 1 from public.ride_requests rr
          where rr.ride_id = r.id and rr.status = 'Accepted'
        ) then coalesce(r.recruitment_closed_at, now())
        else r.recruitment_closed_at
      end,
      expired_at = case
        when not exists (
          select 1 from public.ride_requests rr
          where rr.ride_id = r.id and rr.status = 'Accepted'
        ) then now()
        else r.expired_at
      end
  where r.status = 'Published' and r.departure_at <= now();
  get diagnostics v_departure_processed = row_count;

  perform 1
  from public.rides r
  join private.m2_ride_verification v on v.ride_id = r.id
  where r.status = 'In Transit'
    and v.passenger_confirmation_due_at <= now()
  order by r.id
  for update of r, v;

  update public.rides r
  set status = 'Completed'
  from private.m2_ride_verification v
  where v.ride_id = r.id
    and r.status = 'In Transit'
    and v.passenger_confirmation_due_at <= now();
  get diagnostics v_completion_processed = row_count;

  update private.m2_ride_verification v
  set completed_at = coalesce(v.completed_at, now())
  from public.rides r
  where r.id = v.ride_id
    and r.status = 'Completed'
    and v.passenger_confirmation_due_at <= now();

  return v_departure_processed + v_completion_processed;
end;
$$;

create or replace function public.transition_verified_ride(
  p_ride_id uuid,
  p_next_status text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ride public.rides%rowtype;
  v_verification private.m2_ride_verification%rowtype;
begin
  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found then raise exception 'Ride not found'; end if;

  if p_next_status = 'In Transit' then
    if v_ride.status <> 'Matched' then raise exception 'Only Matched rides can enter In Transit'; end if;
    if v_ride.departure_at > now() then raise exception 'A Ride cannot start before departure'; end if;
    if not exists (
      select 1 from public.ride_requests
      where ride_id = p_ride_id and status = 'Accepted'
    ) or exists (
      select 1 from public.ride_requests
      where ride_id = p_ride_id and status = 'Accepted' and boarding_status = 'Pending'
    ) then
      raise exception 'Accepted passengers must be Checked In or No-show before transit';
    end if;
    update public.rides set status = 'In Transit' where id = p_ride_id;
  elsif p_next_status = 'Completed' then
    if v_ride.status <> 'In Transit' then raise exception 'Only In Transit rides can be completed'; end if;
    select * into v_verification from private.m2_ride_verification where ride_id = p_ride_id for update;
    if v_verification.driver_arrived_at is null then raise exception 'Driver arrival is not verified'; end if;
    if v_verification.passenger_confirmation_due_at > now() and exists (
      select 1 from public.ride_requests
      where ride_id = p_ride_id and status = 'Accepted'
        and boarding_status = 'Checked In' and arrival_confirmed_at is null
    ) then
      raise exception 'Checked-in passengers have not all confirmed arrival';
    end if;
    update public.rides set status = 'Completed' where id = p_ride_id;
    update private.m2_ride_verification set completed_at = now() where ride_id = p_ride_id;
  else
    raise exception 'Unsupported verified Ride transition';
  end if;
  return p_ride_id;
end;
$$;

revoke all on function public.create_ride(uuid, text, text, timestamptz, text, integer, text, double precision, double precision, text, text, text, text[], jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.create_ride(uuid, text, text, timestamptz, text, integer, text, double precision, double precision, text, text, text, text[], jsonb, boolean)
  to authenticated;

revoke all on function public.update_ride(uuid, uuid, text, text, timestamptz, text, integer, text, double precision, double precision, text, text, text, text[], jsonb)
  from public, anon, authenticated;
grant execute on function public.update_ride(uuid, uuid, text, text, timestamptz, text, integer, text, double precision, double precision, text, text, text, text[], jsonb)
  to authenticated;

revoke all on function public.publish_ride(uuid) from public, anon, authenticated;
revoke all on function public.reopen_ride_recruitment(uuid) from public, anon, authenticated;
revoke all on function public.submit_ride_request(uuid, integer, text[]) from public, anon, authenticated;
revoke all on function public.check_in_ride_request(uuid, double precision, double precision, double precision) from public, anon, authenticated;
revoke all on function public.mark_ride_request_no_show(uuid) from public, anon, authenticated;
revoke all on function public.start_ride(uuid) from public, anon, authenticated;
revoke all on function public.confirm_driver_arrival(uuid, double precision, double precision, double precision) from public, anon, authenticated;
revoke all on function public.confirm_passenger_arrival(uuid) from public, anon, authenticated;
revoke all on function public.get_ride_lifecycle_context(uuid) from public, anon, authenticated;
revoke all on function public.get_participant_ride_detail(uuid) from public, anon, authenticated;

grant execute on function public.reopen_ride_recruitment(uuid) to authenticated;
grant execute on function public.submit_ride_request(uuid, integer, text[]) to authenticated;
grant execute on function public.check_in_ride_request(uuid, double precision, double precision, double precision) to authenticated;
grant execute on function public.mark_ride_request_no_show(uuid) to authenticated;
grant execute on function public.start_ride(uuid) to authenticated;
grant execute on function public.confirm_driver_arrival(uuid, double precision, double precision, double precision) to authenticated;
grant execute on function public.confirm_passenger_arrival(uuid) to authenticated;
grant execute on function public.get_ride_lifecycle_context(uuid) to authenticated;
grant execute on function public.get_participant_ride_detail(uuid) to authenticated;

revoke all on function private.process_ride_lifecycle() from public, anon, authenticated;
revoke all on function public.transition_verified_ride(uuid, text) from public, anon, authenticated;
grant execute on function public.transition_verified_ride(uuid, text) to service_role;

-- The anonymous ride grant from 023 remains column-scoped. ETA is the only new
-- lifecycle/schedule field exposed to guest browsing. Upgraded waypoint JSON
-- contains Place IDs, so the old public waypoint column grant is removed.
revoke select (waypoints) on public.rides from anon;
grant select (estimated_arrival_at) on public.rides to anon;

-- Signed-in public browsing receives the same safe Ride columns. Hosts and
-- accepted passengers obtain their private detail through the narrow RPC above.
revoke select on table public.rides from authenticated;
grant select (
  id, host_id, pickup, destination, departure_at, journey_scale,
  seats_total, seats_available, contribution, restriction_tags,
  status, estimated_arrival_at
) on table public.rides to authenticated;
