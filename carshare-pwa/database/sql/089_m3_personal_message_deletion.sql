-- Account-local timeline deletions; shared deletion has the same eligibility as Edit.
begin;

create table public.chat_item_deletions (
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  item_type text not null check (item_type in ('message', 'call')),
  item_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, item_type, item_id)
);
create index chat_item_deletions_conversation_idx on public.chat_item_deletions(conversation_id);
alter table public.chat_item_deletions enable row level security;
revoke all on public.chat_item_deletions from public, anon, authenticated;
grant select on public.chat_item_deletions to authenticated;
create policy "Members read only their own timeline deletions"
  on public.chat_item_deletions for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.delete_chat_item_for_me(p_item_id uuid, p_item_type text)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_conversation_id uuid;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_item_type = 'message' then
    select m.conversation_id into v_conversation_id from public.messages m
    where m.id = p_item_id and private.message_is_visible(m.id, v_user_id);
  elsif p_item_type = 'call' then
    select c.conversation_id into v_conversation_id from public.call_sessions c
    where c.id = p_item_id and private.call_participant_can_read(c.id, v_user_id);
  else
    raise exception 'Choose a message or call record';
  end if;
  if v_conversation_id is null then
    -- Retrying a successful personal deletion is harmless.
    if exists (select 1 from public.chat_item_deletions d
      where d.user_id = v_user_id and d.item_type = p_item_type and d.item_id = p_item_id)
    then return true; end if;
    raise exception 'Chat item unavailable';
  end if;
  insert into public.chat_item_deletions(user_id, conversation_id, item_type, item_id)
  values (v_user_id, v_conversation_id, p_item_type, p_item_id)
  on conflict do nothing;
  return true;
end;
$$;
revoke all on function public.delete_chat_item_for_me(uuid, text) from public, anon, authenticated;
grant execute on function public.delete_chat_item_for_me(uuid, text) to authenticated;

-- This view filters timeline reads only; active call/signalling access stays intact.
create view public.chat_call_history with (security_invoker = true) as
select c.* from public.call_sessions c
where not exists (
  select 1 from public.chat_item_deletions d
  where d.user_id = (select auth.uid()) and d.item_type = 'call' and d.item_id = c.id
);
revoke all on public.chat_call_history from public, anon, authenticated;
grant select on public.chat_call_history to authenticated;

alter publication supabase_realtime add table public.chat_item_deletions;

-- Updated visibility and shared-deletion functions follow below.

create or replace function private.message_is_visible(
  p_message_id uuid,
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
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    join public.conversation_members cm
      on cm.conversation_id = m.conversation_id and cm.user_id = p_user_id
    where m.id = p_message_id
      and not exists (select 1 from public.chat_item_deletions d
        where d.user_id = p_user_id and d.item_type = 'message' and d.item_id = m.id)
      and (c.expires_at is null or c.expires_at > now())
      and (cm.deleted_before is null or m.created_at > cm.deleted_before)
      and (
        cm.left_at is null
        or (
          cm.access_expires_at > now()
          and m.created_at <= cm.left_at
        )
      )
  );
$$;

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
  if exists (select 1 from public.message_attachments ma
    where ma.message_id = p_message_id and ma.kind = 'audio')
    or exists (select 1 from public.message_ride_invitations ri where ri.message_id = p_message_id)
  then raise exception 'Only editable messages can be deleted for everyone'; end if;

  select coalesce(array_agg(storage_path) filter (where storage_path is not null), '{}')
  into v_paths
  from public.message_attachments
  where message_id = p_message_id;

  delete from public.message_attachments where message_id = p_message_id;
  update public.messages
  set text_content = null, deleted_at = now(), edited_at = null
  where id = p_message_id;

  return v_paths;
end;
$$;

commit;
