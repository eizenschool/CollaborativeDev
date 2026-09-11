-- Voice messages and Ride invitations share the ownership/read-state deletion gate.
begin;

create or replace function public.delete_message(p_message_id uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_message public.messages%rowtype;
  v_paths text[];
begin
  select * into v_message
  from public.messages
  where id = p_message_id
  for update;

  if v_user_id is null or not found or v_message.sender_id <> v_user_id
     or v_message.kind <> 'user' or v_message.deleted_at is not null then
    raise exception 'Only the original sender may delete this message';
  end if;
  perform 1
  from public.conversations c
  join public.conversation_members cm on cm.conversation_id = c.id
  where c.id = v_message.conversation_id
    and cm.user_id = v_user_id
    and cm.left_at is null
    and private.conversation_is_writable(c.id, v_user_id)
    and private.message_is_visible(p_message_id, v_user_id)
    and (c.expires_at is null or c.expires_at > now())
  for update of c, cm;
  if not found then
    raise exception 'This conversation is read-only or unavailable';
  end if;

  -- Serialize against mark_conversation_read, as edit_message does.
  perform 1 from public.conversation_members cm
  where cm.conversation_id = v_message.conversation_id
  order by cm.user_id for update;
  if exists (select 1 from public.conversation_members cm
    where cm.conversation_id = v_message.conversation_id
      and cm.user_id <> v_user_id and cm.last_read_at >= v_message.created_at)
  then raise exception 'This message has already been read and cannot be deleted for everyone'; end if;
  select coalesce(array_agg(storage_path) filter (where storage_path is not null), '{}')
  into v_paths
  from public.message_attachments
  where message_id = p_message_id;

  delete from public.message_attachments where message_id = p_message_id;
  delete from public.message_ride_invitations where message_id = p_message_id;
  update public.messages
  set text_content = null, deleted_at = now(), edited_at = null
  where id = p_message_id;

  return v_paths;
end;
$$;

commit;
