-- Module 2 early departure after every accepted passenger checks in and
-- traffic-aware ETA refresh.
-- The authenticated client no longer calls start_ride() directly. The existing
-- m2-route-quote Edge Function authenticates the Driver, spends one guarded
-- Routes request, then calls these service-role-only RPCs.

alter table public.rides
  add column started_at timestamptz,
  drop constraint rides_route_schedule_pair_check,
  add constraint rides_route_schedule_pair_check check (
    (estimated_arrival_at is null and schedule_buffer_until is null)
    or (
      estimated_arrival_at is not null
      and schedule_buffer_until = estimated_arrival_at + interval '30 minutes'
      and estimated_arrival_at > coalesce(started_at, departure_at)
    )
  ),
  add constraint rides_started_state_check check (
    started_at is null or status in ('In Transit', 'Completed')
  );

create or replace function public.preflight_m2_ride_start(
  p_host_id uuid,
  p_ride_id uuid
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  v_ride public.rides%rowtype;
begin
  if p_host_id is null or p_ride_id is null then
    raise exception 'Ride not found or permission denied';
  end if;

  select * into v_ride
  from public.rides
  where id = p_ride_id and host_id = p_host_id;

  if not found then raise exception 'Ride not found or permission denied'; end if;
  if v_ride.status not in ('Published', 'Matched') then
    raise exception 'Only a ready Ride can start';
  end if;
  if exists (
    select 1 from public.rides
    where host_id = p_host_id and id <> p_ride_id and status = 'In Transit'
  ) then
    raise exception 'Complete your current In Transit ride before starting another ride';
  end if;
  if not exists (
    select 1 from public.ride_requests
    where ride_id = p_ride_id and status = 'Accepted'
  ) then
    raise exception 'At least one accepted passenger is required before starting';
  end if;
  if v_ride.departure_at > now() then
    if exists (
      select 1 from public.ride_requests
      where ride_id = p_ride_id
        and status = 'Accepted'
        and boarding_status <> 'Checked In'
    ) then
      raise exception 'All accepted passengers must Check in before starting early';
    end if;
  elsif not exists (
    select 1 from public.ride_requests
    where ride_id = p_ride_id
      and status = 'Accepted'
      and boarding_status = 'Checked In'
  ) then
    raise exception 'At least one checked-in passenger is required before starting';
  end if;

  return to_jsonb(v_ride)
    - 'route_quote_id'
    - 'route_quoted_at'
    - 'route_quote_expires_at';
end;
$$;

create or replace function public.start_quoted_ride(
  p_host_id uuid,
  p_ride_id uuid,
  p_started_at timestamptz,
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
-- The service role needs private-schema access to refresh verification anchors.
-- Execution is revoked from every client role below, and the function repeats
-- Host ownership and lifecycle checks under row locks before writing.
security definer
set search_path = ''
as $$
declare
  v_ride public.rides%rowtype;
  v_expected_arrival timestamptz;
  v_stopover_seconds integer;
begin
  if p_host_id is null or p_ride_id is null then
    raise exception 'Ride not found or permission denied';
  end if;
  if p_started_at is null
     or p_started_at < now() - interval '2 minutes'
     or p_started_at > now() + interval '1 minute' then
    raise exception 'The trip start time is stale';
  end if;
  if p_route_quote_id is null
     or p_route_quoted_at is null
     or p_route_quoted_at < p_started_at - interval '2 minutes'
     or p_route_quoted_at > now() + interval '1 minute'
     or p_route_distance_meters is null or p_route_distance_meters < 0
     or p_route_duration_seconds is null or p_route_duration_seconds <= 0
     or p_route_duration_seconds > 604800
     or p_route_stopover_seconds is null or p_route_stopover_seconds < 0
     or p_route_stopover_seconds > 108000 then
    raise exception 'The refreshed route is invalid';
  end if;
  if p_pickup_anchor_latitude is null or p_pickup_anchor_latitude not between -90 and 90
     or p_pickup_anchor_longitude is null or p_pickup_anchor_longitude not between -180 and 180
     or p_destination_anchor_latitude is null or p_destination_anchor_latitude not between -90 and 90
     or p_destination_anchor_longitude is null or p_destination_anchor_longitude not between -180 and 180 then
    raise exception 'The refreshed route coordinates are invalid';
  end if;

  select * into v_ride
  from public.rides
  where id = p_ride_id
  for update;

  if not found or v_ride.host_id <> p_host_id then
    raise exception 'Ride not found or permission denied';
  end if;
  if v_ride.status not in ('Published', 'Matched') then
    raise exception 'Only a ready Ride can start';
  end if;
  if exists (
    select 1 from public.rides
    where host_id = p_host_id and id <> p_ride_id and status = 'In Transit'
  ) then
    raise exception 'Complete your current In Transit ride before starting another ride';
  end if;
  if not exists (
    select 1 from public.ride_requests
    where ride_id = p_ride_id and status = 'Accepted'
  ) then
    raise exception 'At least one accepted passenger is required before starting';
  end if;
  if p_started_at < v_ride.departure_at then
    if exists (
      select 1 from public.ride_requests
      where ride_id = p_ride_id
        and status = 'Accepted'
        and boarding_status <> 'Checked In'
    ) then
      raise exception 'All accepted passengers must Check in before starting early';
    end if;
  elsif not exists (
    select 1 from public.ride_requests
    where ride_id = p_ride_id
      and status = 'Accepted'
      and boarding_status = 'Checked In'
  ) then
    raise exception 'At least one checked-in passenger is required before starting';
  end if;

  perform private.m2_validate_waypoints(v_ride.waypoints, true);
  select coalesce(sum(((value ->> 'stopMinutes')::integer) * 60), 0)
  into v_stopover_seconds
  from jsonb_array_elements(v_ride.waypoints);
  if v_stopover_seconds <> p_route_stopover_seconds then
    raise exception 'Waypoint stop time does not match the refreshed route';
  end if;

  v_expected_arrival := p_started_at
    + pg_catalog.make_interval(secs => p_route_duration_seconds + p_route_stopover_seconds);
  if p_estimated_arrival_at is null
     or abs(extract(epoch from (p_estimated_arrival_at - v_expected_arrival))) > 1 then
    raise exception 'Estimated arrival does not match the refreshed route';
  end if;

  update public.ride_requests
  set status = 'Expired',
      decision_reason = 'Ride started',
      cancelled_by = 'System',
      processed_at = p_started_at
  where ride_id = p_ride_id and status = 'Pending';

  if p_started_at >= v_ride.departure_at then
    update public.ride_requests
    set boarding_status = 'No-show',
        no_show_at = p_started_at,
        no_show_marked_by = p_host_id
    where ride_id = p_ride_id
      and status = 'Accepted'
      and boarding_status = 'Pending';
  end if;

  update public.rides
  set status = 'In Transit',
      started_at = p_started_at,
      recruitment_closed_at = coalesce(recruitment_closed_at, p_started_at),
      route_distance_meters = p_route_distance_meters,
      route_duration_seconds = p_route_duration_seconds,
      route_stopover_seconds = p_route_stopover_seconds,
      estimated_arrival_at = p_estimated_arrival_at,
      schedule_buffer_until = p_estimated_arrival_at + interval '30 minutes',
      route_quoted_at = p_route_quoted_at,
      route_quote_expires_at = p_route_quoted_at + interval '5 minutes',
      route_quote_id = p_route_quote_id,
      updated_at = p_started_at
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

-- Starting without a refreshed, server-trusted traffic route is no longer a
-- client capability. Both new helpers are callable only by the Edge Function.
revoke all on function public.start_ride(uuid) from public, anon, authenticated;
revoke all on function public.preflight_m2_ride_start(uuid, uuid) from public, anon, authenticated;
revoke all on function public.start_quoted_ride(
  uuid, uuid, timestamptz, uuid, timestamptz,
  integer, integer, integer, timestamptz,
  double precision, double precision, double precision, double precision
) from public, anon, authenticated;

grant execute on function public.preflight_m2_ride_start(uuid, uuid) to service_role;
grant execute on function public.start_quoted_ride(
  uuid, uuid, timestamptz, uuid, timestamptz,
  integer, integer, integer, timestamptz,
  double precision, double precision, double precision, double precision
) to service_role;
