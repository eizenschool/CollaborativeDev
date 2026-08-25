-- Module 2 adaptive passenger check-in tolerance.
--
-- 028 remains the historical baseline. This follow-up widens only passenger
-- check-in; Driver destination arrival keeps its 100 m / 200 m policy.

alter table public.ride_requests
  add column if not exists check_in_accuracy_meters integer;

alter table public.ride_requests
  drop constraint if exists ride_requests_check_in_pair_check;

alter table public.ride_requests
  add constraint ride_requests_check_in_accuracy_check check (
    check_in_accuracy_meters is null
    or check_in_accuracy_meters between 0 and 150
  ),
  add constraint ride_requests_check_in_pair_check check (
    (boarding_status <> 'Checked In'
      and checked_in_at is null
      and check_in_distance_meters is null
      and check_in_accuracy_meters is null)
    or (
      boarding_status = 'Checked In'
      and checked_in_at is not null
      and check_in_distance_meters between 0 and 350
      and check_in_accuracy_meters between 0 and 150
      and no_show_at is null
      and no_show_marked_by is null
    )
  );

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
