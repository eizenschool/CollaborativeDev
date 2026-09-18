-- Module 3: terminal conversation management and retained call-history visibility.

begin;

create or replace function public.archive_conversation(p_conversation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_conversation public.conversations%rowtype;
begin
  select * into v_conversation
  from public.conversations
  where id = p_conversation_id
  for update;

  if v_user_id is null or not found
     or v_conversation.type <> 'direct'
     or v_conversation.ride_status not in ('Completed', 'Cancelled', 'Expired')
     or not (select private.conversation_is_visible(p_conversation_id, v_user_id)) then
    raise exception 'Only an ended private conversation can be archived';
  end if;

  update public.conversation_members
  set archived_at = coalesce(archived_at, now())
  where conversation_id = p_conversation_id
    and user_id = v_user_id
    and left_at is null;

  return found;
end;
$$;

create or replace function public.leave_group_conversation(p_conversation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_conversation public.conversations%rowtype;
  v_role text;
  v_name text;
  v_message_id uuid;
begin
  select * into v_conversation
  from public.conversations
  where id = p_conversation_id
  for update;

  if v_user_id is null or not found
     or v_conversation.type <> 'group'
     or v_conversation.ride_status not in ('Completed', 'Cancelled', 'Expired') then
    raise exception 'Only an ended group conversation can be left';
  end if;

  select role into v_role
  from public.conversation_members
  where conversation_id = p_conversation_id
    and user_id = v_user_id
    and left_at is null
  for update;

  if not found then
    raise exception 'This group conversation is unavailable';
  end if;
  if v_role <> 'traveller' then
    raise exception 'The ride Host cannot leave the trip group';
  end if;

  select full_name into v_name
  from public.profiles
  where id = v_user_id;

  update public.conversation_members
  set left_at = now(), archived_at = null
  where conversation_id = p_conversation_id
    and user_id = v_user_id;

  insert into public.messages (conversation_id, sender_id, kind, text_content)
  values (p_conversation_id, null, 'system', coalesce(v_name, 'A member') || ' left the group.')
  returning id into v_message_id;

  update public.conversations
  set last_message_id = v_message_id,
      last_message_at = now(),
      updated_at = now()
  where id = p_conversation_id;

  return v_message_id;
end;
$$;

revoke all on function public.archive_conversation(uuid) from public, anon, authenticated;
revoke all on function public.leave_group_conversation(uuid) from public, anon, authenticated;
grant execute on function public.archive_conversation(uuid) to authenticated;
grant execute on function public.leave_group_conversation(uuid) to authenticated;

drop policy if exists "call participants read their calls" on public.call_sessions;
create policy "visible conversation participants read their calls"
  on public.call_sessions for select to authenticated
  using (
    (select auth.uid()) in (caller_id, callee_id)
    and (select private.conversation_is_visible(conversation_id, (select auth.uid())))
  );

commit;
