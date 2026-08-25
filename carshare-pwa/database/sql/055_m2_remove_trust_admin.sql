-- Remove the narrow Trust Admin / ride-dispute rollout while preserving
-- participant live sharing, family links, sampled history and Module 5 replay.
-- Migrations 043-049 remain immutable deployment history.

delete from public.user_notifications
where source_module = 'm2'
  and event_type in ('ride_dispute_opened', 'ride_dispute_resolved');

drop function if exists public.get_m2_dispute_evidence(uuid, text);
drop function if exists public.resolve_m2_ride_dispute(uuid, text, text);
drop function if exists public.claim_m2_ride_dispute(uuid);
drop function if exists public.list_m2_open_disputes();
drop function if exists public.open_m2_ride_dispute(uuid, text);
drop function if exists public.get_my_project_roles();
drop function if exists public.admin_reassign_m2_ride_dispute(uuid, uuid, uuid);
drop function if exists public.admin_list_m2_open_disputes(uuid);
drop function if exists public.admin_list_m2_open_disputes();
drop function if exists public.admin_revoke_trust_admin(uuid, uuid);
drop function if exists public.admin_grant_trust_admin(uuid, uuid);
drop function if exists public.admin_list_project_roles();

-- A point is stale after 30 seconds in the client and unavailable after two
-- minutes. The row remains private until the five-minute cleanup safety net.
create or replace function public.get_m2_live_locations(p_ride_id uuid)
returns table (
  user_id uuid,
  user_role text,
  latitude double precision,
  longitude double precision,
  accuracy_meters double precision,
  heading_degrees double precision,
  speed_mps double precision,
  captured_at timestamptz,
  server_updated_at timestamptz,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  v_role := private.m2_participant_role(p_ride_id, v_user_id);
  if v_role is null then raise exception 'Ride participant required'; end if;

  return query
    select l.user_id, l.user_role, l.latitude, l.longitude,
           l.accuracy_meters, l.heading_degrees, l.speed_mps,
           l.captured_at, l.server_updated_at, l.expires_at
    from private.m2_live_locations l
    where l.ride_id = p_ride_id
      and l.expires_at > now()
      and l.server_updated_at > now() - interval '2 minutes'
      and (
        v_role = 'Driver'
        or l.user_id = v_user_id
        or l.user_role = 'Driver'
      );
end;
$$;

create or replace function public.get_m2_family_location_by_token(p_token text)
returns table (
  ride_id uuid,
  owner_id uuid,
  user_id uuid,
  user_role text,
  latitude double precision,
  longitude double precision,
  accuracy_meters double precision,
  heading_degrees double precision,
  speed_mps double precision,
  captured_at timestamptz,
  server_updated_at timestamptz,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_share private.m2_family_location_shares%rowtype;
begin
  if nullif(btrim(p_token), '') is null or length(p_token) < 40 then return; end if;

  select * into v_share
  from private.m2_family_location_shares s
  where s.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and s.revoked_at is null
    and s.expires_at > now();

  if v_share.id is null then return; end if;

  return query
    select l.ride_id, v_share.owner_id, l.user_id, l.user_role,
           l.latitude, l.longitude, l.accuracy_meters,
           l.heading_degrees, l.speed_mps, l.captured_at,
           l.server_updated_at, l.expires_at
    from private.m2_live_locations l
    join public.rides r on r.id = l.ride_id
    where l.ride_id = v_share.ride_id
      and l.expires_at > now()
      and l.server_updated_at > now() - interval '2 minutes'
      and r.status not in ('Completed', 'Cancelled', 'Expired')
      and (l.user_id = v_share.owner_id or l.user_role = 'Driver');
end;
$$;

-- Return one privacy-safe family payload even when no point is currently
-- available. The Edge Function can now distinguish a valid waiting/scheduled
-- share from an invalid, revoked, expired or terminal one without exposing an
-- account UUID.
create or replace function public.get_m2_family_location_snapshot(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_share_id uuid;
  v_ride_id uuid;
  v_owner_id uuid;
  v_ride_status text;
  v_departure_at timestamptz;
  v_locations jsonb := '[]'::jsonb;
begin
  if nullif(btrim(p_token), '') is null
     or length(p_token) < 40
     or length(p_token) > 100 then
    return jsonb_build_object('status', 'invalid');
  end if;

  select s.id, s.ride_id, s.owner_id, r.status, r.departure_at
  into v_share_id, v_ride_id, v_owner_id, v_ride_status, v_departure_at
  from private.m2_family_location_shares s
  join public.rides r on r.id = s.ride_id
  where s.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and s.revoked_at is null
    and s.expires_at > now();

  if v_share_id is null
     or v_ride_status in ('Completed', 'Cancelled', 'Expired') then
    return jsonb_build_object('status', 'invalid');
  end if;

  if now() < v_departure_at - interval '1 hour' then
    return jsonb_build_object('status', 'scheduled', 'locations', '[]'::jsonb);
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'markerId', case when l.user_role = 'Driver' then 'driver' else 'shared-passenger' end,
        'role', l.user_role,
        'lat', l.latitude,
        'lng', l.longitude,
        'accuracyM', l.accuracy_meters,
        'headingDeg', l.heading_degrees,
        'speedMps', l.speed_mps,
        'capturedAt', l.captured_at,
        'serverUpdatedAt', l.server_updated_at,
        'expiresAt', l.expires_at
      )
      order by case when l.user_role = 'Driver' then 0 else 1 end
    ),
    '[]'::jsonb
  )
  into v_locations
  from private.m2_live_locations l
  where l.ride_id = v_ride_id
    and l.expires_at > now()
    and l.server_updated_at > now() - interval '2 minutes'
    and (l.user_id = v_owner_id or l.user_role = 'Driver');

  return jsonb_build_object(
    'status', case when jsonb_array_length(v_locations) > 0 then 'active' else 'waiting' end,
    'locations', v_locations
  );
end;
$$;

create or replace function public.consume_m2_family_map_load(
  p_token text,
  p_page_session_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_count integer;
begin
  if p_page_session_id is null or nullif(btrim(p_token), '') is null then
    return false;
  end if;
  if not exists (
    select 1
    from private.m2_family_location_shares s
    join public.rides r on r.id = s.ride_id
    where s.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
      and s.revoked_at is null
      and s.expires_at > now()
      and r.status not in ('Completed', 'Cancelled', 'Expired')
  ) then
    return false;
  end if;
  insert into private.m2_dynamic_map_daily_usage (usage_date, page_session_id)
  values (v_day, p_page_session_id)
  on conflict do nothing;
  select count(*) into v_count
  from private.m2_dynamic_map_daily_usage
  where usage_date = v_day;
  return v_count <= 250;
end;
$$;

-- A terminal Ride invalidates every family link immediately. A reschedule
-- keeps active links aligned with the latest planned departure.
create or replace function private.stop_m2_live_on_terminal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('Completed', 'Cancelled', 'Expired')
     and old.status is distinct from new.status then
    update private.m2_location_sessions
    set stopped_at = coalesce(stopped_at, now())
    where ride_id = new.id;
    delete from private.m2_live_locations where ride_id = new.id;
    update private.m2_family_location_shares
    set revoked_at = coalesce(revoked_at, now())
    where ride_id = new.id and revoked_at is null;
  end if;
  return new;
end;
$$;

create or replace function private.sync_m2_family_share_expiry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.departure_at is distinct from old.departure_at then
    update private.m2_family_location_shares
    set expires_at = new.departure_at + interval '24 hours'
    where ride_id = new.id and revoked_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_m2_family_share_expiry on public.rides;
create trigger sync_m2_family_share_expiry
after update of departure_at on public.rides
for each row execute function private.sync_m2_family_share_expiry();

-- Hidden history keeps its existing 180-day policy. With disputes removed,
-- there is no evidence hold that can pause that purge.
create or replace function private.cleanup_m2_location_data()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from private.m2_live_locations where expires_at <= now();
  get diagnostics v_count = row_count;

  delete from private.m2_location_history h
  using private.m2_location_sessions s
  where h.session_id = s.id
    and s.purge_after is not null
    and s.purge_after <= now();

  delete from private.m2_location_sessions s
  where s.purge_after is not null
    and s.purge_after <= now();

  delete from private.m2_family_location_shares
  where expires_at <= now() or revoked_at is not null;

  delete from private.m2_dynamic_map_daily_usage
  where usage_date < (now() at time zone 'Asia/Kuala_Lumpur')::date - 7;

  return coalesce(v_count, 0);
end;
$$;

drop table if exists private.m2_dispute_admin_audit;
drop table if exists private.m2_dispute_evidence_access_log;
drop table if exists private.m2_ride_disputes;
drop table if exists private.project_role_audit;
drop table if exists private.project_user_roles;
drop table if exists private.m2_location_evidence_holds;

revoke all on function public.get_m2_live_locations(uuid) from public, anon;
grant execute on function public.get_m2_live_locations(uuid) to authenticated;
revoke all on function public.get_m2_family_location_by_token(text)
  from public, anon, authenticated;
grant execute on function public.get_m2_family_location_by_token(text)
  to service_role;
revoke all on function public.get_m2_family_location_snapshot(text)
  from public, anon, authenticated;
grant execute on function public.get_m2_family_location_snapshot(text)
  to service_role;
revoke all on function public.consume_m2_family_map_load(text, uuid)
  from public, anon, authenticated;
grant execute on function public.consume_m2_family_map_load(text, uuid)
  to service_role;
revoke all on function private.cleanup_m2_location_data()
  from public, anon, authenticated;
revoke all on function private.stop_m2_live_on_terminal()
  from public, anon, authenticated;
revoke all on function private.sync_m2_family_share_expiry()
  from public, anon, authenticated;
