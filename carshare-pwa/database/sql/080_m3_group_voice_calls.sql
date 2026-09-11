-- Module 3: group voice-call invitations with independent per-member responses.
-- Media remains browser-to-browser WebRTC audio. Supabase stores room and
-- participant state and authorizes the private signalling channel only.

begin;

alter table public.call_sessions
  add column call_type text not null default 'direct'
    check (call_type in ('direct', 'group'));

alter table public.call_sessions
  alter column callee_id drop not null;
alter table public.call_sessions
  drop constraint if exists call_sessions_distinct_participants;
alter table public.call_sessions
  add constraint call_sessions_distinct_participants check (
    callee_id is null or caller_id <> callee_id
  );

update public.call_sessions cs
set call_type = case when c.type = 'group' then 'group' else 'direct' end
from public.conversations c
where c.id = cs.conversation_id;

create table public.call_participants (
  call_id uuid not null references public.call_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('caller', 'invitee')),
  status text not null check (
    status in ('ringing', 'accepted', 'declined', 'missed', 'left', 'failed')
  ),
  device_id text,
  invited_at timestamptz not null default now(),
  answered_at timestamptz,
  left_at timestamptz,
  last_seen_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (call_id, user_id),
  constraint call_participants_device_length check (
    device_id is null or char_length(device_id) between 1 and 128
  ),
  constraint call_participants_response_times check (
    (answered_at is null or answered_at >= invited_at)
    and (left_at is null or left_at >= invited_at)
  )
);

create index call_participants_user_status_idx
  on public.call_participants (user_id, status, invited_at desc);
create index call_participants_call_status_idx
  on public.call_participants (call_id, status, user_id);
create unique index call_participants_one_caller_idx
  on public.call_participants (call_id)
  where role = 'caller';

alter table public.call_participants enable row level security;
alter table public.call_participants replica identity full;

-- Preserve all existing direct-call history before replacing its access rules.
insert into public.call_participants (
  call_id, user_id, role, status, device_id, invited_at,
  answered_at, left_at, last_seen_at, updated_at
)
select
  cs.id,
  cs.caller_id,
  'caller',
  case when cs.status in ('ringing', 'accepted') then 'accepted'
       when cs.status = 'failed' then 'failed' else 'left' end,
  cs.caller_device_id,
  cs.created_at,
  cs.created_at,
  case when cs.status in ('ringing', 'accepted') then null else cs.ended_at end,
  coalesce(cs.caller_last_seen_at, cs.answered_at, cs.created_at),
  cs.updated_at
from public.call_sessions cs
on conflict (call_id, user_id) do nothing;

insert into public.call_participants (
  call_id, user_id, role, status, device_id, invited_at,
  answered_at, left_at, last_seen_at, updated_at
)
select
  cs.id,
  cs.callee_id,
  'invitee',
  case cs.status
    when 'ringing' then 'ringing'
    when 'accepted' then 'accepted'
    when 'declined' then 'declined'
    when 'missed' then 'missed'
    when 'failed' then 'failed'
    when 'cancelled' then 'missed'
    else 'left'
  end,
  cs.answer_device_id,
  cs.created_at,
  case when cs.answered_at is not null then cs.answered_at else null end,
  case when cs.status in ('ringing', 'accepted') then null else cs.ended_at end,
  coalesce(cs.callee_last_seen_at, cs.answered_at),
  cs.updated_at
from public.call_sessions cs
where cs.callee_id is not null
on conflict (call_id, user_id) do nothing;

create or replace function private.call_participant_can_read(
  p_call_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.call_participants cp
    join public.call_sessions cs on cs.id = cp.call_id
    where cp.call_id = p_call_id
      and cp.user_id = p_user_id
      and p_user_id = (select auth.uid())
      and (select private.conversation_is_visible(cs.conversation_id, p_user_id))
  );
$$;

create or replace function private.call_participant_can_signal(
  p_call_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.call_participants cp
    join public.call_sessions cs on cs.id = cp.call_id
    where cp.call_id = p_call_id
      and cp.user_id = p_user_id
      and p_user_id = (select auth.uid())
      and cp.status in ('ringing', 'accepted')
      and cs.status in ('ringing', 'accepted')
      and (select private.conversation_is_writable(cs.conversation_id, p_user_id))
  );
$$;

revoke all on function private.call_participant_can_read(uuid, uuid)
  from public, anon, authenticated;
revoke all on function private.call_participant_can_signal(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.call_participant_can_read(uuid, uuid) to authenticated;
grant execute on function private.call_participant_can_signal(uuid, uuid) to authenticated;

create or replace function private.call_is_visible(
  p_call_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.call_participant_can_read(p_call_id, p_user_id);
$$;

revoke all on function private.call_is_visible(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.call_is_visible(uuid, uuid) to authenticated;

drop policy if exists "call participants read their calls" on public.call_sessions;
drop policy if exists "visible conversation participants read their calls" on public.call_sessions;
drop policy if exists "participants read personally visible calls" on public.call_sessions;
create policy "invited members read visible calls"
  on public.call_sessions for select to authenticated
  using ((select private.call_participant_can_read(id, (select auth.uid()))));

create policy "invited members read call participants"
  on public.call_participants for select to authenticated
  using ((select private.call_participant_can_read(call_id, (select auth.uid()))));

revoke all on table public.call_participants from public, anon, authenticated;
grant select on table public.call_participants to authenticated;

create or replace function private.refresh_voice_call_status(p_call_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_call public.call_sessions%rowtype;
  v_accepted_count integer;
  v_ringing_count integer;
  v_failed_count integer;
  v_declined_count integer;
  v_invitee_count integer;
  v_caller_active boolean;
begin
  select * into v_call
  from public.call_sessions
  where id = p_call_id
  for update;

  if not found or v_call.status in ('declined', 'cancelled', 'ended', 'missed', 'failed') then
    return;
  end if;

  if v_call.status = 'accepted'
     and v_call.answered_at <= now() - interval '60 minutes' then
    update public.call_participants
    set status = case when status = 'accepted' then 'left' else status end,
        left_at = case when status = 'accepted' then now() else left_at end,
        updated_at = now()
    where call_id = p_call_id;
    update public.call_sessions
    set status = 'ended', ended_at = now(), updated_at = now()
    where id = p_call_id;
    return;
  end if;

  update public.call_participants
  set status = 'missed', left_at = now(), updated_at = now()
  where call_id = p_call_id
    and role = 'invitee'
    and status = 'ringing'
    and invited_at <= now() - interval '45 seconds';

  update public.call_participants
  set status = 'failed', left_at = now(), updated_at = now()
  where call_id = p_call_id
    and status = 'accepted'
    and coalesce(last_seen_at, answered_at, invited_at) <= now() - interval '90 seconds';

  select count(*) filter (where status = 'accepted'),
         count(*) filter (where role = 'invitee' and status = 'ringing'),
         count(*) filter (where status = 'failed'),
         count(*) filter (where role = 'invitee' and status = 'declined'),
         count(*) filter (where role = 'invitee'),
         bool_or(role = 'caller' and status = 'accepted')
  into v_accepted_count, v_ringing_count, v_failed_count,
       v_declined_count, v_invitee_count, v_caller_active
  from public.call_participants
  where call_id = p_call_id;

  if v_call.status = 'ringing' and not coalesce(v_caller_active, false) then
    update public.call_participants
    set status = 'missed', left_at = now(), updated_at = now()
    where call_id = p_call_id and status = 'ringing';
    update public.call_sessions
    set status = 'cancelled', ended_at = now(), updated_at = now()
    where id = p_call_id;
  elsif v_call.status = 'ringing' and v_accepted_count >= 2 then
    update public.call_sessions
    set status = 'accepted', answered_at = coalesce(answered_at, now()), updated_at = now()
    where id = p_call_id;
  elsif v_call.status = 'ringing' and v_ringing_count = 0 then
    update public.call_sessions
    set status = case when v_declined_count = v_invitee_count then 'declined' else 'missed' end,
        ended_at = now(), updated_at = now()
    where id = p_call_id;
  elsif v_call.status = 'accepted' and v_accepted_count < 2 then
    update public.call_sessions
    set status = case when v_failed_count > 0 then 'failed' else 'ended' end,
        ended_at = now(), updated_at = now()
    where id = p_call_id;
  end if;
end;
$$;

revoke all on function private.refresh_voice_call_status(uuid)
  from public, anon, authenticated;

create or replace function private.expire_stale_voice_calls(p_user_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_call_id uuid;
  v_count integer := 0;
begin
  for v_call_id in
    select distinct cp.call_id
    from public.call_participants cp
    join public.call_sessions cs on cs.id = cp.call_id
    where cs.status in ('ringing', 'accepted')
      and (p_user_ids is null or cp.user_id = any(p_user_ids))
  loop
    perform private.refresh_voice_call_status(v_call_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function private.expire_stale_voice_calls(uuid[])
  from public, anon, authenticated;

create or replace function public.start_voice_call(
  p_conversation_id uuid,
  p_caller_device_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_conversation_type text;
  v_member_ids uuid[];
  v_callee_id uuid;
  v_call_id uuid;
begin
  if v_user_id is null then raise exception 'Sign in before starting a voice call'; end if;
  if p_caller_device_id is not null and (
    nullif(trim(p_caller_device_id), '') is null or char_length(p_caller_device_id) > 128
  ) then raise exception 'A valid calling device is required'; end if;
  if not (select private.conversation_is_writable(p_conversation_id, v_user_id)) then
    raise exception 'This conversation is unavailable for calling';
  end if;

  select c.type,
         array_agg(cm.user_id order by cm.user_id)
  into v_conversation_type, v_member_ids
  from public.conversations c
  join public.conversation_members cm
    on cm.conversation_id = c.id and cm.left_at is null
  join public.profiles p on p.id = cm.user_id and p.status = 'active'
  where c.id = p_conversation_id
    and c.type in ('direct', 'group')
  group by c.type;

  if v_member_ids is null or not (v_user_id = any(v_member_ids)) then
    raise exception 'This conversation is unavailable for calling';
  end if;
  if array_length(v_member_ids, 1) < 2 then
    raise exception 'At least two active members are required for a call';
  end if;
  if array_length(v_member_ids, 1) > 8 then
    raise exception 'Group voice calls support up to 8 active members';
  end if;
  if v_conversation_type = 'direct' and array_length(v_member_ids, 1) <> 2 then
    raise exception 'This private chat is unavailable for calling';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('m3-call-room:' || p_conversation_id::text, 0)
  );
  perform private.expire_stale_voice_calls(array[v_user_id]);

  if exists (
    select 1
    from public.call_participants cp
    join public.call_sessions cs on cs.id = cp.call_id
    where cp.user_id = v_user_id
      and cp.status = 'accepted'
      and cs.status in ('ringing', 'accepted')
  ) then
    raise exception 'Finish the current call before starting another';
  end if;

  if exists (
    select 1 from public.call_sessions cs
    where cs.conversation_id = p_conversation_id
      and cs.status in ('ringing', 'accepted')
  ) then
    raise exception 'A call is already active in this conversation';
  end if;

  if v_conversation_type = 'direct' then
    select member_id into v_callee_id
    from unnest(v_member_ids) member_id
    where member_id <> v_user_id
    limit 1;
  end if;

  insert into public.call_sessions (
    conversation_id, caller_id, callee_id, call_type,
    caller_device_id, caller_last_seen_at, status
  ) values (
    p_conversation_id, v_user_id, v_callee_id, v_conversation_type,
    nullif(trim(p_caller_device_id), ''), now(), 'ringing'
  ) returning id into v_call_id;

  insert into public.call_participants (
    call_id, user_id, role, status, device_id, invited_at,
    answered_at, last_seen_at
  )
  select
    v_call_id,
    member_id,
    case when member_id = v_user_id then 'caller' else 'invitee' end,
    case when member_id = v_user_id then 'accepted' else 'ringing' end,
    case when member_id = v_user_id then nullif(trim(p_caller_device_id), '') else null end,
    now(),
    case when member_id = v_user_id then now() else null end,
    case when member_id = v_user_id then now() else null end
  from unnest(v_member_ids) member_id;

  return v_call_id;
end;
$$;

create or replace function public.start_voice_call(p_conversation_id uuid)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select public.start_voice_call(p_conversation_id, null);
$$;

create or replace function public.respond_to_voice_call(
  p_call_id uuid,
  p_accept boolean,
  p_answer_device_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_call public.call_sessions%rowtype;
  v_participant public.call_participants%rowtype;
begin
  select * into v_call from public.call_sessions where id = p_call_id for update;
  select * into v_participant
  from public.call_participants
  where call_id = p_call_id and user_id = v_user_id
  for update;

  if v_user_id is null or not found or v_participant.role <> 'invitee'
     or v_participant.status <> 'ringing' then
    raise exception 'This incoming call is unavailable';
  end if;
  if v_call.status not in ('ringing', 'accepted') then
    raise exception 'This call is no longer ringing';
  end if;
  if not (select private.conversation_is_writable(v_call.conversation_id, v_user_id)) then
    raise exception 'This conversation is unavailable for calling';
  end if;

  if v_participant.invited_at < now() - interval '45 seconds' then
    update public.call_participants
    set status = 'missed', left_at = now(), updated_at = now()
    where call_id = p_call_id and user_id = v_user_id;
    perform private.refresh_voice_call_status(p_call_id);
    return p_call_id;
  end if;

  if p_accept then
    if nullif(trim(p_answer_device_id), '') is null
       or char_length(p_answer_device_id) > 128 then
      raise exception 'A valid answering device is required';
    end if;
    if exists (
      select 1
      from public.call_participants other_participant
      join public.call_sessions other_call on other_call.id = other_participant.call_id
      where other_participant.user_id = v_user_id
        and other_participant.call_id <> p_call_id
        and other_participant.status = 'accepted'
        and other_call.status in ('ringing', 'accepted')
    ) then
      raise exception 'Finish the current call before answering another';
    end if;
    update public.call_participants
    set status = 'accepted', device_id = p_answer_device_id,
        answered_at = now(), last_seen_at = now(), updated_at = now()
    where call_id = p_call_id and user_id = v_user_id;
  else
    update public.call_participants
    set status = 'declined', left_at = now(), updated_at = now()
    where call_id = p_call_id and user_id = v_user_id;
  end if;

  perform private.refresh_voice_call_status(p_call_id);
  return p_call_id;
end;
$$;

create or replace function public.end_voice_call(p_call_id uuid, p_outcome text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_call public.call_sessions%rowtype;
  v_participant public.call_participants%rowtype;
begin
  if p_outcome not in ('cancelled', 'ended', 'missed', 'failed') then
    raise exception 'Unsupported call outcome';
  end if;

  select * into v_call from public.call_sessions where id = p_call_id for update;
  select * into v_participant
  from public.call_participants
  where call_id = p_call_id and user_id = v_user_id
  for update;

  if v_user_id is null or not found then raise exception 'This call is unavailable'; end if;
  if v_call.status in ('declined', 'cancelled', 'ended', 'missed', 'failed') then
    return p_call_id;
  end if;

  if v_participant.role = 'caller' and v_call.status = 'ringing' then
    update public.call_participants
    set status = case when role = 'caller' and p_outcome = 'failed' then 'failed'
                      when role = 'caller' then 'left'
                      when status = 'ringing' then 'missed' else status end,
        left_at = case when status in ('ringing', 'accepted') then now() else left_at end,
        updated_at = now()
    where call_id = p_call_id;
    update public.call_sessions
    set status = case when p_outcome = 'failed' then 'failed'
                      when p_outcome = 'missed' then 'missed' else 'cancelled' end,
        ended_at = now(), updated_at = now()
    where id = p_call_id;
    return p_call_id;
  end if;

  if v_participant.status = 'ringing' then
    update public.call_participants
    set status = case when p_outcome = 'failed' then 'failed' else 'missed' end,
        left_at = now(), updated_at = now()
    where call_id = p_call_id and user_id = v_user_id;
  elsif v_participant.status = 'accepted' then
    update public.call_participants
    set status = case when p_outcome = 'failed' then 'failed' else 'left' end,
        left_at = now(), updated_at = now()
    where call_id = p_call_id and user_id = v_user_id;
  end if;

  perform private.refresh_voice_call_status(p_call_id);
  return p_call_id;
end;
$$;

create or replace function public.heartbeat_voice_call(p_call_id uuid, p_device_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_participant public.call_participants%rowtype;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if nullif(trim(p_device_id), '') is null or char_length(p_device_id) > 128 then
    raise exception 'A valid call device is required';
  end if;

  perform private.refresh_voice_call_status(p_call_id);
  select * into v_participant
  from public.call_participants
  where call_id = p_call_id and user_id = v_user_id
  for update;

  if not found or v_participant.status not in ('ringing', 'accepted') then return false; end if;
  if v_participant.status = 'accepted'
     and v_participant.device_id is not null
     and v_participant.device_id <> p_device_id then
    return false;
  end if;

  update public.call_participants
  set device_id = case when status = 'accepted' then coalesce(device_id, p_device_id) else device_id end,
      last_seen_at = now(), updated_at = now()
  where call_id = p_call_id and user_id = v_user_id;
  return true;
end;
$$;

create or replace function public.release_voice_call_device(p_device_id text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_call_id uuid;
  v_count integer := 0;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if nullif(trim(p_device_id), '') is null or char_length(p_device_id) > 128 then
    raise exception 'A valid call device is required';
  end if;

  for v_call_id in
    update public.call_participants cp
    set status = 'failed', left_at = now(), updated_at = now()
    from public.call_sessions cs
    where cp.call_id = cs.id
      and cp.user_id = v_user_id
      and cp.device_id = p_device_id
      and cp.status = 'accepted'
      and cs.status in ('ringing', 'accepted')
      and coalesce(cp.last_seen_at, cp.answered_at, cp.invited_at) < now() - interval '90 seconds'
    returning cp.call_id
  loop
    perform private.refresh_voice_call_status(v_call_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

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
declare v_issue_id uuid;
begin
  if p_user_id is null or p_call_id is null
     or nullif(trim(p_turn_username), '') is null
     or char_length(p_turn_username) > 512
     or p_expires_at <= now() then
    raise exception 'Invalid TURN credential issue';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('m3-turn-rate:' || p_user_id::text, 0)
  );
  if not exists (
    select 1
    from public.call_participants cp
    join public.call_sessions cs on cs.id = cp.call_id
    where cp.call_id = p_call_id and cp.user_id = p_user_id
      and cp.status in ('ringing', 'accepted')
      and cs.status in ('ringing', 'accepted')
      and (cs.status <> 'accepted' or cs.answered_at > now() - interval '60 minutes')
  ) then raise exception 'This call is unavailable for TURN'; end if;
  if (
    select count(*) from public.turn_credential_issues issue
    where issue.user_id = p_user_id and issue.issued_at >= now() - interval '1 hour'
  ) >= 10 then raise exception 'TURN credential rate limit reached'; end if;
  insert into public.turn_credential_issues (
    call_id, user_id, turn_username, expires_at
  ) values (p_call_id, p_user_id, trim(p_turn_username), p_expires_at)
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
  v_call_id uuid;
  v_count integer := 0;
begin
  for v_call_id in
    select id from public.call_sessions
    where status = 'accepted' and answered_at <= now() - interval '60 minutes'
  loop
    perform private.refresh_voice_call_status(v_call_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.start_voice_call(uuid) from public, anon, authenticated;
revoke all on function public.start_voice_call(uuid, text) from public, anon, authenticated;
revoke all on function public.respond_to_voice_call(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.end_voice_call(uuid, text) from public, anon, authenticated;
revoke all on function public.heartbeat_voice_call(uuid, text) from public, anon, authenticated;
revoke all on function public.release_voice_call_device(text) from public, anon, authenticated;
revoke all on function public.record_turn_credential_issue(uuid, uuid, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.expire_overlong_voice_calls()
  from public, anon, authenticated;
grant execute on function public.start_voice_call(uuid) to authenticated;
grant execute on function public.start_voice_call(uuid, text) to authenticated;
grant execute on function public.respond_to_voice_call(uuid, boolean, text) to authenticated;
grant execute on function public.end_voice_call(uuid, text) to authenticated;
grant execute on function public.heartbeat_voice_call(uuid, text) to authenticated;
grant execute on function public.release_voice_call_device(text) to authenticated;
grant execute on function public.record_turn_credential_issue(uuid, uuid, text, timestamptz)
  to service_role;
grant execute on function public.expire_overlong_voice_calls() to service_role;

drop policy if exists "call participants receive private signals" on realtime.messages;
drop policy if exists "call participants send private signals" on realtime.messages;
create policy "active call members receive private signals"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and left((select realtime.topic()), 8) = 'm3-call:'
    and (select private.call_participant_can_signal(
      case
        when (select realtime.topic()) ~ '^m3-call:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
          then substring((select realtime.topic()) from 9)::uuid
        else null
      end,
      (select auth.uid())
    ))
  );
create policy "active call members send private signals"
  on realtime.messages for insert to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and left((select realtime.topic()), 8) = 'm3-call:'
    and (select private.call_participant_can_signal(
      case
        when (select realtime.topic()) ~ '^m3-call:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
          then substring((select realtime.topic()) from 9)::uuid
        else null
      end,
      (select auth.uid())
    ))
  );

create or replace function private.notify_incoming_voice_call()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_call public.call_sessions%rowtype;
  v_caller_name text;
  v_conversation_title text;
begin
  if new.role <> 'invitee' or new.status <> 'ringing' then return new; end if;
  select * into v_call from public.call_sessions where id = new.call_id;
  select coalesce(nullif(btrim(p.full_name), ''), 'A member')
  into v_caller_name from public.profiles p where p.id = v_call.caller_id;
  select nullif(btrim(c.title), '') into v_conversation_title
  from public.conversations c where c.id = v_call.conversation_id;

  perform private.create_user_notification(
    new.user_id,
    'm3',
    'voice_call',
    case when v_call.call_type = 'group'
      then 'Group call from ' || coalesce(v_caller_name, 'A member')
      else 'Incoming call from ' || coalesce(v_caller_name, 'A member') end,
    case when v_call.call_type = 'group'
      then 'Tap to join ' || coalesce(v_conversation_title, 'this group') || '.'
      else 'Tap to answer this private voice call.' end,
    '/message/' || v_call.conversation_id::text,
    jsonb_build_object(
      'conversationId', v_call.conversation_id,
      'callId', v_call.id,
      'callType', v_call.call_type
    ),
    'voice-call:' || v_call.id::text || ':' || new.user_id::text
  );
  return new;
end;
$$;

revoke all on function private.notify_incoming_voice_call()
  from public, anon, authenticated;
drop trigger if exists notify_incoming_voice_call on public.call_sessions;
drop trigger if exists notify_incoming_voice_call_participant on public.call_participants;
create trigger notify_incoming_voice_call_participant
after insert on public.call_participants
for each row
when (new.role = 'invitee' and new.status = 'ringing')
execute function private.notify_incoming_voice_call();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'call_participants'
  ) then
    execute 'alter publication supabase_realtime add table public.call_participants';
  end if;
end;
$$;

commit;
