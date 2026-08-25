-- Module 2 live location sharing, family links and post-trip history.
-- Raw location data stays outside the exposed public schema.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create extension if not exists pgcrypto;

create table if not exists private.m2_location_sessions (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  user_role text not null check (user_role in ('Driver', 'Passenger')),
  consent_version text not null check (length(btrim(consent_version)) between 1 and 80),
  consented_at timestamptz not null default now(),
  started_at timestamptz not null default now(),
  stopped_at timestamptz,
  history_hidden_by_owner_at timestamptz,
  purge_after timestamptz,
  created_at timestamptz not null default now(),
  check (stopped_at is null or stopped_at >= started_at),
  check (purge_after is null or history_hidden_by_owner_at is not null)
);
create unique index if not exists m2_location_sessions_active_idx
  on private.m2_location_sessions (ride_id, user_id) where stopped_at is null;
create index if not exists m2_location_sessions_ride_idx
  on private.m2_location_sessions (ride_id, user_id, started_at desc);

create table if not exists private.m2_live_locations (
  ride_id uuid not null references public.rides(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid not null references private.m2_location_sessions(id) on delete cascade,
  user_role text not null check (user_role in ('Driver', 'Passenger')),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_meters double precision not null check (accuracy_meters between 0 and 5000),
  heading_degrees double precision check (heading_degrees is null or heading_degrees between 0 and 360),
  speed_mps double precision check (speed_mps is null or speed_mps between 0 and 100),
  captured_at timestamptz not null,
  server_updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (ride_id, user_id)
);
create index if not exists m2_live_locations_expiry_idx on private.m2_live_locations (expires_at);

create table if not exists private.m2_location_history (
  id bigint generated always as identity primary key,
  ride_id uuid not null references public.rides(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid not null references private.m2_location_sessions(id) on delete cascade,
  user_role text not null check (user_role in ('Driver', 'Passenger')),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_meters double precision not null check (accuracy_meters between 0 and 5000),
  heading_degrees double precision check (heading_degrees is null or heading_degrees between 0 and 360),
  speed_mps double precision check (speed_mps is null or speed_mps between 0 and 100),
  captured_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists m2_location_history_ride_time_idx
  on private.m2_location_history (ride_id, captured_at, id);
create index if not exists m2_location_history_user_idx
  on private.m2_location_history (ride_id, user_id, captured_at, id);

create table if not exists private.m2_family_location_shares (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null unique check (length(token_hash) = 64),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index if not exists m2_family_location_shares_lookup_idx
  on private.m2_family_location_shares (ride_id, owner_id, expires_at) where revoked_at is null;

create table if not exists private.m2_dynamic_map_daily_usage (
  usage_date date not null,
  page_session_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (usage_date, page_session_id)
);

create table if not exists private.m2_location_evidence_holds (
  ride_id uuid primary key references public.rides(id) on delete cascade,
  active_until timestamptz not null,
  created_at timestamptz not null default now()
);

alter table private.m2_location_sessions enable row level security;
alter table private.m2_live_locations enable row level security;
alter table private.m2_location_history enable row level security;
alter table private.m2_family_location_shares enable row level security;
alter table private.m2_dynamic_map_daily_usage enable row level security;
alter table private.m2_location_evidence_holds enable row level security;
revoke all on all tables in schema private from public, anon, authenticated;

create or replace function private.m2_participant_role(p_ride_id uuid, p_user_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.rides r where r.id = p_ride_id and r.host_id = p_user_id) then return 'Driver'; end if;
  if exists (select 1 from public.ride_requests rr where rr.ride_id = p_ride_id and rr.requester_id = p_user_id and rr.status = 'Accepted') then return 'Passenger'; end if;
  return null;
end;
$$;
revoke all on function private.m2_participant_role(uuid, uuid) from public, anon, authenticated;

create or replace function public.start_m2_location_sharing(p_ride_id uuid, p_consent_version text default 'm2-live-v1')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid(); v_role text; v_ride public.rides%rowtype; v_session_id uuid; v_recipient uuid;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if nullif(btrim(p_consent_version), '') is null then raise exception 'Tracking consent version is required'; end if;
  v_role := private.m2_participant_role(p_ride_id, v_user_id);
  if v_role is null then raise exception 'Only ride participants can share live location'; end if;
  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found or v_ride.status not in ('Published', 'Matched', 'In Transit') then raise exception 'Location sharing is unavailable for this Ride'; end if;
  if now() < v_ride.departure_at - interval '1 hour' then raise exception 'Location sharing opens 1 hour before departure'; end if;
  select id into v_session_id from private.m2_location_sessions where ride_id = p_ride_id and user_id = v_user_id and stopped_at is null order by started_at desc limit 1;
  if v_session_id is not null then return v_session_id; end if;
  insert into private.m2_location_sessions (ride_id, user_id, user_role, consent_version) values (p_ride_id, v_user_id, v_role, btrim(p_consent_version)) returning id into v_session_id;
  if v_role = 'Driver' then
    for v_recipient in select rr.requester_id from public.ride_requests rr where rr.ride_id = p_ride_id and rr.status = 'Accepted' loop
      perform private.create_user_notification(v_recipient, 'm2', 'driver_live_location_started', 'Driver location is available', 'Your Driver has started sharing live location for this trip.', '/ride/' || p_ride_id::text || '?view=trip', jsonb_build_object('ride_id', p_ride_id), 'm2:live:driver:' || p_ride_id::text || ':' || v_session_id::text);
    end loop;
  else
    select r.host_id into v_recipient from public.rides r where r.id = p_ride_id;
    perform private.create_user_notification(v_recipient, 'm2', 'passenger_live_location_started', 'Passenger location is available', 'An accepted passenger has started sharing live location for this trip.', '/ride/' || p_ride_id::text || '?view=trip', jsonb_build_object('ride_id', p_ride_id), 'm2:live:passenger:' || p_ride_id::text || ':' || v_session_id::text);
  end if;
  return v_session_id;
end;
$$;

create or replace function public.publish_m2_live_location(
  p_ride_id uuid, p_latitude double precision, p_longitude double precision, p_accuracy_meters double precision,
  p_heading_degrees double precision default null, p_speed_mps double precision default null, p_captured_at timestamptz default now()
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid(); v_role text; v_session private.m2_location_sessions%rowtype; v_last private.m2_live_locations%rowtype; v_last_history private.m2_location_history%rowtype; v_now timestamptz := now(); v_sample boolean;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_latitude is null or p_longitude is null or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then raise exception 'Location coordinates are invalid'; end if;
  if p_accuracy_meters is null or p_accuracy_meters < 0 or p_accuracy_meters > 5000 then raise exception 'Location accuracy is invalid'; end if;
  if p_captured_at < v_now - interval '5 minutes' or p_captured_at > v_now + interval '2 minutes' then raise exception 'Location timestamp is stale'; end if;
  v_role := private.m2_participant_role(p_ride_id, v_user_id);
  if v_role is null then raise exception 'Only ride participants can publish live location'; end if;
  select * into v_session from private.m2_location_sessions where ride_id = p_ride_id and user_id = v_user_id and stopped_at is null order by started_at desc limit 1 for update;
  if v_session.id is null then raise exception 'Start location sharing before publishing a point'; end if;
  select * into v_last from private.m2_live_locations where ride_id = p_ride_id and user_id = v_user_id for update;
  if v_last.server_updated_at is not null and v_now < v_last.server_updated_at + interval '5 seconds' then return jsonb_build_object('accepted', false, 'reason', 'THROTTLED'); end if;
  if v_last.captured_at is not null and p_captured_at <= v_last.captured_at then return jsonb_build_object('accepted', false, 'reason', 'OUT_OF_ORDER'); end if;
  select * into v_last_history from private.m2_location_history where session_id = v_session.id order by captured_at desc, id desc limit 1;
  v_sample := v_last_history.id is null or p_captured_at >= v_last_history.captured_at + interval '30 seconds' or private.m2_distance_metres(p_latitude, p_longitude, v_last_history.latitude, v_last_history.longitude) >= 25;
  insert into private.m2_live_locations (ride_id, user_id, session_id, user_role, latitude, longitude, accuracy_meters, heading_degrees, speed_mps, captured_at, server_updated_at, expires_at)
  values (p_ride_id, v_user_id, v_session.id, v_role, p_latitude, p_longitude, p_accuracy_meters, p_heading_degrees, p_speed_mps, p_captured_at, v_now, v_now + interval '5 minutes')
  on conflict (ride_id, user_id) do update set session_id = excluded.session_id, user_role = excluded.user_role, latitude = excluded.latitude, longitude = excluded.longitude, accuracy_meters = excluded.accuracy_meters, heading_degrees = excluded.heading_degrees, speed_mps = excluded.speed_mps, captured_at = excluded.captured_at, server_updated_at = excluded.server_updated_at, expires_at = excluded.expires_at;
  if v_sample then
    insert into private.m2_location_history (ride_id, user_id, session_id, user_role, latitude, longitude, accuracy_meters, heading_degrees, speed_mps, captured_at)
    values (p_ride_id, v_user_id, v_session.id, v_role, p_latitude, p_longitude, p_accuracy_meters, p_heading_degrees, p_speed_mps, p_captured_at);
  end if;
  return jsonb_build_object('accepted', true, 'sampled', v_sample, 'serverUpdatedAt', v_now);
end;
$$;

create or replace function public.stop_m2_location_sharing(p_ride_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid := auth.uid(); v_changed integer;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if private.m2_participant_role(p_ride_id, v_user_id) is null then raise exception 'Ride participant required'; end if;
  update private.m2_location_sessions set stopped_at = now() where ride_id = p_ride_id and user_id = v_user_id and stopped_at is null;
  get diagnostics v_changed = row_count;
  delete from private.m2_live_locations where ride_id = p_ride_id and user_id = v_user_id;
  return v_changed > 0;
end;
$$;

create or replace function public.get_m2_live_locations(p_ride_id uuid)
returns table (user_id uuid, user_role text, latitude double precision, longitude double precision, accuracy_meters double precision, heading_degrees double precision, speed_mps double precision, captured_at timestamptz, server_updated_at timestamptz, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid := auth.uid(); v_role text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  v_role := private.m2_participant_role(p_ride_id, v_user_id);
  if v_role is null then raise exception 'Ride participant required'; end if;
  return query select l.user_id, l.user_role, l.latitude, l.longitude, l.accuracy_meters, l.heading_degrees, l.speed_mps, l.captured_at, l.server_updated_at, l.expires_at from private.m2_live_locations l where l.ride_id = p_ride_id and l.expires_at > now() and (v_role = 'Driver' or l.user_id = v_user_id or l.user_role = 'Driver');
end;
$$;

create or replace function public.get_m2_location_history(p_ride_id uuid, p_after timestamptz default null, p_limit integer default 2000)
returns table (id bigint, user_id uuid, user_role text, latitude double precision, longitude double precision, accuracy_meters double precision, heading_degrees double precision, speed_mps double precision, captured_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid := auth.uid(); v_status text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if private.m2_participant_role(p_ride_id, v_user_id) is null then raise exception 'Ride participant required'; end if;
  select r.status into v_status from public.rides r where r.id = p_ride_id;
  if v_status not in ('Completed', 'Cancelled') then raise exception 'History is available after the Ride ends'; end if;
  return query select h.id, h.user_id, h.user_role, h.latitude, h.longitude, h.accuracy_meters, h.heading_degrees, h.speed_mps, h.captured_at from private.m2_location_history h join private.m2_location_sessions s on s.id = h.session_id where h.ride_id = p_ride_id and (p_after is null or h.captured_at > p_after) and not (h.user_id = v_user_id and s.history_hidden_by_owner_at is not null) order by h.captured_at asc, h.id asc limit greatest(1, least(coalesce(p_limit, 2000), 2000));
end;
$$;

create or replace function public.hide_m2_location_history(p_ride_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid := auth.uid(); v_count integer;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if private.m2_participant_role(p_ride_id, v_user_id) is null then raise exception 'Ride participant required'; end if;
  update private.m2_location_sessions set history_hidden_by_owner_at = coalesce(history_hidden_by_owner_at, now()), purge_after = coalesce(purge_after, now() + interval '180 days') where ride_id = p_ride_id and user_id = v_user_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.create_m2_family_location_share(p_ride_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid := auth.uid(); v_status text; v_departure timestamptz; v_raw text; v_id uuid; v_expires timestamptz;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if private.m2_participant_role(p_ride_id, v_user_id) <> 'Passenger' then raise exception 'Only an accepted passenger can create a family link'; end if;
  select r.status, r.departure_at into v_status, v_departure from public.rides r where r.id = p_ride_id;
  if v_status in ('Completed', 'Cancelled', 'Expired') then raise exception 'This Ride no longer accepts family links'; end if;
  v_expires := v_departure + interval '24 hours';
  v_raw := replace(replace(replace(encode(gen_random_bytes(32), 'base64'), '+', '-'), '/', '_'), '=', '');
  insert into private.m2_family_location_shares (ride_id, owner_id, token_hash, expires_at) values (p_ride_id, v_user_id, encode(digest(v_raw, 'sha256'), 'hex'), v_expires) returning id into v_id;
  return jsonb_build_object('shareId', v_id, 'token', v_raw, 'expiresAt', v_expires);
end;
$$;

create or replace function public.revoke_m2_family_location_share(p_share_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid := auth.uid(); v_changed integer;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  update private.m2_family_location_shares set revoked_at = coalesce(revoked_at, now()) where id = p_share_id and owner_id = v_user_id and revoked_at is null;
  get diagnostics v_changed = row_count;
  return v_changed > 0;
end;
$$;

create or replace function public.consume_m2_dynamic_map_load(p_page_session_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_day date := (now() at time zone 'Asia/Kuala_Lumpur')::date; v_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_page_session_id is null then raise exception 'Page session is required'; end if;
  insert into private.m2_dynamic_map_daily_usage (usage_date, page_session_id) values (v_day, p_page_session_id) on conflict do nothing;
  select count(*) into v_count from private.m2_dynamic_map_daily_usage where usage_date = v_day;
  return v_count <= 250;
end;
$$;

create or replace function public.get_m2_family_location_by_token(p_token text)
returns table (ride_id uuid, owner_id uuid, user_id uuid, user_role text, latitude double precision, longitude double precision, accuracy_meters double precision, heading_degrees double precision, speed_mps double precision, captured_at timestamptz, server_updated_at timestamptz, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_share private.m2_family_location_shares%rowtype;
begin
  if nullif(btrim(p_token), '') is null or length(p_token) < 40 then return; end if;
  select * into v_share from private.m2_family_location_shares s where s.token_hash = encode(digest(p_token, 'sha256'), 'hex') and s.revoked_at is null and s.expires_at > now();
  if v_share.id is null then return; end if;
  return query select l.ride_id, v_share.owner_id, l.user_id, l.user_role, l.latitude, l.longitude, l.accuracy_meters, l.heading_degrees, l.speed_mps, l.captured_at, l.server_updated_at, l.expires_at
    from private.m2_live_locations l join public.rides r on r.id = l.ride_id
    where l.ride_id = v_share.ride_id and l.expires_at > now() and r.status not in ('Completed', 'Cancelled', 'Expired') and (l.user_id = v_share.owner_id or l.user_role = 'Driver');
end;
$$;

create or replace function public.consume_m2_family_map_load(p_token text, p_page_session_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_day date := (now() at time zone 'Asia/Kuala_Lumpur')::date; v_count integer;
begin
  if p_page_session_id is null or nullif(btrim(p_token), '') is null then return false; end if;
  if not exists (select 1 from private.m2_family_location_shares s where s.token_hash = encode(digest(p_token, 'sha256'), 'hex') and s.revoked_at is null and s.expires_at > now()) then return false; end if;
  insert into private.m2_dynamic_map_daily_usage (usage_date, page_session_id) values (v_day, p_page_session_id) on conflict do nothing;
  select count(*) into v_count from private.m2_dynamic_map_daily_usage where usage_date = v_day;
  return v_count <= 250;
end;
$$;

create or replace function private.broadcast_m2_live_location()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.user_role = 'Driver' then
    perform realtime.broadcast_changes('m2-live:' || new.ride_id::text || ':driver', 'LOCATION', TG_OP, TG_TABLE_NAME, TG_TABLE_SCHEMA, new, old);
  end if;
  perform realtime.broadcast_changes('m2-live:' || new.ride_id::text || ':host', 'LOCATION', TG_OP, TG_TABLE_NAME, TG_TABLE_SCHEMA, new, old);
  return new;
end;
$$;
drop trigger if exists broadcast_m2_live_location on private.m2_live_locations;
create trigger broadcast_m2_live_location after insert or update on private.m2_live_locations for each row execute function private.broadcast_m2_live_location();

create or replace function private.stop_m2_live_on_terminal()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('Completed', 'Cancelled', 'Expired') and old.status is distinct from new.status then
    update private.m2_location_sessions set stopped_at = coalesce(stopped_at, now()) where ride_id = new.id;
    delete from private.m2_live_locations where ride_id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists stop_m2_live_on_terminal on public.rides;
create trigger stop_m2_live_on_terminal after update of status on public.rides for each row execute function private.stop_m2_live_on_terminal();

create or replace function private.cleanup_m2_location_data()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  delete from private.m2_live_locations where expires_at <= now();
  get diagnostics v_count = row_count;
  delete from private.m2_location_history h using private.m2_location_sessions s where h.session_id = s.id and s.purge_after is not null and s.purge_after <= now() and not exists (select 1 from private.m2_location_evidence_holds e where e.ride_id = h.ride_id and e.active_until > now());
  delete from private.m2_location_sessions s where s.purge_after is not null and s.purge_after <= now() and not exists (select 1 from private.m2_location_evidence_holds e where e.ride_id = s.ride_id and e.active_until > now());
  delete from private.m2_family_location_shares where expires_at <= now() or revoked_at is not null;
  delete from private.m2_dynamic_map_daily_usage where usage_date < (now() at time zone 'Asia/Kuala_Lumpur')::date - 7;
  return coalesce(v_count, 0);
end;
$$;

do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('m2-live-location-cleanup', '*/5 * * * *', 'select private.cleanup_m2_location_data()');
  end if;
exception when unique_violation then null;
end $$;

drop policy if exists m2_live_driver_read on realtime.messages;
create policy m2_live_driver_read on realtime.messages for select to authenticated using (
  realtime.topic() ~ '^m2-live:[0-9a-f-]{36}:driver$' and exists (
    select 1 from public.rides r where r.id = substring(realtime.topic() from '^m2-live:([0-9a-f-]{36}):driver$')::uuid and (r.host_id = auth.uid() or exists (select 1 from public.ride_requests rr where rr.ride_id = r.id and rr.requester_id = auth.uid() and rr.status = 'Accepted'))
  )
);
drop policy if exists m2_live_host_read on realtime.messages;
create policy m2_live_host_read on realtime.messages for select to authenticated using (
  realtime.topic() ~ '^m2-live:[0-9a-f-]{36}:host$' and exists (
    select 1 from public.rides r where r.id = substring(realtime.topic() from '^m2-live:([0-9a-f-]{36}):host$')::uuid and r.host_id = auth.uid()
  )
);

revoke all on function public.start_m2_location_sharing(uuid, text) from public, anon;
revoke all on function public.publish_m2_live_location(uuid, double precision, double precision, double precision, double precision, double precision, timestamptz) from public, anon;
revoke all on function public.stop_m2_location_sharing(uuid) from public, anon;
revoke all on function public.get_m2_live_locations(uuid) from public, anon;
revoke all on function public.get_m2_location_history(uuid, timestamptz, integer) from public, anon;
revoke all on function public.hide_m2_location_history(uuid) from public, anon;
revoke all on function public.create_m2_family_location_share(uuid) from public, anon;
revoke all on function public.revoke_m2_family_location_share(uuid) from public, anon;
revoke all on function public.consume_m2_dynamic_map_load(uuid) from public, anon;
revoke all on function public.get_m2_family_location_by_token(text) from public, anon, authenticated;
revoke all on function public.consume_m2_family_map_load(text, uuid) from public, anon, authenticated;
grant execute on function public.start_m2_location_sharing(uuid, text) to authenticated;
grant execute on function public.publish_m2_live_location(uuid, double precision, double precision, double precision, double precision, double precision, timestamptz) to authenticated;
grant execute on function public.stop_m2_location_sharing(uuid) to authenticated;
grant execute on function public.get_m2_live_locations(uuid) to authenticated;
grant execute on function public.get_m2_location_history(uuid, timestamptz, integer) to authenticated;
grant execute on function public.hide_m2_location_history(uuid) to authenticated;
grant execute on function public.create_m2_family_location_share(uuid) to authenticated;
grant execute on function public.revoke_m2_family_location_share(uuid) to authenticated;
grant execute on function public.consume_m2_dynamic_map_load(uuid) to authenticated;
grant execute on function public.get_m2_family_location_by_token(text) to service_role;
grant execute on function public.consume_m2_family_map_load(text, uuid) to service_role;
revoke all on function private.broadcast_m2_live_location() from public, anon, authenticated;
revoke all on function private.stop_m2_live_on_terminal() from public, anon, authenticated;
revoke all on function private.cleanup_m2_location_data() from public, anon, authenticated;
