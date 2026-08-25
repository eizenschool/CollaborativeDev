-- Fix Family Link token creation on Supabase projects where pgcrypto is
-- installed in the extensions schema. The RPC keeps an empty search_path, so
-- extension functions must be schema-qualified.

create or replace function public.create_m2_family_location_share(p_ride_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_status text;
  v_departure timestamptz;
  v_raw text;
  v_id uuid;
  v_expires timestamptz;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if private.m2_participant_role(p_ride_id, v_user_id) <> 'Passenger' then
    raise exception 'Only an accepted passenger can create a family link';
  end if;

  select r.status, r.departure_at
  into v_status, v_departure
  from public.rides r
  where r.id = p_ride_id;

  if v_status in ('Completed', 'Cancelled', 'Expired') then
    raise exception 'This Ride no longer accepts family links';
  end if;

  v_expires := v_departure + interval '24 hours';
  v_raw := replace(replace(replace(
    encode(extensions.gen_random_bytes(32), 'base64'),
    '+', '-'), '/', '_'), '=', '');

  insert into private.m2_family_location_shares (
    ride_id,
    owner_id,
    token_hash,
    expires_at
  ) values (
    p_ride_id,
    v_user_id,
    encode(extensions.digest(v_raw, 'sha256'), 'hex'),
    v_expires
  )
  returning id into v_id;

  return jsonb_build_object(
    'shareId', v_id,
    'token', v_raw,
    'expiresAt', v_expires
  );
end;
$$;

revoke all on function public.create_m2_family_location_share(uuid)
from public, anon, authenticated;
grant execute on function public.create_m2_family_location_share(uuid)
to authenticated;
