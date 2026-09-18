-- Module 3: secure one-to-one voice-call invitations plus private WebRTC signalling.
-- Audio never enters Postgres or Supabase Storage; WebRTC peers exchange it directly.

begin;

create table public.call_sessions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  caller_id uuid not null references public.profiles(id) on delete cascade,
  callee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'ringing' check (
    status in ('ringing', 'accepted', 'declined', 'cancelled', 'ended', 'missed', 'failed')
  ),
  answer_device_id text,
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint call_sessions_distinct_participants check (caller_id <> callee_id),
  constraint call_sessions_answer_device_length check (
    answer_device_id is null or char_length(answer_device_id) between 1 and 128
  )
);

create index call_sessions_caller_status_idx
  on public.call_sessions (caller_id, status, created_at desc);
create index call_sessions_callee_status_idx
  on public.call_sessions (callee_id, status, created_at desc);
create index call_sessions_conversation_created_idx
  on public.call_sessions (conversation_id, created_at desc);

alter table public.call_sessions enable row level security;
alter table public.call_sessions replica identity full;

create policy "call participants read their calls"
  on public.call_sessions for select to authenticated
  using ((select auth.uid()) in (caller_id, callee_id));

revoke all on table public.call_sessions from public, anon, authenticated;
grant select on table public.call_sessions to authenticated;

create or replace function public.start_voice_call(p_conversation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_callee_id uuid;
  v_call_id uuid;
begin
  if v_user_id is null then
    raise exception 'Sign in before starting a voice call';
  end if;

  select other_member.user_id
  into v_callee_id
  from public.conversations c
  join public.conversation_members current_member
    on current_member.conversation_id = c.id
   and current_member.user_id = v_user_id
   and current_member.left_at is null
   and current_member.archived_at is null
  join public.conversation_members other_member
    on other_member.conversation_id = c.id
   and other_member.user_id <> v_user_id
   and other_member.left_at is null
   and other_member.archived_at is null
  where c.id = p_conversation_id
    and c.type = 'direct'
    and (c.expires_at is null or c.expires_at > now())
  order by other_member.user_id
  limit 1;

  if v_callee_id is null then
    raise exception 'This private chat is unavailable for calling';
  end if;

  -- Serialize both identities in stable order so simultaneous cross-calls cannot
  -- create two active sessions for the same pair.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(least(v_user_id::text, v_callee_id::text), 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(greatest(v_user_id::text, v_callee_id::text), 0)
  );

  update public.call_sessions
  set status = 'missed', ended_at = now(), updated_at = now()
  where status = 'ringing'
    and created_at < now() - interval '45 seconds'
    and (
      caller_id in (v_user_id, v_callee_id)
      or callee_id in (v_user_id, v_callee_id)
    );

  update public.call_sessions
  set status = 'failed', ended_at = now(), updated_at = now()
  where status = 'accepted'
    and answered_at < now() - interval '60 minutes'
    and (
      caller_id in (v_user_id, v_callee_id)
      or callee_id in (v_user_id, v_callee_id)
    );

  if exists (
    select 1
    from public.call_sessions active_call
    where active_call.status in ('ringing', 'accepted')
      and (
        active_call.caller_id in (v_user_id, v_callee_id)
        or active_call.callee_id in (v_user_id, v_callee_id)
      )
  ) then
    raise exception 'One of you is already on another call';
  end if;

  insert into public.call_sessions (conversation_id, caller_id, callee_id)
  values (p_conversation_id, v_user_id, v_callee_id)
  returning id into v_call_id;

  return v_call_id;
end;
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
begin
  select * into v_call
  from public.call_sessions
  where id = p_call_id
  for update;

  if v_user_id is null or not found or v_call.callee_id <> v_user_id then
    raise exception 'This incoming call is unavailable';
  end if;
  if v_call.status <> 'ringing' then
    raise exception 'This call is no longer ringing';
  end if;
  if not (select private.conversation_is_writable(v_call.conversation_id, v_user_id)) then
    raise exception 'This private chat is unavailable for calling';
  end if;

  if v_call.created_at < now() - interval '45 seconds' then
    update public.call_sessions
    set status = 'missed', ended_at = now(), updated_at = now()
    where id = p_call_id;
    return p_call_id;
  end if;

  if p_accept then
    if nullif(trim(p_answer_device_id), '') is null
       or char_length(p_answer_device_id) > 128 then
      raise exception 'A valid answering device is required';
    end if;
    update public.call_sessions
    set status = 'accepted',
        answer_device_id = p_answer_device_id,
        answered_at = now(),
        updated_at = now()
    where id = p_call_id;
  else
    update public.call_sessions
    set status = 'declined', ended_at = now(), updated_at = now()
    where id = p_call_id;
  end if;

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
begin
  if p_outcome not in ('cancelled', 'ended', 'missed', 'failed') then
    raise exception 'Unsupported call outcome';
  end if;

  select * into v_call
  from public.call_sessions
  where id = p_call_id
  for update;

  if v_user_id is null or not found
     or v_user_id not in (v_call.caller_id, v_call.callee_id) then
    raise exception 'This call is unavailable';
  end if;
  if v_call.status in ('declined', 'cancelled', 'ended', 'missed', 'failed') then
    return p_call_id;
  end if;
  if v_call.status = 'ringing' and p_outcome not in ('cancelled', 'missed', 'failed') then
    raise exception 'A ringing call can only be cancelled or missed';
  end if;
  if v_call.status = 'accepted' and p_outcome not in ('ended', 'failed') then
    raise exception 'An accepted call can only be ended or failed';
  end if;

  update public.call_sessions
  set status = p_outcome,
      ended_at = now(),
      updated_at = now()
  where id = p_call_id;

  return p_call_id;
end;
$$;

revoke all on function public.start_voice_call(uuid) from public, anon, authenticated;
revoke all on function public.respond_to_voice_call(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.end_voice_call(uuid, text) from public, anon, authenticated;
grant execute on function public.start_voice_call(uuid) to authenticated;
grant execute on function public.respond_to_voice_call(uuid, boolean, text) to authenticated;
grant execute on function public.end_voice_call(uuid, text) to authenticated;

-- Supabase Realtime Authorization evaluates these policies when a client joins
-- the private `m3-call:<call id>` Broadcast topic. Only the two participants of
-- a currently active call can receive or send WebRTC descriptions/candidates.
create policy "call participants receive private signals"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and exists (
      select 1
      from public.call_sessions cs
      where (select realtime.topic()) = 'm3-call:' || cs.id::text
        and (select auth.uid()) in (cs.caller_id, cs.callee_id)
        and cs.status in ('ringing', 'accepted')
    )
  );

create policy "call participants send private signals"
  on realtime.messages for insert to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and exists (
      select 1
      from public.call_sessions cs
      where (select realtime.topic()) = 'm3-call:' || cs.id::text
        and (select auth.uid()) in (cs.caller_id, cs.callee_id)
        and cs.status in ('ringing', 'accepted')
    )
  );

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'call_sessions'
  ) then
    execute 'alter publication supabase_realtime add table public.call_sessions';
  end if;
end;
$$;

commit;
