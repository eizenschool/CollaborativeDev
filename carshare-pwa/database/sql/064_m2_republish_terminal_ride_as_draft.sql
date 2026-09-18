-- Module 2 terminal Ride republishing.
-- A Host may copy an immutable history Ride into a new Draft. Only editable
-- settings are copied; requests, lifecycle state, route quotes, live data,
-- reviews, conversations, and the old Ride's private pickup photo remain bound
-- to the source Ride.

create or replace function public.republish_m2_ride_as_draft(p_ride_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_source public.rides%rowtype;
  v_new_ride_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select r.* into v_source
  from public.rides r
  where r.id = p_ride_id
  for share;

  if not found or v_source.host_id <> v_user_id then
    raise exception 'Ride not found or permission denied';
  end if;

  if v_source.status not in ('Completed', 'Cancelled', 'Expired') then
    raise exception 'Only a completed, cancelled, or expired Ride can be republished';
  end if;

  insert into public.rides (
    host_id, vehicle_id, pickup, destination, pickup_place_id,
    pickup_latitude, pickup_longitude, destination_place_id,
    pickup_instructions, departure_at, journey_scale, seats_total,
    seats_available, contribution, restriction_tags, status, waypoints
  ) values (
    v_user_id, v_source.vehicle_id, v_source.pickup, v_source.destination,
    v_source.pickup_place_id, v_source.pickup_latitude,
    v_source.pickup_longitude, v_source.destination_place_id,
    coalesce(v_source.pickup_instructions, ''), v_source.departure_at,
    v_source.journey_scale, v_source.seats_total, v_source.seats_total,
    coalesce(v_source.contribution, ''),
    coalesce(v_source.restriction_tags, '{}'), 'Draft',
    coalesce(v_source.waypoints, '[]'::jsonb)
  ) returning id into v_new_ride_id;

  return v_new_ride_id;
end;
$$;

revoke all on function public.republish_m2_ride_as_draft(uuid)
  from public, anon, authenticated;
grant execute on function public.republish_m2_ride_as_draft(uuid)
  to authenticated;
