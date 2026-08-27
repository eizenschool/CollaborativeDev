-- Module 1 reputation evidence ledger and ride eligibility.
-- Deployed through the Dashboard SQL Editor; see docs/ai/SQL.md.
-- Reputation is changed only by verified ride outcomes. Ordinary login, profile
-- completion, identity documents and CO2 impact intentionally award no points.
-- Depends on 015_m2_ride_reviews.sql and 028_m2_route_schedule_and_completion.sql.

alter table public.host_impact_stats
  alter column reputation_score set default 70,
  add column if not exists reputation_hold boolean not null default false,
  add column if not exists reputation_updated_at timestamptz not null default now();

update public.host_impact_stats s
set reputation_score = 70,
    reputation_updated_at = now()
where s.reputation_score = 50
  and s.completed_trips = 0
  and not exists (
    select 1 from public.ride_reviews rr where rr.reviewee_id = s.user_id
  );

create table public.reputation_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  ride_id uuid references public.rides(id) on delete set null,
  source_module text not null check (source_module in ('M1', 'M2', 'Safety')),
  source_event_id text not null,
  event_type text not null check (event_type in (
    'ride_completed', 'on_time_check_in',
    'review_5_star', 'review_4_star', 'review_3_star', 'review_2_star', 'review_1_star',
    'host_cancelled_early', 'host_cancelled_late', 'host_cancelled_very_late',
    'traveller_cancelled_early', 'traveller_cancelled_late', 'traveller_cancelled_very_late',
    'no_show', 'confirmed_minor_conduct', 'confirmed_serious_conduct'
  )),
  role text not null check (role in ('host', 'traveller')),
  delta smallint not null check (delta between -100 and 100),
  reason text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint reputation_events_source_once_key
    unique (user_id, source_module, source_event_id, event_type)
);

create index reputation_events_user_created_idx
  on public.reputation_events (user_id, created_at desc);
create index reputation_events_ride_user_idx
  on public.reputation_events (ride_id, user_id)
  where ride_id is not null;

alter table public.reputation_events enable row level security;
create policy "users read their own reputation events"
  on public.reputation_events for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.reputation_events from public, anon, authenticated;
grant select on table public.reputation_events to authenticated;
revoke update (reputation_score, reputation_hold, reputation_updated_at)
  on table public.host_impact_stats from authenticated;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.reputation_evidence_count(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    coalesce((select completed_trips from public.host_impact_stats where user_id = p_user_id), 0),
    coalesce((select count(distinct ride_id)::integer from public.reputation_events where user_id = p_user_id and ride_id is not null), 0)
  );
$$;

create or replace function private.record_reputation_event(
  p_user_id uuid,
  p_ride_id uuid,
  p_source_module text,
  p_source_event_id text,
  p_event_type text,
  p_role text,
  p_delta integer,
  p_reason text default '',
  p_metadata jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_positive integer := 0;
  v_applied_delta integer := p_delta;
  v_inserted_delta integer;
begin
  if p_user_id is null or p_source_event_id is null then
    raise exception 'Reputation event identity is required';
  end if;

  perform 1 from public.host_impact_stats where user_id = p_user_id for update;

  if p_delta > 0 and p_ride_id is not null then
    select coalesce(sum(greatest(delta, 0)), 0)::integer
      into v_existing_positive
    from public.reputation_events
    where user_id = p_user_id and ride_id = p_ride_id;
    v_applied_delta := least(p_delta, greatest(0, 3 - v_existing_positive));
    if v_applied_delta = 0 then return false; end if;
  end if;

  insert into public.reputation_events (
    user_id, ride_id, source_module, source_event_id, event_type, role, delta, reason, metadata
  ) values (
    p_user_id, p_ride_id, p_source_module, p_source_event_id, p_event_type,
    p_role, v_applied_delta, coalesce(p_reason, ''), coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (user_id, source_module, source_event_id, event_type) do nothing
  returning delta into v_inserted_delta;

  if v_inserted_delta is null then return false; end if;

  update public.host_impact_stats
  set reputation_score = greatest(0, least(100, reputation_score + v_inserted_delta)),
      reputation_updated_at = now(),
      updated_at = now()
  where user_id = p_user_id;
  return true;
end;
$$;

revoke all on function private.reputation_evidence_count(uuid) from public, anon, authenticated;
revoke all on function private.record_reputation_event(uuid, uuid, text, text, text, text, integer, text, jsonb) from public, anon, authenticated;

create or replace function private.reputation_from_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delta integer := case new.rating when 5 then 2 when 4 then 1 when 3 then 0 when 2 then -3 else -6 end;
begin
  perform private.record_reputation_event(
    new.reviewee_id, new.ride_id, 'M2', new.id::text,
    'review_' || new.rating::text || '_star',
    case when new.reviewee_id = r.host_id then 'host' else 'traveller' end,
    v_delta, 'Verified post-ride review', jsonb_build_object('reviewId', new.id)
  )
  from public.rides r where r.id = new.ride_id;
  return new;
end;
$$;

create or replace function private.reputation_from_ride_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event text;
  v_delta integer;
  v_cancelled_at timestamptz := coalesce(new.cancelled_at, now());
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
  elsif new.status = 'Cancelled' and old.status is distinct from 'Cancelled' and new.cancelled_by = 'Host' then
    if new.departure_at - v_cancelled_at > interval '24 hours' then v_event := 'host_cancelled_early'; v_delta := -1;
    elsif new.departure_at - v_cancelled_at >= interval '6 hours' then v_event := 'host_cancelled_late'; v_delta := -3;
    else v_event := 'host_cancelled_very_late'; v_delta := -6;
    end if;
    perform private.record_reputation_event(new.host_id, new.id, 'M2', new.id::text || ':cancelled:host', v_event, 'host', v_delta, 'Driver cancellation');
  end if;
  return new;
end;
$$;

create or replace function private.reputation_from_request_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ride public.rides%rowtype;
  v_event text;
  v_delta integer;
  v_cancelled_at timestamptz := coalesce(new.cancelled_at, now());
begin
  select * into v_ride from public.rides where id = new.ride_id;

  if new.boarding_status = 'Checked In' and old.boarding_status is distinct from 'Checked In'
     and new.checked_in_at <= v_ride.departure_at then
    perform private.record_reputation_event(new.requester_id, new.ride_id, 'M2', new.id::text || ':check-in', 'on_time_check_in', 'traveller', 1, 'Verified on-time check-in');
  end if;

  if new.boarding_status = 'No-show' and old.boarding_status is distinct from 'No-show' then
    perform private.record_reputation_event(new.requester_id, new.ride_id, 'M2', new.id::text || ':no-show', 'no_show', 'traveller', -10, 'Verified no-show');
  end if;

  if new.status = 'Cancelled' and old.status is distinct from 'Cancelled' and new.cancelled_by = 'Requester' then
    if v_ride.departure_at - v_cancelled_at > interval '24 hours' then v_event := 'traveller_cancelled_early'; v_delta := -1;
    elsif v_ride.departure_at - v_cancelled_at >= interval '6 hours' then v_event := 'traveller_cancelled_late'; v_delta := -3;
    else v_event := 'traveller_cancelled_very_late'; v_delta := -6;
    end if;
    perform private.record_reputation_event(new.requester_id, new.ride_id, 'M2', new.id::text || ':cancelled', v_event, 'traveller', v_delta, 'Traveller cancellation');
  end if;
  return new;
end;
$$;

drop trigger if exists reputation_after_review_insert on public.ride_reviews;
create trigger reputation_after_review_insert after insert on public.ride_reviews
for each row execute function private.reputation_from_review();
drop trigger if exists reputation_after_ride_status on public.rides;
create trigger reputation_after_ride_status after update of status on public.rides
for each row execute function private.reputation_from_ride_status();
drop trigger if exists reputation_after_request_status on public.ride_requests;
create trigger reputation_after_request_status after update of status, boarding_status on public.ride_requests
for each row execute function private.reputation_from_request_status();

create or replace function private.enforce_ride_reputation_eligibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_score integer := 70;
  v_hold boolean := false;
  v_evidence integer := 0;
  v_needs_check boolean := false;
begin
  if tg_op = 'INSERT' then
    v_needs_check := new.status = 'Published';
  else
    v_needs_check := new.status = 'Published' and old.status is distinct from 'Published';
  end if;

  if v_needs_check then
    select reputation_score, reputation_hold into v_score, v_hold
    from public.host_impact_stats where user_id = new.host_id;
    v_evidence := private.reputation_evidence_count(new.host_id);
    if v_hold then raise exception 'Ride publishing is paused while a confirmed safety case is reviewed'; end if;
    if v_evidence >= 3 and v_score < 65 then
      raise exception 'A reputation score of 65 or higher is required to publish a new ride';
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.enforce_request_reputation_eligibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_score integer := 70;
  v_hold boolean := false;
  v_evidence integer := 0;
begin
  select reputation_score, reputation_hold into v_score, v_hold
  from public.host_impact_stats where user_id = new.requester_id;
  v_evidence := private.reputation_evidence_count(new.requester_id);
  if v_hold then raise exception 'Ride requests are paused while a confirmed safety case is reviewed'; end if;
  if v_evidence >= 3 and v_score < 50 then
    raise exception 'A reputation score of 50 or higher is required to request a new ride';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_ride_reputation_before_publish on public.rides;
create trigger enforce_ride_reputation_before_publish before insert or update of status on public.rides
for each row execute function private.enforce_ride_reputation_eligibility();
drop trigger if exists enforce_request_reputation_before_insert on public.ride_requests;
create trigger enforce_request_reputation_before_insert before insert on public.ride_requests
for each row execute function private.enforce_request_reputation_eligibility();

create or replace function public.get_reputation_summary(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_stats public.host_impact_stats%rowtype;
  v_review_count integer;
  v_events jsonb;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then raise exception 'Not authorised'; end if;
  select * into v_stats from public.host_impact_stats where user_id = p_user_id;
  select count(*)::integer into v_review_count from public.ride_reviews where reviewee_id = p_user_id;
  select coalesce(jsonb_agg(to_jsonb(e) order by e."createdAt" desc), '[]'::jsonb) into v_events
  from (
    select id, ride_id as "rideId", event_type as type, delta, reason, created_at as "createdAt"
    from public.reputation_events where user_id = p_user_id order by created_at desc limit 20
  ) e;
  return jsonb_build_object(
    'score', coalesce(v_stats.reputation_score, 70),
    'hold', coalesce(v_stats.reputation_hold, false),
    'rating', v_stats.rating,
    'reviewCount', coalesce(v_review_count, 0),
    'completedTrips', coalesce(v_stats.completed_trips, 0),
    'evidenceCount', private.reputation_evidence_count(p_user_id),
    'events', v_events
  );
end;
$$;

create or replace function public.get_ride_eligibility(p_role text default 'traveller')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_score integer := 70;
  v_hold boolean := false;
  v_evidence integer := 0;
  v_minimum integer := case when p_role = 'host' then 65 else 50 end;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select reputation_score, reputation_hold into v_score, v_hold
  from public.host_impact_stats where user_id = v_user_id;
  v_evidence := private.reputation_evidence_count(v_user_id);
  return jsonb_build_object(
    'eligible', not v_hold and (v_evidence < 3 or v_score >= v_minimum),
    'score', v_score, 'hold', v_hold, 'evidenceCount', v_evidence,
    'provisional', v_evidence < 3, 'minimum', v_minimum
  );
end;
$$;

revoke all on function public.get_reputation_summary(uuid) from public, anon, authenticated;
revoke all on function public.get_ride_eligibility(text) from public, anon, authenticated;
grant execute on function public.get_reputation_summary(uuid) to authenticated;
grant execute on function public.get_ride_eligibility(text) to authenticated;
