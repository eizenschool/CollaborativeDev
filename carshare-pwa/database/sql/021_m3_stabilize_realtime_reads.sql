-- Module 3: make read receipts idempotent so Realtime refreshes cannot create
-- a conversation_members UPDATE loop across connected chat clients.

create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_latest timestamptz;
begin
  if v_user_id is null
     or not (select private.conversation_is_visible(p_conversation_id, v_user_id)) then
    raise exception 'Conversation unavailable';
  end if;

  select max(created_at) into v_latest
  from public.messages
  where conversation_id = p_conversation_id
    and sender_id is distinct from v_user_id;

  if v_latest is null then
    return false;
  end if;

  update public.conversation_members
  set last_read_at = v_latest
  where conversation_id = p_conversation_id
    and user_id = v_user_id
    and (last_read_at is null or last_read_at < v_latest);

  return found;
end;
$$;

revoke all on function public.mark_conversation_read(uuid) from public, anon, authenticated;
grant execute on function public.mark_conversation_read(uuid) to authenticated;
