-- Run as the database owner against a seeded database. Every mutation is rolled back.
begin;
do $$
declare
  m public.messages%rowtype;
  other_user uuid;
  call_row public.call_sessions%rowtype;
  before_attachments integer;
begin
  select * into strict m from public.messages msg
  where msg.kind = 'user' and msg.deleted_at is null
    and private.conversation_is_writable(msg.conversation_id, msg.sender_id)
    and private.message_is_visible(msg.id, msg.sender_id)
    and exists (select 1 from public.conversation_members cm
      where cm.conversation_id = msg.conversation_id and cm.user_id <> msg.sender_id
        and private.message_is_visible(msg.id, cm.user_id))
  limit 1;
  select user_id into strict other_user from public.conversation_members cm
  where cm.conversation_id = m.conversation_id and cm.user_id <> m.sender_id
    and private.message_is_visible(m.id, cm.user_id) limit 1;
  select count(*) into before_attachments from public.message_attachments where message_id = m.id;

  perform set_config('request.jwt.claim.sub', other_user::text, true);
  set local role authenticated;
  perform public.delete_chat_item_for_me(m.id, 'message');
  perform public.delete_chat_item_for_me(m.id, 'message');
  if exists (select 1 from public.messages where id = m.id) then
    raise exception 'Personal deletion did not hide the message';
  end if;
  perform set_config('request.jwt.claim.sub', m.sender_id::text, true);
  if not exists (select 1 from public.messages where id = m.id) then
    raise exception 'Personal deletion hid another member copy';
  end if;
  if exists (select 1 from public.chat_item_deletions where user_id = other_user) then
    raise exception 'Another user can see personal deletion state';
  end if;
  if (select count(*) from public.message_attachments where message_id = m.id) <> before_attachments then
    raise exception 'Personal deletion removed shared media';
  end if;
  reset role;
  delete from public.chat_item_deletions where item_id = m.id;

  update public.conversation_members set last_read_at = m.created_at
  where conversation_id = m.conversation_id and user_id = other_user;
  set local role authenticated;
  begin
    perform public.delete_message(m.id);
    raise exception 'Read message deletion unexpectedly succeeded';
  exception when raise_exception then
    if sqlerrm not like '%already been read%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', other_user::text, true);
  begin
    perform public.delete_message(m.id);
    raise exception 'Recipient shared deletion unexpectedly succeeded';
  exception when raise_exception then
    if sqlerrm not like '%original sender%' then raise; end if;
  end;
  reset role;
  update public.conversation_members set last_read_at = null where conversation_id = m.conversation_id;
  perform set_config('request.jwt.claim.sub', m.sender_id::text, true);
  set local role authenticated;
  begin
    perform public.delete_message(m.id);
    if not exists (select 1 from public.messages where id = m.id and deleted_at is not null)
    then raise exception 'Shared deletion did not create tombstone'; end if;
    raise sqlstate 'ZX001';
  exception when sqlstate 'ZX001' then null; -- restore the message for the remaining checks
  end;
  reset role;

  -- Seed each non-editable message type inside its own rollback block.
  begin
    delete from public.message_attachments where message_id = m.id;
    insert into public.message_attachments(message_id, kind, sort_order, storage_path,
      file_name, mime_type, file_size, duration_seconds)
    values (m.id, 'audio', 0, m.sender_id || '/' || m.conversation_id || '/' || m.id || '/test/voice.webm',
      'voice.webm', 'audio/webm', 1024, 8);
    set local role authenticated;
    perform public.delete_message(m.id);
    if exists (select 1 from public.message_attachments where message_id = m.id)
      or not exists (select 1 from public.messages where id = m.id and deleted_at is not null)
    then raise exception 'Voice deletion failed'; end if;
    raise sqlstate 'ZX001';
  exception when sqlstate 'ZX001' then null;
  end;
  reset role;
  begin
    insert into public.message_ride_invitations(message_id, ride_id)
    select m.id, id from public.rides limit 1 on conflict do nothing;
    if not exists (select 1 from public.message_ride_invitations where message_id = m.id)
    then raise exception 'Ride invitation fixture unavailable'; end if;
    set local role authenticated;
    perform public.delete_message(m.id);
    if exists (select 1 from public.message_ride_invitations where message_id = m.id)
      or not exists (select 1 from public.messages where id = m.id and deleted_at is not null)
    then raise exception 'Ride invitation deletion failed'; end if;
    raise sqlstate 'ZX001';
  exception when sqlstate 'ZX001' then null;
  end;
  reset role;

  select * into strict call_row from public.call_sessions c
  where private.conversation_is_visible(c.conversation_id, c.caller_id)
    and exists (select 1 from public.call_participants cp
      where cp.call_id = c.id and cp.user_id <> c.caller_id
        and private.conversation_is_visible(c.conversation_id, cp.user_id)) limit 1;
  select cp.user_id into strict other_user from public.call_participants cp
  where cp.call_id = call_row.id and cp.user_id <> call_row.caller_id
    and private.conversation_is_visible(call_row.conversation_id, cp.user_id) limit 1;
  perform set_config('request.jwt.claim.sub', call_row.caller_id::text, true);
  set local role authenticated;
  perform public.delete_chat_item_for_me(call_row.id, 'call');
  if exists (select 1 from public.chat_call_history where id = call_row.id)
  then raise exception 'Hidden call remains in personal timeline'; end if;
  if not exists (select 1 from public.call_sessions where id = call_row.id)
  then raise exception 'Personal deletion disrupted underlying call access'; end if;
  perform set_config('request.jwt.claim.sub', other_user::text, true);
  if not exists (select 1 from public.chat_call_history where id = call_row.id)
  then raise exception 'Personal deletion hid the other participant call'; end if;
  reset role;
end;
$$;
rollback;
select 'PASS: personal message/call isolation, media preservation, retry, read lock, ownership, text/voice/invitation shared deletion' as verification;
