-- Module 2 trusted family relationships and PWA SOS events.
-- Trusted users can read a privacy-safe snapshot only while an SOS is active,
-- or its coordinate-free resolved shell during the 24-hour deep-link window.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.m2_trusted_family_invites (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null unique check (length(token_hash) = 64),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  claimed_by uuid references public.profiles(id) on delete set null,
  claimed_at timestamptz,
  revoked_at timestamptz,
  check (expires_at > created_at),
  check ((claimed_by is null and claimed_at is null) or (claimed_by is not null and claimed_at is not null))
);

create table if not exists private.m2_trusted_family_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  trusted_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  check (owner_id <> trusted_user_id)
);

create unique index if not exists m2_trusted_family_links_active_pair_idx
  on private.m2_trusted_family_links (owner_id, trusted_user_id)
  where revoked_at is null;
create index if not exists m2_trusted_family_links_owner_idx
  on private.m2_trusted_family_links (owner_id, created_at desc)
  where revoked_at is null;
create index if not exists m2_trusted_family_links_trusted_idx
  on private.m2_trusted_family_links (trusted_user_id, owner_id)
  where revoked_at is null;

create table if not exists private.m2_sos_events (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  actor_role text not null check (actor_role in ('Driver', 'Passenger')),
  status text not null default 'active' check (status in ('active', 'resolved')),
  location_state text not null default 'waiting' check (location_state in ('waiting', 'live', 'lost', 'unavailable')),
  activated_at timestamptz not null default now(),
  last_point_at timestamptz,
  signal_lost_at timestamptz,
  resolved_at timestamptz,
  resolution_reason text,
  cleanup_after timestamptz,
  check ((status = 'active' and resolved_at is null and cleanup_after is null)
      or (status = 'resolved' and resolved_at is not null and cleanup_after is not null))
);

create unique index if not exists m2_sos_events_one_active_idx
  on private.m2_sos_events (ride_id, actor_id)
  where status = 'active';
create index if not exists m2_sos_events_monitor_idx
  on private.m2_sos_events (status, last_point_at, activated_at)
  where status = 'active';
create index if not exists m2_sos_events_cleanup_idx
  on private.m2_sos_events (cleanup_after)
  where cleanup_after is not null;

alter table private.m2_trusted_family_invites enable row level security;
alter table private.m2_trusted_family_links enable row level security;
alter table private.m2_sos_events enable row level security;
revoke all on table private.m2_trusted_family_invites from public, anon, authenticated;
revoke all on table private.m2_trusted_family_links from public, anon, authenticated;
revoke all on table private.m2_sos_events from public, anon, authenticated;

create or replace function private.m2_sos_recipient_counts(p_owner_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'trustedFamilyCount', count(distinct l.trusted_user_id),
    'pushReadyCount', count(distinct l.trusted_user_id) filter (
      where exists (
        select 1 from public.web_push_subscriptions s
        where s.user_id = l.trusted_user_id
          and (s.expiration_time is null or s.expiration_time > now())
      )
    )
  )
  from private.m2_trusted_family_links l
  where l.owner_id = p_owner_id and l.revoked_at is null;
$$;

create or replace function private.notify_m2_sos_family(
  p_event_id uuid,
  p_event_type text,
  p_title text,
  p_body text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event private.m2_sos_events%rowtype;
  v_recipient uuid;
  v_count integer := 0;
begin
  select * into v_event from private.m2_sos_events where id = p_event_id;
  if v_event.id is null then return 0; end if;

  for v_recipient in
    select distinct l.trusted_user_id
    from private.m2_trusted_family_links l
    where l.owner_id = v_event.actor_id and l.revoked_at is null
  loop
    perform private.create_user_notification(
      v_recipient,
      'm2',
      p_event_type,
      p_title,
      p_body,
      '/sos/' || p_event_id::text,
      jsonb_build_object('eventId', p_event_id),
      'm2:sos:' || p_event_type || ':' || p_event_id::text
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.create_m2_trusted_family_invite()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_raw text;
  v_id uuid;
  v_expires timestamptz := now() + interval '24 hours';
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  v_raw := replace(replace(replace(
    encode(extensions.gen_random_bytes(32), 'base64'), '+', '-'), '/', '_'), '=', '');
  insert into private.m2_trusted_family_invites (owner_id, token_hash, expires_at)
  values (v_user_id, encode(extensions.digest(v_raw, 'sha256'), 'hex'), v_expires)
  returning id into v_id;
  return jsonb_build_object('inviteId', v_id, 'token', v_raw, 'expiresAt', v_expires);
end;
$$;

create or replace function public.accept_m2_trusted_family_invite(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_invite private.m2_trusted_family_invites%rowtype;
  v_link_id uuid;
  v_owner_name text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if nullif(btrim(p_token), '') is null or length(p_token) < 40 or length(p_token) > 100 then
    raise exception 'This trusted family invitation is invalid';
  end if;

  select * into v_invite
  from private.m2_trusted_family_invites i
  where i.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  for update;

  if v_invite.id is null or v_invite.revoked_at is not null
     or v_invite.claimed_at is not null or v_invite.expires_at <= now() then
    raise exception 'This trusted family invitation is invalid, expired, or already used';
  end if;
  if v_invite.owner_id = v_user_id then
    raise exception 'You cannot accept your own trusted family invitation';
  end if;

  insert into private.m2_trusted_family_links (owner_id, trusted_user_id)
  values (v_invite.owner_id, v_user_id)
  on conflict (owner_id, trusted_user_id) where revoked_at is null do update
    set revoked_at = null
  returning id into v_link_id;

  update private.m2_trusted_family_invites
  set claimed_by = v_user_id, claimed_at = now()
  where id = v_invite.id;

  select coalesce(nullif(btrim(p.full_name), ''), 'Your family member') into v_owner_name
  from public.profiles p where p.id = v_invite.owner_id;

  return jsonb_build_object(
    'relationshipId', v_link_id,
    'ownerName', coalesce(v_owner_name, 'Your family member'),
    'acceptedAt', now()
  );
end;
$$;

create or replace function public.list_m2_trusted_family()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_items jsonb;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'relationshipId', l.id,
    'name', coalesce(nullif(btrim(p.full_name), ''), 'Trusted family member'),
    'profilePhotoUrl', p.profile_photo_url,
    'pushReady', exists (
      select 1 from public.web_push_subscriptions s
      where s.user_id = l.trusted_user_id
        and (s.expiration_time is null or s.expiration_time > now())
    ),
    'createdAt', l.created_at
  ) order by l.created_at desc), '[]'::jsonb)
  into v_items
  from private.m2_trusted_family_links l
  join public.profiles p on p.id = l.trusted_user_id
  where l.owner_id = v_user_id and l.revoked_at is null;
  return v_items;
end;
$$;

create or replace function public.revoke_m2_trusted_family(p_relationship_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_changed integer;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  update private.m2_trusted_family_links
  set revoked_at = now()
  where id = p_relationship_id and owner_id = v_user_id and revoked_at is null;
  get diagnostics v_changed = row_count;
  return v_changed > 0;
end;
$$;

create or replace function public.activate_m2_sos(p_ride_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_ride public.rides%rowtype;
  v_event private.m2_sos_events%rowtype;
  v_counts jsonb;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  v_role := private.m2_participant_role(p_ride_id, v_user_id);
  if v_role is null then raise exception 'Only the Driver or an accepted passenger can activate SOS'; end if;
  select * into v_ride from public.rides where id = p_ride_id for update;
  if v_ride.id is null or v_ride.status not in ('Published', 'Matched', 'In Transit') then
    raise exception 'SOS is unavailable for this Ride';
  end if;
  if now() < v_ride.departure_at - interval '1 hour' then
    raise exception 'SOS opens 1 hour before departure';
  end if;

  select * into v_event from private.m2_sos_events
  where ride_id = p_ride_id and actor_id = v_user_id and status = 'active'
  for update;
  if v_event.id is null then
    insert into private.m2_sos_events (ride_id, actor_id, actor_role)
    values (p_ride_id, v_user_id, v_role)
    returning * into v_event;
    perform private.notify_m2_sos_family(
      v_event.id, 'sos_activated', 'SOS alert from your trusted family',
      'Open Let''s Tumpang to see the latest available SOS location status.'
    );
  end if;
  v_counts := private.m2_sos_recipient_counts(v_user_id);
  return jsonb_build_object(
    'eventId', v_event.id,
    'rideId', v_event.ride_id,
    'status', v_event.status,
    'locationState', v_event.location_state,
    'activatedAt', v_event.activated_at,
    'lastPointAt', v_event.last_point_at,
    'trustedFamilyCount', coalesce((v_counts->>'trustedFamilyCount')::integer, 0),
    'pushReadyCount', coalesce((v_counts->>'pushReadyCount')::integer, 0)
  );
end;
$$;

create or replace function public.get_active_m2_sos(p_ride_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_event private.m2_sos_events%rowtype;
  v_counts jsonb;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if private.m2_participant_role(p_ride_id, v_user_id) is null then
    raise exception 'Ride participant required';
  end if;
  select * into v_event from private.m2_sos_events
  where ride_id = p_ride_id and actor_id = v_user_id and status = 'active'
  order by activated_at desc limit 1;
  if v_event.id is null then return null; end if;
  v_counts := private.m2_sos_recipient_counts(v_user_id);
  return jsonb_build_object(
    'eventId', v_event.id,
    'rideId', v_event.ride_id,
    'status', v_event.status,
    'locationState', v_event.location_state,
    'activatedAt', v_event.activated_at,
    'lastPointAt', v_event.last_point_at,
    'signalLostAt', v_event.signal_lost_at,
    'trustedFamilyCount', coalesce((v_counts->>'trustedFamilyCount')::integer, 0),
    'pushReadyCount', coalesce((v_counts->>'pushReadyCount')::integer, 0)
  );
end;
$$;

create or replace function public.resolve_m2_sos(p_event_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_event private.m2_sos_events%rowtype;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select * into v_event from private.m2_sos_events
  where id = p_event_id and actor_id = v_user_id and status = 'active'
  for update;
  if v_event.id is null then return false; end if;
  update private.m2_sos_events
  set status = 'resolved', resolved_at = now(), resolution_reason = 'safe',
      cleanup_after = now() + interval '24 hours', location_state = 'unavailable'
  where id = p_event_id;
  perform private.notify_m2_sos_family(
    p_event_id, 'sos_resolved', 'SOS resolved',
    'Your trusted family member marked themselves safe. Location access has ended.'
  );
  update private.m2_location_sessions set stopped_at = coalesce(stopped_at, now())
  where ride_id = v_event.ride_id and user_id = v_event.actor_id and stopped_at is null;
  delete from private.m2_live_locations
  where ride_id = v_event.ride_id and user_id = v_event.actor_id;
  return true;
end;
$$;

create or replace function public.get_m2_sos_family_snapshot(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_event private.m2_sos_events%rowtype;
  v_authorized boolean := false;
  v_name text;
  v_location jsonb := null;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select * into v_event from private.m2_sos_events where id = p_event_id;
  if v_event.id is null or (v_event.status = 'resolved' and v_event.cleanup_after <= now()) then
    raise exception 'This SOS event is unavailable';
  end if;
  v_authorized := v_event.actor_id = v_user_id or exists (
    select 1 from private.m2_trusted_family_links l
    where l.owner_id = v_event.actor_id and l.trusted_user_id = v_user_id and l.revoked_at is null
  );
  if not v_authorized then raise exception 'Trusted family access required'; end if;
  select coalesce(nullif(btrim(p.full_name), ''), 'Your trusted family member') into v_name
  from public.profiles p where p.id = v_event.actor_id;

  if v_event.status = 'active' then
    select jsonb_build_object(
      'lat', l.latitude, 'lng', l.longitude, 'accuracyM', l.accuracy_meters,
      'capturedAt', l.captured_at, 'serverUpdatedAt', l.server_updated_at
    ) into v_location
    from private.m2_live_locations l
    where l.ride_id = v_event.ride_id and l.user_id = v_event.actor_id
    order by l.server_updated_at desc limit 1;
  end if;
  return jsonb_build_object(
    'eventId', v_event.id,
    'status', v_event.status,
    'locationState', case when v_event.status = 'resolved' then 'unavailable' else v_event.location_state end,
    'personName', coalesce(v_name, 'Your trusted family member'),
    'activatedAt', v_event.activated_at,
    'lastPointAt', v_event.last_point_at,
    'signalLostAt', v_event.signal_lost_at,
    'resolvedAt', v_event.resolved_at,
    'location', v_location
  );
end;
$$;

-- Preserve the existing live-tracking contract while coupling accepted points
-- to the caller's active SOS and emitting one restored notification per loss.
create or replace function public.publish_m2_live_location(
  p_ride_id uuid, p_latitude double precision, p_longitude double precision,
  p_accuracy_meters double precision, p_heading_degrees double precision default null,
  p_speed_mps double precision default null, p_captured_at timestamptz default now()
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid(); v_role text; v_session private.m2_location_sessions%rowtype;
  v_last private.m2_live_locations%rowtype; v_last_history private.m2_location_history%rowtype;
  v_now timestamptz := now(); v_sample boolean; v_sos private.m2_sos_events%rowtype;
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
  select * into v_sos from private.m2_sos_events
  where ride_id = p_ride_id and actor_id = v_user_id and status = 'active' for update;
  if v_sos.id is not null then
    update private.m2_sos_events
    set last_point_at = v_now, location_state = 'live', signal_lost_at = null
    where id = v_sos.id;
    if v_sos.location_state = 'lost' then
      perform private.notify_m2_sos_family(
        v_sos.id, 'sos_signal_restored', 'SOS signal restored',
        'A fresh location update is available again.'
      );
    end if;
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
  if exists (select 1 from private.m2_sos_events e where e.ride_id = p_ride_id and e.actor_id = v_user_id and e.status = 'active') then
    raise exception 'Location sharing stays on during SOS. Use I''m safe to end the alert';
  end if;
  update private.m2_location_sessions set stopped_at = now() where ride_id = p_ride_id and user_id = v_user_id and stopped_at is null;
  get diagnostics v_changed = row_count;
  delete from private.m2_live_locations where ride_id = p_ride_id and user_id = v_user_id;
  return v_changed > 0;
end;
$$;

create or replace function private.monitor_m2_sos_signal()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event record;
  v_count integer := 0;
begin
  for v_event in
    select e.id
    from private.m2_sos_events e
    where e.status = 'active'
      and e.location_state <> 'lost'
      and coalesce(e.last_point_at, e.activated_at) <= now() - interval '2 minutes'
    for update skip locked
  loop
    update private.m2_sos_events
    set location_state = 'lost', signal_lost_at = now()
    where id = v_event.id;
    perform private.notify_m2_sos_family(
      v_event.id, 'sos_signal_lost', 'SOS location signal lost',
      'No fresh location has arrived for about two minutes. The last available point is still shown.'
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function private.stop_m2_live_on_terminal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_event_id uuid;
begin
  if new.status in ('Completed', 'Cancelled', 'Expired') and old.status is distinct from new.status then
    for v_event_id in select id from private.m2_sos_events where ride_id = new.id and status = 'active'
    loop
      update private.m2_sos_events
      set status = 'resolved', resolved_at = now(), resolution_reason = 'ride_terminal',
          cleanup_after = now() + interval '24 hours', location_state = 'unavailable'
      where id = v_event_id;
      perform private.notify_m2_sos_family(
        v_event_id, 'sos_resolved', 'SOS resolved',
        'The Ride ended. SOS location access has been closed.'
      );
    end loop;
    update private.m2_location_sessions set stopped_at = coalesce(stopped_at, now()) where ride_id = new.id;
    delete from private.m2_live_locations where ride_id = new.id;
    update private.m2_family_location_shares set revoked_at = coalesce(revoked_at, now()) where ride_id = new.id and revoked_at is null;
  end if;
  return new;
end;
$$;

create or replace function private.cleanup_m2_location_data()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  delete from private.m2_live_locations l
  where l.expires_at <= now()
    and not exists (
      select 1 from private.m2_sos_events e
      where e.ride_id = l.ride_id and e.actor_id = l.user_id and e.status = 'active'
    );
  get diagnostics v_count = row_count;
  delete from private.m2_location_history h using private.m2_location_sessions s
  where h.session_id = s.id and s.purge_after is not null and s.purge_after <= now();
  delete from private.m2_location_sessions s
  where s.purge_after is not null and s.purge_after <= now();
  delete from private.m2_family_location_shares where expires_at <= now() or revoked_at is not null;
  delete from private.m2_dynamic_map_daily_usage
  where usage_date < (now() at time zone 'Asia/Kuala_Lumpur')::date - 7;
  delete from private.m2_trusted_family_invites
  where expires_at <= now() or claimed_at is not null or revoked_at is not null;
  delete from private.m2_sos_events where cleanup_after is not null and cleanup_after <= now();
  return coalesce(v_count, 0);
end;
$$;

do $$
declare v_job_id bigint;
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    for v_job_id in select jobid from cron.job where jobname = 'm2-sos-signal-monitor'
    loop perform cron.unschedule(v_job_id); end loop;
    perform cron.schedule('m2-sos-signal-monitor', '* * * * *', 'select private.monitor_m2_sos_signal();');
  end if;
end;
$$;

revoke all on function private.m2_sos_recipient_counts(uuid) from public, anon, authenticated;
revoke all on function private.notify_m2_sos_family(uuid, text, text, text) from public, anon, authenticated;
revoke all on function private.monitor_m2_sos_signal() from public, anon, authenticated;
revoke all on function private.stop_m2_live_on_terminal() from public, anon, authenticated;
revoke all on function private.cleanup_m2_location_data() from public, anon, authenticated;
revoke all on function public.create_m2_trusted_family_invite() from public, anon, authenticated;
revoke all on function public.accept_m2_trusted_family_invite(text) from public, anon, authenticated;
revoke all on function public.list_m2_trusted_family() from public, anon, authenticated;
revoke all on function public.revoke_m2_trusted_family(uuid) from public, anon, authenticated;
revoke all on function public.activate_m2_sos(uuid) from public, anon, authenticated;
revoke all on function public.get_active_m2_sos(uuid) from public, anon, authenticated;
revoke all on function public.resolve_m2_sos(uuid) from public, anon, authenticated;
revoke all on function public.get_m2_sos_family_snapshot(uuid) from public, anon, authenticated;
revoke all on function public.publish_m2_live_location(uuid, double precision, double precision, double precision, double precision, double precision, timestamptz) from public, anon, authenticated;
revoke all on function public.stop_m2_location_sharing(uuid) from public, anon, authenticated;

grant execute on function public.create_m2_trusted_family_invite() to authenticated;
grant execute on function public.accept_m2_trusted_family_invite(text) to authenticated;
grant execute on function public.list_m2_trusted_family() to authenticated;
grant execute on function public.revoke_m2_trusted_family(uuid) to authenticated;
grant execute on function public.activate_m2_sos(uuid) to authenticated;
grant execute on function public.get_active_m2_sos(uuid) to authenticated;
grant execute on function public.resolve_m2_sos(uuid) to authenticated;
grant execute on function public.get_m2_sos_family_snapshot(uuid) to authenticated;
grant execute on function public.publish_m2_live_location(uuid, double precision, double precision, double precision, double precision, double precision, timestamptz) to authenticated;
grant execute on function public.stop_m2_location_sharing(uuid) to authenticated;
