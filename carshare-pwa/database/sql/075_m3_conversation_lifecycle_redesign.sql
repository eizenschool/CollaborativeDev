-- Module 3: terminal conversation folders, personal deletion, muting, and
-- seven-day retained history for cancelled accepted Travellers.
--
-- This migration is intentionally based on the deployed ride-bound schema
-- through 065_m3. It replaces the earlier, undeployed pair-owned draft of 075.

begin;

alter table public.conversation_members
  add column if not exists deleted_before timestamptz,
  add column if not exists access_expires_at timestamptz,
  add column if not exists muted_at timestamptz;

alter table public.conversation_members
  drop constraint if exists conversation_members_archive_check;
alter table public.conversation_members
  drop constraint if exists conversation_members_retained_access_check;
alter table public.conversation_members
  add constraint conversation_members_retained_access_check check (
    (left_at is null and access_expires_at is null)
    or (left_at is not null and access_expires_at > left_at)
  );

create index if not exists conversation_members_personal_state_idx
  on public.conversation_members
  (user_id, archived_at, muted_at, access_expires_at, conversation_id);

-- Backfill a retained, read-only membership for accepted Travellers who had
-- already cancelled their own request. Do not retire somebody who was later
-- accepted again for the same Ride.
with latest_requester_cancellations as (
  select rr.ride_id, rr.requester_id, max(rr.cancelled_at) as cancelled_at
  from public.ride_requests rr
  where rr.status = 'Cancelled'
    and rr.cancelled_by = 'Requester'
    and rr.accepted_at is not null
    and rr.cancelled_at is not null
    and not exists (
      select 1 from public.ride_requests active_request
      where active_request.ride_id = rr.ride_id
        and active_request.requester_id = rr.requester_id
        and active_request.status = 'Accepted'
    )
  group by rr.ride_id, rr.requester_id
)
update public.conversation_members cm
set left_at = cancellation.cancelled_at,
    access_expires_at = cancellation.cancelled_at + interval '7 days',
    archived_at = null
from public.conversations c, latest_requester_cancellations cancellation
where c.id = cm.conversation_id
  and c.type = 'group'
  and c.ride_id = cancellation.ride_id
  and cm.user_id = cancellation.requester_id
  and cm.left_at is null;

create or replace function private.conversation_is_visible(
  p_conversation_id uuid,
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
    from public.conversation_members cm
    join public.conversations c on c.id = cm.conversation_id
    where cm.conversation_id = p_conversation_id
      and cm.user_id = p_user_id
      and (c.expires_at is null or c.expires_at > now())
      and (
        cm.left_at is null
        or cm.access_expires_at > now()
      )
  );
$$;

create or replace function private.conversation_is_writable(
  p_conversation_id uuid,
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
    from public.conversation_members cm
    join public.conversations c on c.id = cm.conversation_id
    where cm.conversation_id = p_conversation_id
      and cm.user_id = p_user_id
      and cm.left_at is null
      and (c.expires_at is null or c.expires_at > now())
      and not (
        c.type = 'group'
        and c.ride_status in ('Cancelled', 'Expired')
      )
  );
$$;

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
  select exists (
    select 1
    from public.call_sessions cs
    join public.conversations c on c.id = cs.conversation_id
    join public.conversation_members cm
      on cm.conversation_id = cs.conversation_id and cm.user_id = p_user_id
    where cs.id = p_call_id
      and p_user_id in (cs.caller_id, cs.callee_id)
      and (c.expires_at is null or c.expires_at > now())
      and (cm.deleted_before is null or cs.created_at > cm.deleted_before)
      and (
        cm.left_at is null
        or (
          cm.access_expires_at > now()
          and cs.created_at <= cm.left_at
        )
      )
  );
$$;

revoke all on function private.conversation_is_visible(uuid, uuid)
  from public, anon, authenticated;
revoke all on function private.conversation_is_writable(uuid, uuid)
  from public, anon, authenticated;
revoke all on function private.message_is_visible(uuid, uuid)
  from public, anon, authenticated;
revoke all on function private.call_is_visible(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.conversation_is_visible(uuid, uuid) to authenticated;
grant execute on function private.conversation_is_writable(uuid, uuid) to authenticated;
grant execute on function private.message_is_visible(uuid, uuid) to authenticated;
grant execute on function private.call_is_visible(uuid, uuid) to authenticated;

drop policy if exists "members read conversation memberships" on public.conversation_members;
create policy "members read conversation memberships"
  on public.conversation_members for select to authenticated
  using (
    (select private.conversation_is_visible(conversation_id, (select auth.uid())))
    and (left_at is null or user_id = (select auth.uid()))
  );

drop policy if exists "members read visible messages" on public.messages;
drop policy if exists "members read personally visible messages" on public.messages;
create policy "members read personally visible messages"
  on public.messages for select to authenticated
  using ((select private.message_is_visible(id, (select auth.uid()))));

drop policy if exists "members read visible attachments" on public.message_attachments;
drop policy if exists "members read personally visible attachments" on public.message_attachments;
create policy "members read personally visible attachments"
  on public.message_attachments for select to authenticated
  using ((select private.message_is_visible(message_id, (select auth.uid()))));

drop policy if exists "members read visible message translations" on public.message_translations;
drop policy if exists "members read personally visible message translations" on public.message_translations;
create policy "members read personally visible message translations"
  on public.message_translations for select to authenticated
  using (
    exists (
      select 1 from public.messages m
      where m.id = message_translations.message_id
        and m.deleted_at is null
        and (select private.message_is_visible(m.id, (select auth.uid())))
    )
  );

drop policy if exists "call participants read their calls" on public.call_sessions;
drop policy if exists "visible conversation participants read their calls" on public.call_sessions;
drop policy if exists "participants read personally visible calls" on public.call_sessions;
create policy "participants read personally visible calls"
  on public.call_sessions for select to authenticated
  using ((select private.call_is_visible(id, (select auth.uid()))));

drop policy if exists "members download committed message media" on storage.objects;
create policy "members download committed message media"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'message-media'
    and storage.allow_any_operation(array[
      'storage.object.sign',
      'storage.object.sign_many',
      'storage.object.get_authenticated_info',
      'storage.object.get_authenticated'
    ])
    and exists (
      select 1
      from public.message_attachments ma
      join public.messages m on m.id = ma.message_id
      where ma.storage_path = storage.objects.name
        and (select private.message_is_visible(m.id, (select auth.uid())))
    )
  );

create or replace function public.archive_conversation(p_conversation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null or not exists (
    select 1 from public.conversations c
    where c.id = p_conversation_id
      and c.ride_status in ('Completed', 'Cancelled', 'Expired')
      and (select private.conversation_is_visible(c.id, v_user_id))
  ) then raise exception 'Only an ended conversation can be archived'; end if;
  update public.conversation_members
  set archived_at = coalesce(archived_at, now())
  where conversation_id = p_conversation_id and user_id = v_user_id;
  return found;
end;
$$;

create or replace function public.unarchive_conversation(p_conversation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null or not exists (
    select 1 from public.conversations c
    where c.id = p_conversation_id
      and c.ride_status in ('Completed', 'Cancelled', 'Expired')
      and (select private.conversation_is_visible(c.id, v_user_id))
  ) then raise exception 'Only an ended conversation can be unarchived'; end if;
  update public.conversation_members set archived_at = null
  where conversation_id = p_conversation_id and user_id = v_user_id;
  return found;
end;
$$;

create or replace function public.delete_conversation_for_me(p_conversation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null or not exists (
    select 1 from public.conversations c
    where c.id = p_conversation_id
      and c.ride_status in ('Completed', 'Cancelled', 'Expired')
      and (select private.conversation_is_visible(c.id, v_user_id))
  ) then raise exception 'Only an ended conversation can be deleted for you'; end if;
  update public.conversation_members
  set deleted_before = now(), archived_at = null, last_read_at = now()
  where conversation_id = p_conversation_id and user_id = v_user_id;
  return found;
end;
$$;

create or replace function public.set_conversation_muted(
  p_conversation_id uuid,
  p_muted boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null or not exists (
    select 1 from public.conversations c
    where c.id = p_conversation_id
      and c.ride_status in ('Completed', 'Cancelled', 'Expired')
      and (select private.conversation_is_visible(c.id, v_user_id))
  ) then raise exception 'Only an ended conversation can be muted'; end if;
  update public.conversation_members
  set muted_at = case when p_muted then coalesce(muted_at, now()) else null end
  where conversation_id = p_conversation_id and user_id = v_user_id;
  return found;
end;
$$;

revoke all on function public.archive_conversation(uuid) from public, anon, authenticated;
revoke all on function public.unarchive_conversation(uuid) from public, anon, authenticated;
revoke all on function public.delete_conversation_for_me(uuid) from public, anon, authenticated;
revoke all on function public.set_conversation_muted(uuid, boolean) from public, anon, authenticated;
grant execute on function public.archive_conversation(uuid) to authenticated;
grant execute on function public.unarchive_conversation(uuid) to authenticated;
grant execute on function public.delete_conversation_for_me(uuid) to authenticated;
grant execute on function public.set_conversation_muted(uuid, boolean) to authenticated;

-- Manual Leave is removed. Request cancellation owns membership departure.
revoke all on function public.leave_group_conversation(uuid)
  from public, anon, authenticated;

create or replace function private.sync_cancelled_request_group_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation_id uuid;
  v_message_id uuid;
  v_name text;
  v_left_at timestamptz;
begin
  if new.status = 'Accepted' and old.status is distinct from new.status then
    update public.conversation_members cm
    set left_at = null, access_expires_at = null, archived_at = null
    from public.conversations c
    where c.id = cm.conversation_id
      and c.type = 'group'
      and c.ride_id = new.ride_id
      and cm.user_id = new.requester_id;
  elsif old.status = 'Accepted'
     and new.status = 'Cancelled'
     and new.cancelled_by = 'Requester' then
    v_left_at := coalesce(new.cancelled_at, now());
    select id into v_conversation_id
    from public.conversations
    where ride_id = new.ride_id and type = 'group';
    if v_conversation_id is not null then
      update public.conversation_members
      set left_at = v_left_at,
          access_expires_at = v_left_at + interval '7 days',
          archived_at = null,
          last_read_at = v_left_at
      where conversation_id = v_conversation_id and user_id = new.requester_id;
      select coalesce(nullif(btrim(full_name), ''), 'A Traveller') into v_name
      from public.profiles where id = new.requester_id;
      insert into public.messages (conversation_id, sender_id, kind, text_content)
      values (
        v_conversation_id, null, 'system',
        coalesce(v_name, 'A Traveller') || ' cancelled their ride request and left the group.'
      ) returning id into v_message_id;
      update public.conversations
      set last_message_id = v_message_id, last_message_at = now(), updated_at = now()
      where id = v_conversation_id;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.sync_cancelled_request_group_membership()
  from public, anon, authenticated;
drop trigger if exists sync_cancelled_request_group_membership on public.ride_requests;
create trigger sync_cancelled_request_group_membership
after update of status on public.ride_requests
for each row execute function private.sync_cancelled_request_group_membership();

create or replace function private.restore_conversation_on_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversation_members
  set archived_at = null
  where conversation_id = new.conversation_id and left_at is null;
  return new;
end;
$$;

revoke all on function private.restore_conversation_on_message()
  from public, anon, authenticated;
drop trigger if exists restore_conversation_on_message on public.messages;
create trigger restore_conversation_on_message
after insert on public.messages
for each row execute function private.restore_conversation_on_message();

create or replace function private.reject_read_only_group_message_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation_id uuid := coalesce(new.conversation_id, old.conversation_id);
  v_sender_id uuid := coalesce(new.sender_id, old.sender_id);
  v_kind text := coalesce(new.kind, old.kind);
begin
  if v_kind = 'user'
     and not (select private.conversation_is_writable(v_conversation_id, v_sender_id)) then
    raise exception 'This conversation is read-only or unavailable';
  end if;
  return new;
end;
$$;

revoke all on function private.reject_read_only_group_message_mutation()
  from public, anon, authenticated;
drop trigger if exists reject_read_only_group_message_insert on public.messages;
create trigger reject_read_only_group_message_insert
before insert on public.messages
for each row execute function private.reject_read_only_group_message_mutation();
drop trigger if exists reject_read_only_group_message_update on public.messages;
create trigger reject_read_only_group_message_update
before update of text_content, edited_at, deleted_at on public.messages
for each row execute function private.reject_read_only_group_message_mutation();

-- A muted conversation still receives messages and unread state, but no
-- notification row is created, so neither the in-app bell nor Web Push fires.
create or replace function private.suppress_muted_message_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source_module = 'm3'
     and new.event_type = 'message'
     and exists (
       select 1 from public.conversation_members cm
       where cm.user_id = new.recipient_id
         and cm.conversation_id::text = new.payload->>'conversationId'
         and cm.muted_at is not null
     ) then
    return null;
  end if;
  return new;
end;
$$;

revoke all on function private.suppress_muted_message_notification()
  from public, anon, authenticated;
drop trigger if exists suppress_muted_message_notification on public.user_notifications;
create trigger suppress_muted_message_notification
before insert on public.user_notifications
for each row execute function private.suppress_muted_message_notification();

-- Archive is only an inbox folder. Sending from an archived conversation is
-- allowed and the message trigger returns it to Active for current members.
create or replace function public.send_message(
  p_conversation_id uuid,
  p_message_id uuid,
  p_text text default null,
  p_attachments jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_text text := nullif(btrim(coalesce(p_text, '')), '');
  v_media_count integer;
  v_audio_count integer;
  v_location_count integer;
  v_total_bytes bigint;
  v_attachment jsonb;
  v_sender_name text;
  v_preview text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_message_id is null then raise exception 'A message identifier is required'; end if;
  perform 1 from public.conversations c
  where c.id = p_conversation_id
    and (select private.conversation_is_writable(c.id, v_user_id))
  for update;
  if not found then raise exception 'This conversation is read-only or unavailable'; end if;
  if p_attachments is null or jsonb_typeof(p_attachments) <> 'array' then
    raise exception 'Attachments must be an array';
  end if;
  if v_text is not null and char_length(v_text) > 1000 then
    raise exception 'Message must not exceed 1000 characters';
  end if;
  select
    count(*) filter (where item->>'kind' in ('image', 'video')),
    count(*) filter (where item->>'kind' = 'audio'),
    count(*) filter (where item->>'kind' = 'location'),
    coalesce(sum(case when item->>'kind' in ('image', 'video', 'audio')
      then (item->>'file_size')::bigint else 0 end), 0)
  into v_media_count, v_audio_count, v_location_count, v_total_bytes
  from jsonb_array_elements(p_attachments) as attachments(item);
  if v_text is null and jsonb_array_length(p_attachments) = 0 then
    raise exception 'Add text, media, a location, or a voice message before sending';
  end if;
  if v_media_count > 10 then raise exception 'A message can contain at most 10 photos or videos'; end if;
  if v_location_count > 1 then raise exception 'A message can contain at most one location'; end if;
  if v_audio_count > 1 then raise exception 'A message can contain at most one voice recording'; end if;
  if v_media_count + v_audio_count + v_location_count <> jsonb_array_length(p_attachments) then
    raise exception 'Unsupported attachment type';
  end if;
  if v_audio_count = 1 and (v_text is not null or jsonb_array_length(p_attachments) <> 1) then
    raise exception 'Voice messages must be sent on their own';
  end if;
  if v_total_bytes > 104857600 then raise exception 'Message media must not exceed 100 MB in total'; end if;
  for v_attachment in select value from jsonb_array_elements(p_attachments)
  loop
    if v_attachment->>'kind' = 'audio' and not (
      coalesce(v_attachment->>'mime_type', '') in ('audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav')
      and coalesce(nullif(v_attachment->>'file_size', '')::bigint, 0) between 1 and 10485760
      and coalesce(nullif(v_attachment->>'duration_seconds', '')::integer, 0) between 1 and 180
    ) then raise exception 'Voice message format, size, or duration is invalid'; end if;
    if v_attachment->>'kind' in ('image', 'video', 'audio') then
      if split_part(v_attachment->>'storage_path', '/', 1) <> v_user_id::text
         or split_part(v_attachment->>'storage_path', '/', 2) <> p_conversation_id::text
         or split_part(v_attachment->>'storage_path', '/', 3) <> p_message_id::text
         or split_part(v_attachment->>'storage_path', '/', 4) = ''
         or split_part(v_attachment->>'storage_path', '/', 5) = '' then
        raise exception 'Invalid versioned media upload path';
      end if;
      if not exists (
        select 1 from storage.objects o
        where o.bucket_id = 'message-media'
          and o.name = v_attachment->>'storage_path'
          and o.owner_id = v_user_id::text
          and coalesce((o.metadata->>'size')::bigint, -1) = (v_attachment->>'file_size')::bigint
          and coalesce(o.metadata->>'mimetype', '') = v_attachment->>'mime_type'
      ) then raise exception 'Uploaded media could not be verified'; end if;
    end if;
  end loop;
  insert into public.messages (id, conversation_id, sender_id, text_content)
  values (p_message_id, p_conversation_id, v_user_id, v_text);
  insert into public.message_attachments (
    message_id, kind, sort_order, storage_path, file_name, mime_type,
    file_size, duration_seconds, latitude, longitude
  )
  select p_message_id, item->>'kind', coalesce((item->>'sort_order')::smallint, 0),
    nullif(item->>'storage_path', ''), nullif(item->>'file_name', ''),
    nullif(item->>'mime_type', ''), nullif(item->>'file_size', '')::bigint,
    nullif(item->>'duration_seconds', '')::smallint,
    nullif(item->>'latitude', '')::double precision,
    nullif(item->>'longitude', '')::double precision
  from jsonb_array_elements(p_attachments) as attachments(item);
  update public.conversations
  set last_message_id = p_message_id, last_message_at = now(), updated_at = now()
  where id = p_conversation_id;
  update public.conversation_members
  set last_read_at = now()
  where conversation_id = p_conversation_id and user_id = v_user_id;
  select coalesce(nullif(btrim(full_name), ''), 'A member') into v_sender_name
  from public.profiles where id = v_user_id;
  v_sender_name := coalesce(v_sender_name, 'A member');
  v_preview := coalesce(v_text, case
    when v_audio_count = 1 then 'Sent a voice message'
    when v_media_count > 0 and v_location_count > 0 then 'Sent media and a location'
    when v_media_count > 0 then 'Sent a photo or video'
    else 'Shared a location' end);
  perform private.create_user_notification(
    cm.user_id, 'm3', 'message', 'New message from ' || v_sender_name, v_preview,
    '/message/' || p_conversation_id::text,
    jsonb_build_object('conversationId', p_conversation_id, 'messageId', p_message_id),
    'message:' || p_message_id::text
  )
  from public.conversation_members cm
  where cm.conversation_id = p_conversation_id
    and cm.user_id <> v_user_id and cm.left_at is null;
  return p_message_id;
end;
$$;

revoke all on function public.send_message(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.send_message(uuid, uuid, text, jsonb) to authenticated;

create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid := auth.uid(); v_latest timestamptz;
begin
  if v_user_id is null
     or not (select private.conversation_is_visible(p_conversation_id, v_user_id)) then
    raise exception 'Conversation unavailable';
  end if;
  select max(m.created_at) into v_latest
  from public.messages m
  where m.conversation_id = p_conversation_id
    and m.sender_id is distinct from v_user_id
    and (select private.message_is_visible(m.id, v_user_id));
  if v_latest is null then return false; end if;
  update public.conversation_members
  set last_read_at = greatest(coalesce(last_read_at, '-infinity'::timestamptz), v_latest)
  where conversation_id = p_conversation_id and user_id = v_user_id;
  return found;
end;
$$;

revoke all on function public.mark_conversation_read(uuid)
  from public, anon, authenticated;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

commit;
