-- Module 2 deterministic lifecycle processor and trusted Module 6 transition
-- contract. Browser clients cannot call the verification transition.

create extension if not exists pg_cron;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.process_ride_lifecycle()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_processed integer;
begin
  -- Lock due Published rides first so request acceptance and lifecycle changes
  -- always serialize on the same ride row.
  perform 1
  from public.rides
  where status = 'Published'
    and departure_at <= now()
  order by id
  for update;

  update public.ride_requests rr
  set status = 'Expired',
      decision_reason = 'Departure time reached',
      cancelled_by = 'System',
      processed_at = now()
  from public.rides r
  where rr.ride_id = r.id
    and rr.status = 'Pending'
    and r.departure_at <= now();

  update public.rides r
  set status = case
        when exists (
          select 1
          from public.ride_requests rr
          where rr.ride_id = r.id
            and rr.status = 'Accepted'
        ) then 'Matched'
        else 'Expired'
      end,
      recruitment_closed_at = case
        when exists (
          select 1
          from public.ride_requests rr
          where rr.ride_id = r.id
            and rr.status = 'Accepted'
        ) then coalesce(r.recruitment_closed_at, now())
        else r.recruitment_closed_at
      end,
      expired_at = case
        when not exists (
          select 1
          from public.ride_requests rr
          where rr.ride_id = r.id
            and rr.status = 'Accepted'
        ) then now()
        else r.expired_at
      end
  where r.status = 'Published'
    and r.departure_at <= now();

  get diagnostics v_processed = row_count;
  return v_processed;
end;
$$;

revoke all on function private.process_ride_lifecycle() from public, anon, authenticated;

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
begin
  select * into v_ride
  from public.rides
  where id = p_ride_id
  for update;

  if not found then
    raise exception 'Ride not found';
  end if;

  if p_next_status = 'In Transit' then
    if v_ride.status <> 'Matched' then
      raise exception 'Only Matched rides can enter In Transit';
    end if;
    if v_ride.departure_at > now() then
      raise exception 'A ride cannot start before its departure time';
    end if;
  elsif p_next_status = 'Completed' then
    if v_ride.status <> 'In Transit' then
      raise exception 'Only In Transit rides can be completed';
    end if;
  else
    raise exception 'Unsupported verified ride transition';
  end if;

  update public.rides
  set status = p_next_status
  where id = p_ride_id;

  return p_ride_id;
end;
$$;

revoke all on function public.transition_verified_ride(uuid, text)
  from public, anon, authenticated;
grant execute on function public.transition_verified_ride(uuid, text)
  to service_role;

select cron.schedule(
  'm2-ride-lifecycle',
  '* * * * *',
  'select private.process_ride_lifecycle();'
);
