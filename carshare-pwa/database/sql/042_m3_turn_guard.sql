-- Module 3: server-only TURN allowance guard and short-lived credential audit.
-- Apply after 041_m3_add_voice_calls.sql. The browser roles receive no access.

begin;

create table public.turn_usage_guard (
  singleton boolean primary key default true check (singleton),
  period_start date not null default date_trunc('month', timezone('utc', now()))::date,
  egress_bytes bigint not null default 0 check (egress_bytes >= 0),
  cutoff_bytes bigint not null default 900000000000 check (cutoff_bytes > 0),
  automatic_blocked boolean not null default false,
  manual_blocked boolean not null default false,
  last_checked_at timestamptz,
  last_error_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.turn_usage_guard (singleton)
values (true);

create table public.turn_credential_issues (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.call_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  turn_username text not null unique check (char_length(turn_username) between 1 and 512),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  constraint turn_credential_expiry_after_issue check (expires_at > issued_at),
  constraint turn_credential_revoke_after_issue check (
    revoked_at is null or revoked_at >= issued_at
  )
);

create index turn_credential_issues_user_issued_idx
  on public.turn_credential_issues (user_id, issued_at desc);
create index turn_credential_issues_active_expiry_idx
  on public.turn_credential_issues (expires_at)
  where revoked_at is null;

alter table public.turn_usage_guard enable row level security;
alter table public.turn_credential_issues enable row level security;

revoke all on table public.turn_usage_guard from public, anon, authenticated;
revoke all on table public.turn_credential_issues from public, anon, authenticated;
grant select, insert, update, delete on table public.turn_usage_guard to service_role;
grant select, insert, update, delete on table public.turn_credential_issues to service_role;

create or replace function public.record_turn_credential_issue(
  p_call_id uuid,
  p_user_id uuid,
  p_turn_username text,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_issue_id uuid;
begin
  if p_user_id is null or p_call_id is null
     or nullif(trim(p_turn_username), '') is null
     or char_length(p_turn_username) > 512
     or p_expires_at <= now()
  then
    raise exception 'Invalid TURN credential issue';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('m3-turn-rate:' || p_user_id::text, 0)
  );

  if not exists (
    select 1
    from public.call_sessions cs
    where cs.id = p_call_id
      and p_user_id in (cs.caller_id, cs.callee_id)
      and cs.status in ('ringing', 'accepted')
      and (
        cs.status <> 'accepted'
        or cs.answered_at > now() - interval '60 minutes'
      )
  ) then
    raise exception 'This call is unavailable for TURN';
  end if;

  if (
    select count(*)
    from public.turn_credential_issues issue
    where issue.user_id = p_user_id
      and issue.issued_at >= now() - interval '1 hour'
  ) >= 10 then
    raise exception 'TURN credential rate limit reached';
  end if;

  insert into public.turn_credential_issues (
    call_id,
    user_id,
    turn_username,
    expires_at
  ) values (
    p_call_id,
    p_user_id,
    trim(p_turn_username),
    p_expires_at
  )
  returning id into v_issue_id;

  return v_issue_id;
end;
$$;

create or replace function public.expire_overlong_voice_calls()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.call_sessions
  set status = 'ended',
      ended_at = now(),
      updated_at = now()
  where status = 'accepted'
    and answered_at <= now() - interval '60 minutes';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.record_turn_credential_issue(uuid, uuid, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.expire_overlong_voice_calls()
  from public, anon, authenticated;
grant execute on function public.record_turn_credential_issue(uuid, uuid, text, timestamptz)
  to service_role;
grant execute on function public.expire_overlong_voice_calls()
  to service_role;

commit;
