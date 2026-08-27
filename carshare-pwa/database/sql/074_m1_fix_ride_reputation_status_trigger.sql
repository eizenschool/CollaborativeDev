-- Repair the Ride reputation trigger introduced by 072_m1.
-- public.rides records cancellation time through recruitment_closed_at and do
-- not have the ride_requests-only cancelled_at or cancelled_by columns.

create or replace function private.reputation_from_ride_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event text;
  v_delta integer;
  v_cancelled_at timestamptz;
  v_request record;
begin
  if new.status = 'Completed' and old.status is distinct from 'Completed' then
    perform private.record_reputation_event(new.host_id, new.id, 'M2', new.id::text || ':completed:host', 'ride_completed', 'host', 1, 'Verified completed ride');
    for v_request in
      select id, requester_id from public.ride_requests
      where ride_id = new.id and status = 'Accepted' and boarding_status = 'Checked In'
    loop
      perform private.record_reputation_event(v_request.requester_id, new.id, 'M2', v_request.id::text || ':completed', 'ride_completed', 'traveller', 1, 'Verified completed ride');
    end loop;
  elsif new.status = 'Cancelled' and old.status is distinct from 'Cancelled' then
    v_cancelled_at := coalesce(new.recruitment_closed_at, new.updated_at, now());
    if new.departure_at - v_cancelled_at > interval '24 hours' then v_event := 'host_cancelled_early'; v_delta := -1;
    elsif new.departure_at - v_cancelled_at >= interval '6 hours' then v_event := 'host_cancelled_late'; v_delta := -3;
    else v_event := 'host_cancelled_very_late'; v_delta := -6;
    end if;
    perform private.record_reputation_event(new.host_id, new.id, 'M2', new.id::text || ':cancelled:host', v_event, 'host', v_delta, 'Driver cancellation');
  end if;
  return new;
end;
$$;
