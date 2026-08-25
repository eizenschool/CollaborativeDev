-- Module 2 authoritative departure grace, terminal request history, and
-- lifecycle validation alignment.
--
-- Deployed migrations 013/016/028/037/038/041/042/050 remain immutable. This
-- compensating migration keeps every public RPC signature stable so the
-- current frontend and m2-route-quote Edge Function remain compatible.

alter table public.ride_requests
  add column if not exists accepted_at timestamptz;

-- Preserve the original acceptance instant before the lifecycle processor can
-- turn an unstarted accepted request into Expired.
update public.ride_requests
set accepted_at = coalesce(processed_at, updated_at, created_at)
where status = 'Accepted'
  and accepted_at is null;

create index if not exists ride_requests_accepted_participant_idx
  on public.ride_requests (ride_id, requester_id)
  where accepted_at is not null;

comment on column public.ride_requests.accepted_at is
  'Stable acceptance instant. Remains populated if an accepted request later becomes Cancelled or Expired.';

-- Active/live participation continues to use private.m2_participant_role(),
-- whose Passenger branch requires status = Accepted. This separate helper is
-- only for terminal detail and location-history access.
create or replace function private.m2_historical_participant_role(
  p_ride_id uuid,
  p_user_id uuid
)
returns text
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_status text;
begin
  if p_ride_id is null or p_user_id is null then return null; end if;

  select r.status into v_status
  from public.rides r
  where r.id = p_ride_id;

  if not found or v_status not in ('Completed', 'Cancelled', 'Expired') then
    return null;
  end if;

  if exists (
    select 1 from public.rides r
    where r.id = p_ride_id and r.host_id = p_user_id
  ) then
    return 'Driver';
  end if;

  if exists (
    select 1
    from public.ride_requests rr
    where rr.ride_id = p_ride_id
      and rr.requester_id = p_user_id
      and (
        rr.status = 'Accepted'
        or (
          v_status = 'Expired'
          and rr.status = 'Expired'
          and rr.accepted_at is not null
        )
      )
  ) then
    return 'Passenger';
  end if;

  return null;
end;
$$;

revoke all on function private.m2_historical_participant_role(uuid, uuid)
  from public, anon, authenticated, service_role;

-- This existing policy helper keeps active Accepted access and adds only the
-- narrow Expired + accepted_at terminal case. It exposes no request data.
create or replace function public.is_accepted_ride_requester(p_ride_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.ride_requests rr
    join public.rides r on r.id = rr.ride_id
    where rr.ride_id = p_ride_id
      and rr.requester_id = auth.uid()
      and (
        rr.status = 'Accepted'
        or (
          r.status = 'Expired'
          and rr.status = 'Expired'
          and rr.accepted_at is not null
        )
      )
  );
$$;

revoke all on function public.is_accepted_ride_requester(uuid)
  from public, anon, authenticated;
grant execute on function public.is_accepted_ride_requester(uuid)
  to authenticated;

-- Preserve Module 3's atomic group creation while recording an immutable
-- acceptance instant.
create or replace function public.respond_to_ride_request(
  p_request_id uuid,
  p_decision text,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_ride_id uuid;
  v_ride public.rides%rowtype;
  v_request public.ride_requests%rowtype;
  v_processed_at timestamptz := now();
begin
  if p_decision not in ('Accepted', 'Rejected') then
    raise exception 'Decision must be Accepted or Rejected';
  end if;
  if p_decision = 'Rejected' and nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'A rejection reason is required';
  end if;

  select ride_id into v_ride_id
  from public.ride_requests
  where id = p_request_id;
  if not found then raise exception 'Ride request not found'; end if;

  select * into v_ride
  from public.rides
  where id = v_ride_id
  for update;
  select * into v_request
  from public.ride_requests
  where id = p_request_id
  for update;

  if v_user_id is null or v_ride.host_id <> v_user_id then
    raise exception 'Only the ride Host can process requests';
  end if;
  if v_ride.status <> 'Published' or v_ride.departure_at <= now() then
    raise exception 'This ride can no longer process requests';
  end if;
  if v_request.status <> 'Pending' then
    raise exception 'This request has already been processed';
  end if;

  if p_decision = 'Accepted' then
    if v_request.seats_requested > v_ride.seats_available then
      raise exception 'Not enough seats remain for this request';
    end if;
    update public.rides
    set seats_available = seats_available - v_request.seats_requested
    where id = v_ride_id;
  end if;

  update public.ride_requests
  set status = p_decision,
      decision_reason = nullif(btrim(coalesce(p_reason, '')), ''),
      processed_at = v_processed_at,
      accepted_at = case
        when p_decision = 'Accepted' then coalesce(accepted_at, v_processed_at)
        else accepted_at
      end
  where id = p_request_id;

  if p_decision = 'Accepted' then
    perform private.ensure_ride_group(v_ride_id, v_request.requester_id, v_processed_at);
  end if;

  return p_request_id;
end;
$$;

revoke all on function public.respond_to_ride_request(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.respond_to_ride_request(uuid, text, text)
  to authenticated;

create or replace function public.close_ride_recruitment(p_ride_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_ride public.rides%rowtype;
begin
  select * into v_ride
  from public.rides
  where id = p_ride_id
  for update;

  if v_user_id is null or not found or v_ride.host_id <> v_user_id then
    raise exception 'Ride not found or permission denied';
  end if;
  if v_ride.status <> 'Published' or v_ride.departure_at <= now() then
    raise exception 'Only an upcoming Published ride can close recruitment';
  end if;
  if not exists (
    select 1 from public.ride_requests
    where ride_id = p_ride_id and status = 'Accepted'
  ) then
    raise exception 'Accept at least one passenger before closing recruitment';
  end if;

  update public.ride_requests
  set status = 'Expired',
      decision_reason = 'Recruitment closed',
      cancelled_by = 'System',
      processed_at = now()
  where ride_id = p_ride_id and status = 'Pending';

  update public.rides
  set status = 'Matched', recruitment_closed_at = now()
  where id = p_ride_id;

  return p_ride_id;
end;
$$;

revoke all on function public.close_ride_recruitment(uuid)
  from public, anon, authenticated;
grant execute on function public.close_ride_recruitment(uuid)
  to authenticated;

create or replace function public.cancel_ride_request(
  p_request_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_ride_id uuid;
  v_ride public.rides%rowtype;
  v_request public.ride_requests%rowtype;
begin
  if nullif(btrim(p_reason), '') is null then
    raise exception 'A cancellation reason is required';
  end if;

  select ride_id into v_ride_id
  from public.ride_requests
  where id = p_request_id;
  if not found then raise exception 'Ride request not found'; end if;

  select * into v_ride
  from public.rides
  where id = v_ride_id
  for update;
  select * into v_request
  from public.ride_requests
  where id = p_request_id
  for update;

  if v_user_id is null or v_request.requester_id <> v_user_id then
    raise exception 'Only the requester can cancel this request';
  end if;
  if v_request.status not in ('Pending', 'Accepted') then
    raise exception 'Only an active request can be cancelled';
  end if;
  if v_ride.status in ('In Transit', 'Completed', 'Cancelled', 'Expired')
     or v_ride.departure_at <= now() then
    raise exception 'This request can no longer be cancelled';
  end if;

  if v_request.status = 'Accepted' then
    update public.rides
    set seats_available = least(seats_total, seats_available + v_request.seats_requested)
    where id = v_ride_id;
  end if;

  update public.ride_requests
  set status = 'Cancelled',
      decision_reason = btrim(p_reason),
      cancelled_by = 'Requester',
      cancelled_at = now(),
      processed_at = now()
  where id = p_request_id;

  -- Matched must continue to mean at least one confirmed passenger. If the
  -- last accepted passenger leaves before departure, reopen the Ride record;
  -- the one-hour request cutoff still prevents late submissions.
  if v_request.status = 'Accepted'
     and v_ride.status = 'Matched'
     and not exists (
       select 1 from public.ride_requests
       where ride_id = v_ride_id and status = 'Accepted'
     ) then
    update public.rides
    set status = 'Published', recruitment_closed_at = null
    where id = v_ride_id;
  end if;

  return p_request_id;
end;
$$;

revoke all on function public.cancel_ride_request(uuid, text)
  from public, anon, authenticated;
grant execute on function public.cancel_ride_request(uuid, text)
  to authenticated;

create or replace function public.cancel_ride(p_ride_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_ride public.rides%rowtype;
begin
  if nullif(btrim(p_reason), '') is null then
    raise exception 'A cancellation reason is required';
  end if;

  select * into v_ride
  from public.rides
  where id = p_ride_id
  for update;

  if v_user_id is null or not found or v_ride.host_id <> v_user_id then
    raise exception 'Ride not found or permission denied';
  end if;
  if v_ride.status not in ('Published', 'Matched') then
    raise exception 'Only Published or Matched rides can be cancelled';
  end if;
  if now() >= v_ride.departure_at + interval '30 minutes' then
    raise exception 'This Ride expired because it was not started within 30 minutes';
  end if;

  update public.ride_requests
  set status = 'Cancelled',
      decision_reason = btrim(p_reason),
      cancelled_by = 'Host',
      cancelled_at = now(),
      processed_at = now()
  where ride_id = p_ride_id
    and status in ('Pending', 'Accepted');

  update public.rides
  set status = 'Cancelled',
      cancel_reason = btrim(p_reason),
      seats_available = seats_total,
      recruitment_closed_at = coalesce(recruitment_closed_at, now())
  where id = p_ride_id;

  return p_ride_id;
end;
$$;

revoke all on function public.cancel_ride(uuid, text)
  from public, anon, authenticated;
grant execute on function public.cancel_ride(uuid, text)
  to authenticated;

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
  if p_accuracy_meters is null or p_accuracy_meters < 0 or p_accuracy_meters > 150 then
    raise exception 'GPS accuracy must be 150 metres or better';
  end if;
  if p_latitude is null or p_longitude is null
     or p_latitude not between -90 and 90
     or p_longitude not between -180 and 180 then
    raise exception 'Location coordinates are invalid';
  end if;

  select * into v_request
  from public.ride_requests
  where id = p_request_id
  for update;
  if not found or v_request.requester_id <> v_user_id then
    raise exception 'Ride request not found or permission denied';
  end if;
  select * into v_ride
  from public.rides
  where id = v_request.ride_id
  for update;
  select * into v_verification
  from private.m2_ride_verification
  where ride_id = v_ride.id;

  if v_request.status <> 'Accepted' then raise exception 'Only accepted passengers can check in'; end if;
  if v_request.boarding_status <> 'Pending' then raise exception 'This passenger is already resolved'; end if;
  if v_ride.status not in ('Published', 'Matched') then raise exception 'This Ride is not accepting check-ins'; end if;
  if now() < v_ride.departure_at - interval '1 hour' then raise exception 'Check-in opens 1 hour before departure'; end if;
  if now() >= v_ride.departure_at + interval '30 minutes' then
    raise exception 'This Ride expired because it was not started within 30 minutes';
  end if;
  if v_verification.ride_id is null then raise exception 'This Ride needs a confirmed route before check-in'; end if;

  v_distance := round(private.m2_distance_metres(
    p_latitude, p_longitude,
    v_verification.pickup_anchor_latitude,
    v_verification.pickup_anchor_longitude
  ));

  if v_distance::double precision > least(350::double precision, 200 + p_accuracy_meters) then
    raise exception 'You are outside the pickup tolerance for this GPS accuracy';
  end if;

  update public.ride_requests
  set boarding_status = 'Checked In',
      checked_in_at = now(),
      check_in_distance_meters = v_distance,
      check_in_accuracy_meters = round(p_accuracy_meters)
  where id = p_request_id;
  return v_distance;
end;
$$;

revoke all on function public.check_in_ride_request(uuid, double precision, double precision, double precision)
  from public, anon, authenticated;
grant execute on function public.check_in_ride_request(uuid, double precision, double precision, double precision)
  to authenticated;

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
  select * into v_request
  from public.ride_requests
  where id = p_request_id
  for update;
  if not found then raise exception 'Ride request not found'; end if;
  select * into v_ride
  from public.rides
  where id = v_request.ride_id
  for update;

  if v_ride.host_id <> v_user_id then raise exception 'Only the Driver can mark a no-show'; end if;
  if v_request.status <> 'Accepted' or v_request.boarding_status <> 'Pending' then
    raise exception 'Only an unresolved accepted passenger can be marked No-show';
  end if;
  if v_ride.status not in ('Published', 'Matched') or now() < v_ride.departure_at then
    raise exception 'No-show can only be marked at or after departure';
  end if;
  if now() >= v_ride.departure_at + interval '30 minutes' then
    raise exception 'This Ride expired because it was not started within 30 minutes';
  end if;

  update public.ride_requests
  set boarding_status = 'No-show',
      no_show_at = now(),
      no_show_marked_by = v_user_id
  where id = p_request_id;
  return p_request_id;
end;
$$;

revoke all on function public.mark_ride_request_no_show(uuid)
  from public, anon, authenticated;
grant execute on function public.mark_ride_request_no_show(uuid)
  to authenticated;

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
  if now() >= v_ride.departure_at + interval '30 minutes' then
    raise exception 'This Ride expired because it was not started within 30 minutes';
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
  if now() >= v_ride.departure_at + interval '30 minutes'
     or p_started_at >= v_ride.departure_at + interval '30 minutes' then
    raise exception 'This Ride expired because it was not started within 30 minutes';
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

revoke all on function public.preflight_m2_ride_start(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.start_quoted_ride(
  uuid, uuid, timestamptz, uuid, timestamptz,
  integer, integer, integer, timestamptz,
  double precision, double precision, double precision, double precision
) from public, anon, authenticated;
grant execute on function public.preflight_m2_ride_start(uuid, uuid)
  to service_role;
grant execute on function public.start_quoted_ride(
  uuid, uuid, timestamptz, uuid, timestamptz,
  integer, integer, integer, timestamptz,
  double precision, double precision, double precision, double precision
) to service_role;

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
    select 1
    from public.rides r
    where r.id = p_ride_id
      and (
        r.host_id = v_user_id
        or public.is_accepted_ride_requester(r.id)
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
      or public.is_accepted_ride_requester(r.id)
    );
$$;

revoke all on function public.get_ride_lifecycle_context(uuid)
  from public, anon, authenticated;
revoke all on function public.get_participant_ride_detail(uuid)
  from public, anon, authenticated;
grant execute on function public.get_ride_lifecycle_context(uuid)
  to authenticated;
grant execute on function public.get_participant_ride_detail(uuid)
  to authenticated;

create or replace function public.get_m2_location_history(
  p_ride_id uuid,
  p_after timestamptz default null,
  p_limit integer default 2000
)
returns table (
  id bigint,
  user_id uuid,
  user_role text,
  latitude double precision,
  longitude double precision,
  accuracy_meters double precision,
  heading_degrees double precision,
  speed_mps double precision,
  captured_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if private.m2_historical_participant_role(p_ride_id, v_user_id) is null then
    raise exception 'Ride participant required';
  end if;

  return query
  select
    h.id, h.user_id, h.user_role, h.latitude, h.longitude,
    h.accuracy_meters, h.heading_degrees, h.speed_mps, h.captured_at
  from private.m2_location_history h
  join private.m2_location_sessions s on s.id = h.session_id
  where h.ride_id = p_ride_id
    and (p_after is null or h.captured_at > p_after)
    and not (
      h.user_id = v_user_id
      and s.history_hidden_by_owner_at is not null
    )
  order by h.captured_at asc, h.id asc
  limit greatest(1, least(coalesce(p_limit, 2000), 2000));
end;
$$;

create or replace function public.hide_m2_location_history(p_ride_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_count integer;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if private.m2_historical_participant_role(p_ride_id, v_user_id) is null then
    raise exception 'Ride participant required';
  end if;

  update private.m2_location_sessions
  set history_hidden_by_owner_at = coalesce(history_hidden_by_owner_at, now()),
      purge_after = coalesce(purge_after, now() + interval '180 days')
  where ride_id = p_ride_id and user_id = v_user_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.get_m2_location_history(uuid, timestamptz, integer)
  from public, anon, authenticated;
revoke all on function public.hide_m2_location_history(uuid)
  from public, anon, authenticated;
grant execute on function public.get_m2_location_history(uuid, timestamptz, integer)
  to authenticated;
grant execute on function public.hide_m2_location_history(uuid)
  to authenticated;

create or replace function private.notify_m2_ride_request_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host_id uuid;
  v_was_accepted boolean := false;
begin
  select host_id into v_host_id
  from public.rides
  where id = new.ride_id;

  if tg_op = 'INSERT' and new.status = 'Pending' then
    perform private.create_user_notification(
      v_host_id, 'm2', 'ride_request_received', 'New ride request',
      'A passenger requested to join your ride.',
      '/ride/' || new.ride_id::text || '/requests',
      jsonb_build_object('rideId', new.ride_id, 'requestId', new.id),
      'm2:request:' || new.id::text || ':received'
    );
    return new;
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    v_was_accepted := old.status = 'Accepted' and new.accepted_at is not null;

    if new.status in ('Accepted', 'Rejected', 'Expired') then
      perform private.create_user_notification(
        new.requester_id,
        'm2',
        case
          when new.status = 'Accepted' then 'ride_request_accepted'
          when new.status = 'Rejected' then 'ride_request_rejected'
          when v_was_accepted then 'ride_not_started'
          else 'ride_request_expired'
        end,
        case
          when new.status = 'Accepted' then 'Ride request accepted'
          when new.status = 'Rejected' then 'Ride request not accepted'
          when v_was_accepted then 'Ride expired'
          else 'Ride request expired'
        end,
        case
          when new.status = 'Accepted' then 'Your seat is confirmed. Open the ride to see what comes next.'
          when new.status = 'Rejected' then 'The Driver was unable to accept this request.'
          when v_was_accepted then 'The ride did not start within 30 minutes of departure.'
          else 'This request expired because the departure time passed.'
        end,
        case
          when new.status = 'Accepted' then '/ride/' || new.ride_id::text || '?view=trip'
          when v_was_accepted then '/ride/' || new.ride_id::text || '?view=details'
          else '/ride'
        end,
        jsonb_build_object('rideId', new.ride_id, 'requestId', new.id),
        'm2:request:' || new.id::text || ':status:' || lower(new.status)
      );
    elsif new.status = 'Cancelled' and new.cancelled_by = 'Requester' then
      perform private.create_user_notification(
        v_host_id, 'm2', 'ride_request_cancelled', 'Passenger cancelled',
        'A passenger cancelled their ride request.',
        '/ride/' || new.ride_id::text || '/requests',
        jsonb_build_object('rideId', new.ride_id, 'requestId', new.id),
        'm2:request:' || new.id::text || ':cancelled-by-requester'
      );
    end if;
  end if;

  if tg_op = 'UPDATE'
     and new.boarding_status is distinct from old.boarding_status then
    if new.boarding_status = 'Checked In' then
      perform private.create_user_notification(
        v_host_id, 'm2', 'passenger_checked_in', 'Passenger checked in',
        'A passenger is ready near the pickup point.',
        '/ride/' || new.ride_id::text || '?view=trip',
        jsonb_build_object('rideId', new.ride_id, 'requestId', new.id),
        'm2:request:' || new.id::text || ':boarding:checked-in'
      );
    elsif new.boarding_status = 'No-show' then
      perform private.create_user_notification(
        new.requester_id, 'm2', 'passenger_no_show', 'Marked as no-show',
        'The Driver marked this booking as a no-show.',
        '/ride/' || new.ride_id::text || '?view=trip',
        jsonb_build_object('rideId', new.ride_id, 'requestId', new.id),
        'm2:request:' || new.id::text || ':boarding:no-show'
      );
    end if;
  end if;

  return new;
end;
$$;

create or replace function private.notify_m2_ride_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request record;
begin
  if new.status is distinct from old.status and new.status = 'Cancelled' then
    for v_request in
      select requester_id, id
      from public.ride_requests
      where ride_id = new.id and status in ('Pending', 'Accepted')
    loop
      perform private.create_user_notification(
        v_request.requester_id, 'm2', 'ride_cancelled', 'Ride cancelled',
        'The Driver cancelled this ride.',
        '/ride/' || new.id::text || '?view=details',
        jsonb_build_object('rideId', new.id, 'requestId', v_request.id),
        'm2:ride:' || new.id::text || ':cancelled:' || v_request.id::text
      );
    end loop;
  end if;

  if new.status is distinct from old.status and new.status = 'Expired' then
    perform private.create_user_notification(
      new.host_id, 'm2', 'ride_expired', 'Ride expired',
      case when new.expired_at >= new.departure_at + interval '30 minutes'
      then 'The ride did not start within 30 minutes of departure.'
      else 'The ride expired because no passenger was confirmed before departure.' end,
      '/ride/' || new.id::text || '?view=details',
      jsonb_build_object('rideId', new.id),
      'm2:ride:' || new.id::text || ':expired:driver'
    );
  end if;

  if new.status is distinct from old.status and new.status = 'Completed' then
    perform private.create_user_notification(
      new.host_id, 'm2', 'ride_completed', 'Ride completed',
      'Your ride is complete. You can now review your passengers.',
      '/ride/' || new.id::text || '?view=details',
      jsonb_build_object('rideId', new.id),
      'm2:ride:' || new.id::text || ':completed:driver'
    );

    for v_request in
      select requester_id, id
      from public.ride_requests
      where ride_id = new.id
        and status = 'Accepted'
        and boarding_status = 'Checked In'
    loop
      perform private.create_user_notification(
        v_request.requester_id, 'm2', 'ride_completed', 'Ride completed',
        'Your ride is complete. You can now review the Driver.',
        '/ride/' || new.id::text || '?view=details',
        jsonb_build_object('rideId', new.id, 'requestId', v_request.id),
        'm2:ride:' || new.id::text || ':completed:' || v_request.id::text
      );
    end loop;
  end if;

  if new.status in ('Published', 'Matched')
     and (
       new.departure_at is distinct from old.departure_at
       or new.pickup is distinct from old.pickup
       or new.destination is distinct from old.destination
       or new.pickup_instructions is distinct from old.pickup_instructions
     ) then
    for v_request in
      select requester_id, id
      from public.ride_requests
      where ride_id = new.id and status in ('Pending', 'Accepted')
    loop
      perform private.create_user_notification(
        v_request.requester_id, 'm2', 'ride_arrangement_changed',
        'Ride arrangement updated',
        'The Driver changed an important ride arrangement. Review the latest details.',
        '/ride/' || new.id::text || '?view=details',
        jsonb_build_object('rideId', new.id, 'requestId', v_request.id),
        'm2:ride:' || new.id::text || ':arrangement:'
          || to_char(new.updated_at at time zone 'UTC', 'YYYYMMDDHH24MISSUS')
          || ':' || v_request.id::text
      );
    end loop;
  end if;

  return new;
end;
$$;

revoke all on function private.notify_m2_ride_request_change()
  from public, anon, authenticated;
revoke all on function private.notify_m2_ride_change()
  from public, anon, authenticated;

-- The existing m2-ride-lifecycle Cron calls this function every minute. Rides
-- are locked in UUID order before request rows are updated, matching the lock
-- order used by the interactive lifecycle RPCs.
create or replace function private.process_ride_lifecycle()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_departure_processed integer := 0;
  v_expiry_processed integer := 0;
  v_completion_processed integer := 0;
begin
  perform 1
  from public.rides
  where status in ('Published', 'Matched')
    and departure_at <= now()
  order by id
  for update;

  -- Pending requests always close at departure, regardless of whether an
  -- accepted passenger creates a 30-minute start grace period.
  update public.ride_requests rr
  set status = 'Expired',
      decision_reason = 'Departure time reached before request decision',
      cancelled_by = 'System',
      processed_at = now()
  from public.rides r
  where rr.ride_id = r.id
    and rr.status = 'Pending'
    and r.status in ('Published', 'Matched')
    and r.departure_at <= now();

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
        ) then coalesce(r.expired_at, now())
        else r.expired_at
      end
  where r.status = 'Published'
    and r.departure_at <= now();
  get diagnostics v_departure_processed = row_count;

  -- An accepted passenger remains a historical participant, but an unstarted
  -- booking is no longer an active request after the grace deadline.
  update public.ride_requests rr
  set status = 'Expired',
      decision_reason = 'Ride did not start within 30 minutes of departure',
      cancelled_by = 'System',
      processed_at = now()
  from public.rides r
  where rr.ride_id = r.id
    and rr.status in ('Pending', 'Accepted')
    and r.status in ('Published', 'Matched')
    and r.departure_at + interval '30 minutes' <= now();

  update public.rides r
  set status = 'Expired',
      expired_at = coalesce(r.expired_at, now()),
      recruitment_closed_at = coalesce(r.recruitment_closed_at, now())
  where r.status in ('Published', 'Matched')
    and r.departure_at + interval '30 minutes' <= now();
  get diagnostics v_expiry_processed = row_count;

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

  return v_departure_processed + v_expiry_processed + v_completion_processed;
end;
$$;

revoke all on function private.process_ride_lifecycle()
  from public, anon, authenticated;
