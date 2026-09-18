-- User-requested one-off status adjustment for the three screenshot rides.
-- Uses existing triggers for chats, notifications, reputation, and live tracking.
-- Preserves scheduled dates and recorded boarding/GPS facts; this is a manual override.
begin;
do $$
declare
  v_ids uuid[] := array[
    '23b5db17-62c7-4c7d-95e8-90ba6d9303b4'::uuid,
    'e6262bc1-a5a5-4bac-94eb-a62756d9c559'::uuid,
    'a71d0cc6-3e24-4e64-8b5b-5369f6f77e4f'::uuid
  ];
begin
  perform 1 from public.rides where id = any(v_ids) order by id for update;
  if (select count(*) from public.rides where id = any(v_ids)
      and host_id = '927a5134-5ad6-4640-b70e-bb8a2890db3f'
      and status = 'Published') <> 3 then
    raise exception 'Expected exactly the three specified Published rides; aborting';
  end if;

  update public.ride_requests
  set status = 'Expired', cancelled_by = 'System',
      decision_reason = 'Ride manually marked Expired at user request',
      processed_at = now()
  where ride_id = v_ids[2] and status in ('Pending', 'Accepted');

  -- Mirrors the deployed host cancellation fields, without impersonating a session.
  update public.ride_requests
  set status = 'Cancelled', cancelled_by = 'Host',
      decision_reason = 'Cancelled by host', cancelled_at = now(), processed_at = now()
  where ride_id = v_ids[3] and status in ('Pending', 'Accepted');

  update public.ride_requests
  set status = 'Expired', cancelled_by = 'System',
      decision_reason = 'Ride completed before request decision', processed_at = now()
  where ride_id = v_ids[1] and status = 'Pending';

  update private.m2_ride_verification
  set completed_at = now() where ride_id = v_ids[1];

  update public.rides
  set status = 'Completed', recruitment_closed_at = coalesce(recruitment_closed_at, now())
  where id = v_ids[1];

  update public.rides
  set status = 'Expired', expired_at = now(),
      recruitment_closed_at = coalesce(recruitment_closed_at, now())
  where id = v_ids[2];

  update public.rides
  set status = 'Cancelled', cancel_reason = 'Cancelled by host',
      seats_available = seats_total,
      recruitment_closed_at = coalesce(recruitment_closed_at, now())
  where id = v_ids[3];

  if (select count(*) from public.conversations where ride_id = any(v_ids)) <> 6
     or exists (
       select 1 from public.conversations c join public.rides r on r.id = c.ride_id
       where r.id = any(v_ids) and (
         c.ride_status is distinct from r.status or c.terminal_at is null
         or c.expires_at is distinct from c.terminal_at + interval '7 days'
       )
     ) then
    raise exception 'Expected six synchronized terminal conversations; rolling back';
  end if;
end;
$$;
commit;

