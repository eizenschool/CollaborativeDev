-- Module 6 / Tumpang Guide v3 reliability primitives.
-- Stores no prompts, raw user messages, precise coordinates, contacts or audio.

create schema if not exists private;

create table if not exists private.ai_guide_turn_requests (
  actor_key text not null,
  client_turn_id uuid not null,
  status text not null default 'processing',
  lease_token uuid,
  lease_expires_at timestamptz,
  response_payload jsonb,
  trace_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  primary key (actor_key, client_turn_id),
  constraint ai_guide_turn_requests_status_check
    check (status in ('processing', 'complete', 'failed'))
);

create index if not exists ai_guide_turn_requests_expiry_idx
  on private.ai_guide_turn_requests (expires_at);
create index if not exists ai_guide_turn_requests_active_lease_idx
  on private.ai_guide_turn_requests (lease_expires_at)
  where status = 'processing';

create table if not exists private.ai_guide_provider_attempts (
  id bigint generated always as identity primary key,
  trace_id text not null,
  client_turn_id uuid,
  provider text not null,
  model text not null,
  stage text not null,
  outcome text not null,
  http_status integer,
  latency_ms integer not null default 0,
  failure_reason text,
  created_at timestamptz not null default now(),
  constraint ai_guide_provider_attempts_provider_check check (provider in ('gemini', 'groq')),
  constraint ai_guide_provider_attempts_outcome_check check (outcome in ('success', 'failure', 'skipped')),
  constraint ai_guide_provider_attempts_latency_check check (latency_ms >= 0)
);

create index if not exists ai_guide_provider_attempts_trace_idx
  on private.ai_guide_provider_attempts (trace_id, created_at);
create index if not exists ai_guide_provider_attempts_recent_failures_idx
  on private.ai_guide_provider_attempts (provider, created_at desc)
  where outcome = 'failure';

create table if not exists private.ai_guide_provider_health (
  provider text primary key,
  cooldown_until timestamptz,
  last_http_status integer,
  last_failure_reason text,
  retry_after_seconds integer,
  updated_at timestamptz not null default now(),
  constraint ai_guide_provider_health_provider_check check (provider in ('gemini', 'groq')),
  constraint ai_guide_provider_health_retry_check check (retry_after_seconds is null or retry_after_seconds >= 0)
);

create table if not exists private.ai_guide_live_fact_cache (
  cache_key text primary key,
  place_name text not null,
  language_tag text not null,
  facts jsonb not null,
  sources jsonb not null default '[]'::jsonb,
  checked_at timestamptz not null,
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_guide_live_fact_cache_expiry_idx
  on private.ai_guide_live_fact_cache (expires_at);

alter table private.ai_guide_turn_requests enable row level security;
alter table private.ai_guide_turn_requests force row level security;
alter table private.ai_guide_provider_attempts enable row level security;
alter table private.ai_guide_provider_attempts force row level security;
alter table private.ai_guide_provider_health enable row level security;
alter table private.ai_guide_provider_health force row level security;
alter table private.ai_guide_live_fact_cache enable row level security;
alter table private.ai_guide_live_fact_cache force row level security;

revoke all on table private.ai_guide_turn_requests from public, anon, authenticated;
revoke all on table private.ai_guide_provider_attempts from public, anon, authenticated;
revoke all on table private.ai_guide_provider_health from public, anon, authenticated;
revoke all on table private.ai_guide_live_fact_cache from public, anon, authenticated;
grant select, insert, update, delete on table private.ai_guide_turn_requests to service_role;
grant select, insert, update, delete on table private.ai_guide_provider_attempts to service_role;
grant select, insert, update, delete on table private.ai_guide_provider_health to service_role;
grant select, insert, update, delete on table private.ai_guide_live_fact_cache to service_role;
grant usage, select on sequence private.ai_guide_provider_attempts_id_seq to service_role;

create or replace function public.m6_claim_ai_guide_turn(
  p_actor_key text,
  p_client_turn_id uuid,
  p_lease_token uuid,
  p_trace_id text,
  p_lease_seconds integer default 100
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_row private.ai_guide_turn_requests%rowtype;
  bounded_lease integer := greatest(15, least(coalesce(p_lease_seconds, 100), 120));
begin
  insert into private.ai_guide_turn_requests (
    actor_key, client_turn_id, status, lease_token, lease_expires_at, trace_id, expires_at
  ) values (
    p_actor_key, p_client_turn_id, 'processing', p_lease_token,
    pg_catalog.now() + pg_catalog.make_interval(secs => bounded_lease),
    left(p_trace_id, 120), pg_catalog.now() + interval '15 minutes'
  ) on conflict (actor_key, client_turn_id) do nothing;

  select * into current_row
  from private.ai_guide_turn_requests
  where actor_key = p_actor_key and client_turn_id = p_client_turn_id
  for update;

  if current_row.status = 'complete' and current_row.expires_at > pg_catalog.now() then
    return pg_catalog.jsonb_build_object('state', 'complete', 'response', current_row.response_payload);
  end if;

  if current_row.status = 'processing'
     and current_row.lease_token is distinct from p_lease_token
     and current_row.lease_expires_at > pg_catalog.now() then
    return pg_catalog.jsonb_build_object('state', 'processing', 'retryAfterMs', 1200);
  end if;

  update private.ai_guide_turn_requests
  set status = 'processing', lease_token = p_lease_token,
      lease_expires_at = pg_catalog.now() + pg_catalog.make_interval(secs => bounded_lease),
      response_payload = null, trace_id = left(p_trace_id, 120),
      updated_at = pg_catalog.now(), expires_at = pg_catalog.now() + interval '15 minutes'
  where actor_key = p_actor_key and client_turn_id = p_client_turn_id;

  return pg_catalog.jsonb_build_object('state', 'claimed');
end;
$$;

create or replace function public.m6_complete_ai_guide_turn(
  p_actor_key text,
  p_client_turn_id uuid,
  p_lease_token uuid,
  p_response_payload jsonb
) returns boolean
language sql
security definer
set search_path = ''
as $$
  update private.ai_guide_turn_requests
  set status = 'complete', response_payload = p_response_payload,
      lease_token = null, lease_expires_at = null,
      updated_at = pg_catalog.now(), expires_at = pg_catalog.now() + interval '15 minutes'
  where actor_key = p_actor_key and client_turn_id = p_client_turn_id
    and status = 'processing' and lease_token = p_lease_token
  returning true;
$$;

create or replace function public.m6_fail_ai_guide_turn(
  p_actor_key text,
  p_client_turn_id uuid,
  p_lease_token uuid
) returns boolean
language sql
security definer
set search_path = ''
as $$
  update private.ai_guide_turn_requests
  set status = 'failed', lease_token = null, lease_expires_at = null,
      updated_at = pg_catalog.now(), expires_at = pg_catalog.now() + interval '2 minutes'
  where actor_key = p_actor_key and client_turn_id = p_client_turn_id
    and status = 'processing' and lease_token = p_lease_token
  returning true;
$$;

create or replace function public.m6_cleanup_ai_guide_reliability()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare deleted_count integer := 0;
declare affected integer := 0;
begin
  delete from private.ai_guide_turn_requests where expires_at <= pg_catalog.now();
  get diagnostics affected = row_count; deleted_count := deleted_count + affected;
  delete from private.ai_guide_live_fact_cache where expires_at <= pg_catalog.now();
  get diagnostics affected = row_count; deleted_count := deleted_count + affected;
  delete from private.ai_guide_provider_attempts where created_at < pg_catalog.now() - interval '30 days';
  get diagnostics affected = row_count; deleted_count := deleted_count + affected;
  return deleted_count;
end;
$$;

revoke execute on function public.m6_claim_ai_guide_turn(text, uuid, uuid, text, integer) from public, anon, authenticated;
revoke execute on function public.m6_complete_ai_guide_turn(text, uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.m6_fail_ai_guide_turn(text, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.m6_cleanup_ai_guide_reliability() from public, anon, authenticated;
grant execute on function public.m6_claim_ai_guide_turn(text, uuid, uuid, text, integer) to service_role;
grant execute on function public.m6_complete_ai_guide_turn(text, uuid, uuid, jsonb) to service_role;
grant execute on function public.m6_fail_ai_guide_turn(text, uuid, uuid) to service_role;
grant execute on function public.m6_cleanup_ai_guide_reliability() to service_role;
