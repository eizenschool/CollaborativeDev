-- Module 6 FR-6.33 / UC6.12: notify a registered traveller when a ride to
-- their destination is published. Depends on 024_m6_destination_discovery.sql
-- (public.ride_notify_registration, public.places) and
-- 033_project_notifications.sql (private.create_user_notification). This
-- migration deliberately does not change Web Push subscriptions, Edge
-- Functions, service workers, VAPID, or webhooks - it is a single trigger plus
-- a daily expiry job, following the shape of 038_m2_ride_usability_notifications.sql.
--
-- `ride_notify_registration`'s partial index (024:136-138) was built for
-- exactly this query - "UC6.12 matches a newly published ride against
-- outstanding registrations" - and has been unused since the table was
-- deployed. This migration is what finally reads it.

create extension if not exists pg_cron;

create or replace function private.notify_m6_ride_available()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reg record;
  -- rides.date/departure_at are authored and stored against Malaysia time
  -- (013_m2_ride_requests_and_departure.sql); ride_notify_registration.travel_date
  -- is a plain date with no timezone of its own. Casting departure_at to date
  -- directly reads UTC and would shift every evening departure to the
  -- previous calendar day - the same trap localDate.js exists to avoid on the
  -- client. Compare in the same zone the date was written in.
  v_departure_date date;
begin
  if new.destination_place_id is null
     or new.status not in ('Published', 'Matched')
     or coalesce(new.seats_available, 0) <= 0 then
    return new;
  end if;

  v_departure_date := (new.departure_at at time zone 'Asia/Kuala_Lumpur')::date;

  for v_reg in
    select reg.id, reg.user_id, reg.place_id
    from public.ride_notify_registration reg
    join public.places pl on pl.id = reg.place_id
    where reg.status = 'active'
      and pl.source_place_id = new.destination_place_id
      and reg.travel_date = v_departure_date
      -- A Host is never notified that their own published ride exists.
      and reg.user_id <> new.host_id
  loop
    perform private.create_user_notification(
      v_reg.user_id, 'm6', 'ride_available', 'A ride is available',
      'A ride to a destination you registered interest in has been published.',
      '/discover/' || v_reg.place_id::text,
      jsonb_build_object('placeId', v_reg.place_id, 'rideId', new.id),
      'm6:notify:' || v_reg.id::text
    );

    update public.ride_notify_registration
    set status = 'fulfilled', closed_at = now()
    where id = v_reg.id;
  end loop;

  return new;
end;
$$;

-- `after insert or update`, unlike 038's ride trigger (`after update` only):
-- a ride is published directly rather than drafted then transitioned, so a
-- registration made before the ride existed must still be matched on the
-- very insert that publishes it.
drop trigger if exists notify_m6_ride_available on public.rides;
create trigger notify_m6_ride_available
after insert or update of status, destination_place_id, departure_at, seats_available
on public.rides
for each row execute function private.notify_m6_ride_available();

revoke all on function private.notify_m6_ride_available() from public, anon, authenticated;

-- Without this, a registration for a date that has passed sits at 'active'
-- forever and 'expired' - one of ride_notify_registration's own four status
-- values (024) - is otherwise unreachable.
create or replace function private.expire_m6_ride_registrations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expired integer;
begin
  with updated as (
    update public.ride_notify_registration
    set status = 'expired', closed_at = now()
    where status = 'active'
      and travel_date < (now() at time zone 'Asia/Kuala_Lumpur')::date
    returning 1
  )
  select count(*) into v_expired from updated;
  return v_expired;
end;
$$;

revoke all on function private.expire_m6_ride_registrations() from public, anon, authenticated;

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in select jobid from cron.job where jobname = 'm6-expire-registrations'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
  perform cron.schedule(
    'm6-expire-registrations',
    '11 4 * * *',
    'select private.expire_m6_ride_registrations();'
  );
end;
$$;
