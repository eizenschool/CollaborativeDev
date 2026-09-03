-- Mobile browsers throttle main-thread timers and can suspend a backgrounded
-- PWA. Keep an accepted group member recoverable long enough for foreground
-- and Realtime reconnection heartbeats instead of ejecting them after 90s.

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
    and coalesce(last_seen_at, answered_at, invited_at) <= now() - interval '5 minutes';

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
      and coalesce(cp.last_seen_at, cp.answered_at, cp.invited_at) < now() - interval '5 minutes'
    returning cp.call_id
  loop
    perform private.refresh_voice_call_status(v_call_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.release_voice_call_device(text)
  from public, anon, authenticated;
grant execute on function public.release_voice_call_device(text) to authenticated;
