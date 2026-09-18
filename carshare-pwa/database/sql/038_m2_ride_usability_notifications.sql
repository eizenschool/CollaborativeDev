-- Module 2 action-oriented in-app notification producers.
-- Depends on 028_m2_route_schedule_and_completion.sql and
-- 033_project_notifications.sql. This migration deliberately does not change
-- Web Push subscriptions, Edge Functions, service workers, VAPID, or webhooks.

create extension if not exists pg_cron;

create or replace function private.notify_m2_ride_request_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host_id uuid;
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
    if new.status in ('Accepted', 'Rejected', 'Expired') then
      perform private.create_user_notification(
        new.requester_id,
        'm2',
        case new.status
          when 'Accepted' then 'ride_request_accepted'
          when 'Rejected' then 'ride_request_rejected'
          else 'ride_request_expired'
        end,
        case new.status
          when 'Accepted' then 'Ride request accepted'
          when 'Rejected' then 'Ride request not accepted'
          else 'Ride request expired'
        end,
        case new.status
          when 'Accepted' then 'Your seat is confirmed. Open the ride to see what comes next.'
          when 'Rejected' then 'The Driver was unable to accept this request.'
          else 'This request expired because the departure time passed.'
        end,
        case when new.status = 'Accepted'
          then '/ride/' || new.ride_id::text || '?view=trip'
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
          || to_char(new.updated_at at time zone 'UTC', 'YYYYMMDDHH24MISSUS') || ':' || v_request.id::text
      );
    end loop;
  end if;

  return new;
end;
$$;

create or replace function private.notify_m2_driver_arrival()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request record;
begin
  if new.driver_arrived_at is not null and old.driver_arrived_at is null then
    for v_request in
      select requester_id, id
      from public.ride_requests
      where ride_id = new.ride_id
        and status = 'Accepted'
        and boarding_status = 'Checked In'
    loop
      perform private.create_user_notification(
        v_request.requester_id, 'm2', 'driver_arrived',
        'Driver reached the destination',
        'Confirm your arrival to finish the ride.',
        '/ride/' || new.ride_id::text || '?view=trip',
        jsonb_build_object('rideId', new.ride_id, 'requestId', v_request.id),
        'm2:ride:' || new.ride_id::text || ':driver-arrived:' || v_request.id::text
      );
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists notify_m2_ride_request_change on public.ride_requests;
create trigger notify_m2_ride_request_change
after insert or update of status, boarding_status on public.ride_requests
for each row execute function private.notify_m2_ride_request_change();

drop trigger if exists notify_m2_ride_change on public.rides;
create trigger notify_m2_ride_change
after update of status, departure_at, pickup, destination, pickup_instructions on public.rides
for each row execute function private.notify_m2_ride_change();

drop trigger if exists notify_m2_driver_arrival on private.m2_ride_verification;
create trigger notify_m2_driver_arrival
after update of driver_arrived_at on private.m2_ride_verification
for each row execute function private.notify_m2_driver_arrival();

create or replace function private.enqueue_m2_ride_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_enqueued integer := 0;
begin
  -- The windows overlap scheduled runs. Recipient + stable dedupe keys make
  -- retries safe and allow a short outage to catch up without stale alerts.
  for v_item in
    select r.id as ride_id, r.host_id as recipient_id, 'driver'::text as role
    from public.rides r
    where r.status in ('Published', 'Matched')
      and r.departure_at > now() + interval '1 hour'
      and r.departure_at <= now() + interval '24 hours'
    union all
    select r.id, rr.requester_id, 'passenger'
    from public.rides r
    join public.ride_requests rr on rr.ride_id = r.id
    where r.status in ('Published', 'Matched')
      and rr.status = 'Accepted' and rr.boarding_status <> 'No-show'
      and r.departure_at > now() + interval '1 hour'
      and r.departure_at <= now() + interval '24 hours'
  loop
    perform private.create_user_notification(
      v_item.recipient_id, 'm2', 'ride_reminder_24h', 'Ride within 24 hours',
      'Your ride departs within 24 hours. Review the latest arrangements.',
      '/ride/' || v_item.ride_id::text || '?view=details',
      jsonb_build_object('rideId', v_item.ride_id, 'role', v_item.role),
      'm2:ride:' || v_item.ride_id::text || ':reminder:24h:' || v_item.role
    );
    v_enqueued := v_enqueued + 1;
  end loop;

  for v_item in
    select r.id as ride_id, r.host_id as recipient_id, 'driver'::text as role
    from public.rides r
    where r.status in ('Published', 'Matched')
      and r.departure_at > now()
      and r.departure_at <= now() + interval '1 hour'
    union all
    select r.id, rr.requester_id, 'passenger'
    from public.rides r
    join public.ride_requests rr on rr.ride_id = r.id
    where r.status in ('Published', 'Matched')
      and rr.status = 'Accepted' and rr.boarding_status <> 'No-show'
      and r.departure_at > now()
      and r.departure_at <= now() + interval '1 hour'
  loop
    perform private.create_user_notification(
      v_item.recipient_id, 'm2', 'ride_check_in_open', 'Ride starts within an hour',
      case when v_item.role = 'passenger'
        then 'Check-in is open when you are near the pickup point.'
        else 'Check passenger readiness before departure.'
      end,
      '/ride/' || v_item.ride_id::text || '?view=trip',
      jsonb_build_object('rideId', v_item.ride_id, 'role', v_item.role),
      'm2:ride:' || v_item.ride_id::text || ':reminder:1h:' || v_item.role
    );
    v_enqueued := v_enqueued + 1;
  end loop;

  for v_item in
    select r.id as ride_id, r.host_id as recipient_id
    from public.rides r
    where r.status in ('Published', 'Matched')
      and r.departure_at <= now()
      and r.departure_at > now() - interval '30 minutes'
      and exists (
        select 1 from public.ride_requests rr
        where rr.ride_id = r.id and rr.status = 'Accepted'
      )
  loop
    perform private.create_user_notification(
      v_item.recipient_id, 'm2', 'ride_departure_due', 'Departure is due',
      'Resolve passenger readiness, then start the ride.',
      '/ride/' || v_item.ride_id::text || '?view=trip',
      jsonb_build_object('rideId', v_item.ride_id, 'role', 'driver'),
      'm2:ride:' || v_item.ride_id::text || ':reminder:departure'
    );
    v_enqueued := v_enqueued + 1;
  end loop;

  return v_enqueued;
end;
$$;

revoke all on function private.notify_m2_ride_request_change() from public, anon, authenticated;
revoke all on function private.notify_m2_ride_change() from public, anon, authenticated;
revoke all on function private.notify_m2_driver_arrival() from public, anon, authenticated;
revoke all on function private.enqueue_m2_ride_reminders() from public, anon, authenticated;

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in select jobid from cron.job where jobname = 'm2-ride-reminders'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
  perform cron.schedule(
    'm2-ride-reminders',
    '* * * * *',
    'select private.enqueue_m2_ride_reminders();'
  );
end;
$$;
