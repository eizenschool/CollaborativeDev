-- Module 3: recover voice calls left active after refresh, tab closure, crash,
-- or a lost WebRTC session without unlocking calls that are alive elsewhere.

begin;

alter table public.call_sessions
  add column caller_device_id text,
  add column caller_last_seen_at timestamptz,
  add column callee_last_seen_at timestamptz,
  add constraint call_sessions_caller_device_length check (
    caller_device_id is null or char_length(caller_device_id) between 1 and 128
  );

create index call_sessions_active_presence_idx
  on public.call_sessions (status, caller_last_seen_at, callee_last_seen_at)
  where status in ('ringing', 'accepted');

create or replace function private.expire_stale_voice_calls(p_user_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_changed integer;
begin
  update public.call_sessions
  set status = case when status = 'ringing' then 'missed' else 'failed' end,
      ended_at = now(),
      updated_at = now()
  where status in ('ringing', 'accepted')
    and (caller_id = any(p_user_ids) or callee_id = any(p_user_ids))
    and (
      (status = 'ringing' and created_at < now() - interval '45 seconds')
      or (
        status = 'accepted'
        and (
          answered_at is null
          or greatest(
            coalesce(caller_last_seen_at, answered_at, created_at),
            coalesce(callee_last_seen_at, answered_at, created_at)
          ) < now() - interval '90 seconds'
        )
      )
    );
  get diagnostics v_changed = row_count;
  return v_changed;
end;
$$;
revoke all on function private.expire_stale_voice_calls(uuid[])
  from public, anon, authenticated;

create or replace function private.start_voice_call_with_presence(
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
  v_callee_id uuid;
  v_call_id uuid;
begin
  if v_user_id is null then raise exception 'Sign in before starting a voice call'; end if;
  if p_caller_device_id is not null
     and (nullif(trim(p_caller_device_id), '') is null or char_length(p_caller_device_id) > 128) then
    raise exception 'A valid calling device is required';
  end if;

  select other_member.user_id into v_callee_id
  from public.conversations c
  join public.conversation_members current_member
    on current_member.conversation_id = c.id
   and current_member.user_id = v_user_id
   and current_member.left_at is null
  join public.conversation_members other_member
    on other_member.conversation_id = c.id
   and other_member.user_id <> v_user_id
   and other_member.left_at is null
  where c.id = p_conversation_id
    and c.type = 'direct'
    and (select private.conversation_is_writable(c.id, v_user_id))
  order by other_member.user_id
  limit 1;

  if v_callee_id is null then
    raise exception 'This private chat is unavailable for calling';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(least(v_user_id::text, v_callee_id::text), 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(greatest(v_user_id::text, v_callee_id::text), 0)
  );

  perform private.expire_stale_voice_calls(array[v_user_id, v_callee_id]);

  if exists (
    select 1 from public.call_sessions active_call
    where active_call.status in ('ringing', 'accepted')
      and (
        active_call.caller_id in (v_user_id, v_callee_id)
        or active_call.callee_id in (v_user_id, v_callee_id)
      )
  ) then
    raise exception 'One of you is already on another call';
  end if;

  insert into public.call_sessions (
    conversation_id, caller_id, callee_id, caller_device_id, caller_last_seen_at
  ) values (
    p_conversation_id, v_user_id, v_callee_id, nullif(trim(p_caller_device_id), ''), now()
  ) returning id into v_call_id;

  update public.conversation_members
  set archived_at = null
  where conversation_id = p_conversation_id and user_id = v_user_id;

  return v_call_id;
end;
$$;
revoke all on function private.start_voice_call_with_presence(uuid, text)
  from public, anon, authenticated;

-- Preserve the old signature for already-open clients while new clients bind
-- the invitation to their tab-scoped device identifier.
create or replace function public.start_voice_call(p_conversation_id uuid)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select private.start_voice_call_with_presence(p_conversation_id, null);
$$;

create or replace function public.start_voice_call(
  p_conversation_id uuid,
  p_caller_device_id text
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select private.start_voice_call_with_presence(p_conversation_id, p_caller_device_id);
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
  select * into v_call from public.call_sessions where id = p_call_id for update;
  if v_user_id is null or not found or v_call.callee_id <> v_user_id then
    raise exception 'This incoming call is unavailable';
  end if;
  if v_call.status <> 'ringing' then raise exception 'This call is no longer ringing'; end if;
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
    if nullif(trim(p_answer_device_id), '') is null or char_length(p_answer_device_id) > 128 then
      raise exception 'A valid answering device is required';
    end if;
    update public.call_sessions
    set status = 'accepted',
        answer_device_id = p_answer_device_id,
        answered_at = now(),
        callee_last_seen_at = now(),
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

create or replace function public.heartbeat_voice_call(p_call_id uuid, p_device_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_call public.call_sessions%rowtype;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if nullif(trim(p_device_id), '') is null or char_length(p_device_id) > 128 then
    raise exception 'A valid call device is required';
  end if;
  select * into v_call from public.call_sessions where id = p_call_id for update;
  if not found or v_user_id not in (v_call.caller_id, v_call.callee_id) then
    raise exception 'This call is unavailable';
  end if;
  if v_call.status not in ('ringing', 'accepted') then return false; end if;

  if v_user_id = v_call.caller_id then
    if v_call.caller_device_id is not null and v_call.caller_device_id <> p_device_id then
      return false;
    end if;
    update public.call_sessions
    set caller_device_id = coalesce(caller_device_id, p_device_id),
        caller_last_seen_at = now()
    where id = p_call_id;
  else
    if v_call.status = 'accepted' and v_call.answer_device_id is distinct from p_device_id then
      return false;
    end if;
    update public.call_sessions set callee_last_seen_at = now() where id = p_call_id;
  end if;
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
  v_changed integer;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if nullif(trim(p_device_id), '') is null or char_length(p_device_id) > 128 then
    raise exception 'A valid call device is required';
  end if;

  perform private.expire_stale_voice_calls(array[v_user_id]);
  update public.call_sessions
  set status = case when status = 'ringing' then 'cancelled' else 'failed' end,
      ended_at = now(),
      updated_at = now()
  where status in ('ringing', 'accepted')
    and (
      (
        caller_id = v_user_id
        and (
          caller_device_id = p_device_id
          or (
            caller_device_id is null
            and coalesce(caller_last_seen_at, answered_at, created_at)
              < now() - interval '90 seconds'
          )
        )
      )
      or (
        callee_id = v_user_id
        and status = 'accepted'
        and answer_device_id = p_device_id
      )
    );
  get diagnostics v_changed = row_count;
  return v_changed;
end;
$$;

revoke all on function public.start_voice_call(uuid) from public, anon, authenticated;
revoke all on function public.start_voice_call(uuid, text) from public, anon, authenticated;
revoke all on function public.respond_to_voice_call(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.heartbeat_voice_call(uuid, text) from public, anon, authenticated;
revoke all on function public.release_voice_call_device(text) from public, anon, authenticated;
grant execute on function public.start_voice_call(uuid) to authenticated;
grant execute on function public.start_voice_call(uuid, text) to authenticated;
grant execute on function public.respond_to_voice_call(uuid, boolean, text) to authenticated;
grant execute on function public.heartbeat_voice_call(uuid, text) to authenticated;
grant execute on function public.release_voice_call_device(text) to authenticated;

commit;
