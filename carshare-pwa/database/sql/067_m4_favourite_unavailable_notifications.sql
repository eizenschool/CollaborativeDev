-- Module 4: notify travellers when a saved ride becomes unavailable.
--
-- Notifications are written through the shared producer from migration 033,
-- so the existing notification centre and Web Push delivery continue to be
-- the only delivery systems. The trigger projects only the same public route,
-- schedule, status, and capacity information already shown on a ride card.

create or replace function private.m4_url_encode(p_value text)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_bytes bytea := convert_to(p_value, 'UTF8');
  v_index integer;
  v_byte integer;
  v_result text := '';
begin
  if octet_length(v_bytes) = 0 then
    return '';
  end if;

  for v_index in 0..octet_length(v_bytes) - 1 loop
    v_byte := get_byte(v_bytes, v_index);
    if (v_byte between 48 and 57)
       or (v_byte between 65 and 90)
       or (v_byte between 97 and 122)
       or v_byte in (45, 46, 95, 126) then
      v_result := v_result || chr(v_byte);
    else
      v_result := v_result || '%' || upper(lpad(to_hex(v_byte), 2, '0'));
    end if;
  end loop;

  return v_result;
end;
$$;

create or replace function private.notify_m4_favourite_unavailable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_favourite record;
  v_action_path text;
  v_transition_key text;
  v_departure_local timestamp without time zone;
begin
  -- Only notify on an availability transition. Repeated updates while the ride
  -- remains unavailable do not create extra alerts.
  if not (
    old.status = 'Published'
    and coalesce(old.seats_available, 0) > 0
    and (
      new.status is distinct from 'Published'
      or coalesce(new.seats_available, 0) <= 0
    )
  ) then
    return new;
  end if;

  v_action_path := '/search?pickup='
    || private.m4_url_encode(left(btrim(new.pickup), 120))
    || '&destination='
    || private.m4_url_encode(left(btrim(new.destination), 120));

  if new.journey_scale in ('Urban', 'Intercity') then
    v_action_path := v_action_path
      || '&scale=' || private.m4_url_encode(new.journey_scale);
  end if;

  -- Search only keeps date/time hints that can still produce a future ride.
  if new.departure_at >= now() then
    v_departure_local := new.departure_at at time zone 'Asia/Kuala_Lumpur';
    v_action_path := v_action_path
      || '&date=' || to_char(v_departure_local, 'YYYY-MM-DD')
      || '&departAfter=' || to_char(v_departure_local, 'HH24:MI');
  end if;

  -- updated_at is maintained by the shared rides BEFORE UPDATE trigger. It
  -- identifies this availability transition while allowing a later reopened
  -- ride to generate one fresh alert if it becomes unavailable again.
  v_transition_key := 'm4:favourite-unavailable:' || new.id::text || ':'
    || to_char(new.updated_at at time zone 'UTC', 'YYYYMMDDHH24MISSUS');

  for v_favourite in
    select f.user_id
    from public.ride_favourites f
    where f.ride_id = new.id
      and f.user_id <> new.host_id
  loop
    perform private.create_user_notification(
      v_favourite.user_id,
      'm4',
      'favourite_ride_unavailable',
      'A saved ride is unavailable',
      'A ride in your Favourites is no longer available. Find a similar ride for this journey.',
      v_action_path,
      jsonb_build_object(
        'rideId', new.id,
        'rideStatus', new.status,
        'seatsAvailable', greatest(coalesce(new.seats_available, 0), 0)
      ),
      v_transition_key
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists notify_m4_favourite_unavailable on public.rides;
create trigger notify_m4_favourite_unavailable
after update of status, seats_available on public.rides
for each row execute function private.notify_m4_favourite_unavailable();

revoke all on function private.m4_url_encode(text)
  from public, anon, authenticated;
revoke all on function private.notify_m4_favourite_unavailable()
  from public, anon, authenticated;
