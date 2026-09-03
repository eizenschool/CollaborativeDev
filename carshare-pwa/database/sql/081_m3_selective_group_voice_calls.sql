-- Module 3: let a group-call caller choose exactly which active members ring.
-- The caller is always included. Direct calls keep their existing behaviour.

begin;

create or replace function public.start_selective_voice_call(
  p_conversation_id uuid,
  p_caller_device_id text,
  p_invitee_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_conversation_type text;
  v_all_member_ids uuid[];
  v_invitee_ids uuid[];
  v_call_member_ids uuid[];
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
  into v_conversation_type, v_all_member_ids
  from public.conversations c
  join public.conversation_members cm
    on cm.conversation_id = c.id and cm.left_at is null
  join public.profiles p on p.id = cm.user_id and p.status = 'active'
  where c.id = p_conversation_id
    and c.type in ('direct', 'group')
  group by c.type;

  if v_all_member_ids is null or not (v_user_id = any(v_all_member_ids)) then
    raise exception 'This conversation is unavailable for calling';
  end if;

  if v_conversation_type = 'direct' then
    if array_length(v_all_member_ids, 1) <> 2 then
      raise exception 'This private chat is unavailable for calling';
    end if;
    select member_id into v_callee_id
    from unnest(v_all_member_ids) member_id
    where member_id <> v_user_id
    limit 1;
    v_invitee_ids := array[v_callee_id];
  else
    if p_invitee_ids is null or cardinality(p_invitee_ids) = 0 then
      raise exception 'Select at least one group member to call';
    end if;
    if v_user_id = any(p_invitee_ids) then
      raise exception 'Do not include yourself in the selected members';
    end if;
    if array_position(p_invitee_ids, null) is not null then
      raise exception 'One or more selected members are unavailable';
    end if;
    select array_agg(distinct invitee_id order by invitee_id)
    into v_invitee_ids
    from unnest(p_invitee_ids) invitee_id;
    if cardinality(v_invitee_ids) > 7 then
      raise exception 'Group voice calls support up to 8 participants';
    end if;
    if exists (
      select 1 from unnest(v_invitee_ids) invitee_id
      where not (invitee_id = any(v_all_member_ids))
    ) then
      raise exception 'One or more selected members are unavailable';
    end if;
  end if;

  v_call_member_ids := array_prepend(v_user_id, v_invitee_ids);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('m3-call-room:' || p_conversation_id::text, 0)
  );
  perform private.expire_stale_voice_calls(v_call_member_ids);

  if exists (
    select 1
    from public.call_participants cp
    join public.call_sessions cs on cs.id = cp.call_id
    where cp.user_id = any(v_call_member_ids)
      and cp.status = 'accepted'
      and cs.status in ('ringing', 'accepted')
  ) then
    raise exception 'One selected member is already on another call';
  end if;

  if exists (
    select 1 from public.call_sessions cs
    where cs.conversation_id = p_conversation_id
      and cs.status in ('ringing', 'accepted')
  ) then
    raise exception 'A call is already active in this conversation';
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
  from unnest(v_call_member_ids) member_id;

  return v_call_id;
end;
$$;

revoke all on function public.start_selective_voice_call(uuid, text, uuid[])
  from public, anon, authenticated;
grant execute on function public.start_selective_voice_call(uuid, text, uuid[])
  to authenticated;

commit;
