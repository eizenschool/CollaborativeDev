-- Module 3 voice messages: standalone private audio attachments with a declared
-- 1-180 second duration, 10 MB limit, and the existing versioned media paths.

alter table public.message_attachments
  add column duration_seconds smallint;

alter table public.message_attachments
  drop constraint message_attachments_kind_check,
  drop constraint message_attachments_shape_check,
  drop constraint message_attachments_file_limit_check,
  drop constraint message_attachments_mime_check;

alter table public.message_attachments
  add constraint message_attachments_kind_check check (
    kind in ('image', 'video', 'audio', 'location')
  ),
  add constraint message_attachments_shape_check check (
    (
      kind in ('image', 'video', 'audio')
      and storage_path is not null
      and file_name is not null
      and mime_type is not null
      and file_size is not null
      and file_size > 0
      and latitude is null
      and longitude is null
      and (
        (kind = 'audio' and sort_order = 0 and duration_seconds between 1 and 180)
        or (kind in ('image', 'video') and duration_seconds is null)
      )
    )
    or (
      kind = 'location'
      and storage_path is null
      and file_name is null
      and mime_type is null
      and file_size is null
      and duration_seconds is null
      and latitude between -90 and 90
      and longitude between -180 and 180
    )
  ),
  add constraint message_attachments_file_limit_check check (
    kind = 'location'
    or (kind = 'image' and file_size <= 10485760)
    or (kind = 'video' and file_size <= 52428800)
    or (kind = 'audio' and file_size <= 10485760)
  ),
  add constraint message_attachments_mime_check check (
    kind = 'location'
    or (kind = 'image' and mime_type in ('image/jpeg', 'image/png', 'image/webp'))
    or (kind = 'video' and mime_type in ('video/mp4', 'video/webm', 'video/quicktime'))
    or (kind = 'audio' and mime_type in ('audio/webm', 'audio/mp4', 'audio/ogg'))
  );

comment on column public.message_attachments.duration_seconds is
  'Declared whole-second duration for standalone voice messages; null for all other attachments.';

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
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  if p_message_id is null then
    raise exception 'A message identifier is required';
  end if;

  perform 1
  from public.conversations c
  join public.conversation_members cm on cm.conversation_id = c.id
  where c.id = p_conversation_id
    and cm.user_id = v_user_id
    and cm.left_at is null
    and cm.archived_at is null
    and (c.expires_at is null or c.expires_at > now())
  for update of c, cm;
  if not found then
    raise exception 'This conversation is read-only or unavailable';
  end if;

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
    coalesce(sum(
      case when item->>'kind' in ('image', 'video', 'audio')
        then (item->>'file_size')::bigint else 0 end
    ), 0)
  into v_media_count, v_audio_count, v_location_count, v_total_bytes
  from jsonb_array_elements(p_attachments) as attachments(item);

  if v_text is null and jsonb_array_length(p_attachments) = 0 then
    raise exception 'Add text, media, a location, or a voice message before sending';
  end if;
  if v_media_count > 10 then
    raise exception 'A message can contain at most 10 photos or videos';
  end if;
  if v_location_count > 1 then
    raise exception 'A message can contain at most one location';
  end if;
  if v_audio_count > 1 then
    raise exception 'A message can contain at most one voice recording';
  end if;
  if v_media_count + v_audio_count + v_location_count <> jsonb_array_length(p_attachments) then
    raise exception 'Unsupported attachment type';
  end if;
  if v_audio_count = 1 and (v_text is not null or jsonb_array_length(p_attachments) <> 1) then
    raise exception 'Voice messages must be sent on their own';
  end if;
  if v_total_bytes > 104857600 then
    raise exception 'Message media must not exceed 100 MB in total';
  end if;

  for v_attachment in select value from jsonb_array_elements(p_attachments)
  loop
    if v_attachment->>'kind' = 'audio' and not (
      coalesce(v_attachment->>'mime_type', '') in ('audio/webm', 'audio/mp4', 'audio/ogg')
      and coalesce(nullif(v_attachment->>'file_size', '')::bigint, 0) between 1 and 10485760
      and coalesce(nullif(v_attachment->>'duration_seconds', '')::integer, 0) between 1 and 180
    ) then
      raise exception 'Voice message format, size, or duration is invalid';
    end if;

    if v_attachment->>'kind' in ('image', 'video', 'audio') then
      if split_part(v_attachment->>'storage_path', '/', 1) <> v_user_id::text
         or split_part(v_attachment->>'storage_path', '/', 2) <> p_conversation_id::text
         or split_part(v_attachment->>'storage_path', '/', 3) <> p_message_id::text
         or split_part(v_attachment->>'storage_path', '/', 4) = ''
         or split_part(v_attachment->>'storage_path', '/', 5) = '' then
        raise exception 'Invalid versioned media upload path';
      end if;
      if not exists (
        select 1
        from storage.objects o
        where o.bucket_id = 'message-media'
          and o.name = v_attachment->>'storage_path'
          and o.owner_id = v_user_id::text
          and coalesce((o.metadata->>'size')::bigint, -1) = (v_attachment->>'file_size')::bigint
          and coalesce(o.metadata->>'mimetype', '') = v_attachment->>'mime_type'
      ) then
        raise exception 'Uploaded media could not be verified';
      end if;
    end if;
  end loop;

  insert into public.messages (id, conversation_id, sender_id, text_content)
  values (p_message_id, p_conversation_id, v_user_id, v_text);

  insert into public.message_attachments (
    message_id, kind, sort_order, storage_path, file_name, mime_type,
    file_size, duration_seconds, latitude, longitude
  )
  select
    p_message_id,
    item->>'kind',
    coalesce((item->>'sort_order')::smallint, 0),
    nullif(item->>'storage_path', ''),
    nullif(item->>'file_name', ''),
    nullif(item->>'mime_type', ''),
    nullif(item->>'file_size', '')::bigint,
    nullif(item->>'duration_seconds', '')::smallint,
    nullif(item->>'latitude', '')::double precision,
    nullif(item->>'longitude', '')::double precision
  from jsonb_array_elements(p_attachments) as attachments(item);

  update public.conversations
  set last_message_id = p_message_id,
      last_message_at = now(),
      updated_at = now()
  where id = p_conversation_id;

  update public.conversation_members
  set last_read_at = now()
  where conversation_id = p_conversation_id and user_id = v_user_id;

  return p_message_id;
end;
$$;

create or replace function public.edit_message(
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
  v_message public.messages%rowtype;
  v_text text := nullif(btrim(coalesce(p_text, '')), '');
  v_media_count integer;
  v_location_count integer;
  v_total_bytes bigint;
  v_attachment jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into v_message
  from public.messages
  where id = p_message_id
  for update;

  if not found or v_message.sender_id <> v_user_id or v_message.kind <> 'user' or v_message.deleted_at is not null then
    raise exception 'Only the original sender may edit this message';
  end if;

  perform 1
  from public.conversations c
  join public.conversation_members cm on cm.conversation_id = c.id
  where c.id = v_message.conversation_id
    and cm.user_id = v_user_id
    and cm.left_at is null
    and cm.archived_at is null
    and (c.expires_at is null or c.expires_at > now())
  for update of c, cm;
  if not found then
    raise exception 'This conversation is read-only or unavailable';
  end if;

  perform 1
  from public.conversation_members cm
  where cm.conversation_id = v_message.conversation_id
  order by cm.user_id
  for update;

  if exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id = v_message.conversation_id
      and cm.user_id <> v_user_id
      and cm.last_read_at is not null
      and cm.last_read_at >= v_message.created_at
  ) then
    raise exception 'This message has already been read and cannot be edited';
  end if;
  if p_attachments is null or jsonb_typeof(p_attachments) <> 'array' then
    raise exception 'Attachments must be an array';
  end if;
  if exists (
    select 1 from public.message_attachments ma
    where ma.message_id = p_message_id and ma.kind = 'audio'
  ) or exists (
    select 1 from jsonb_array_elements(p_attachments) as attachments(item)
    where item->>'kind' = 'audio'
  ) then
    raise exception 'Voice messages cannot be edited';
  end if;
  if v_text is not null and char_length(v_text) > 1000 then
    raise exception 'Message must not exceed 1000 characters';
  end if;

  select
    count(*) filter (where item->>'kind' in ('image', 'video')),
    count(*) filter (where item->>'kind' = 'location'),
    coalesce(sum(case when item->>'kind' in ('image', 'video') then (item->>'file_size')::bigint else 0 end), 0)
  into v_media_count, v_location_count, v_total_bytes
  from jsonb_array_elements(p_attachments) as attachments(item);

  if v_text is null and jsonb_array_length(p_attachments) = 0 then
    raise exception 'Add text, media, or a location before saving';
  end if;
  if v_media_count > 10 or v_location_count > 1
     or v_media_count + v_location_count <> jsonb_array_length(p_attachments) then
    raise exception 'Invalid attachment selection';
  end if;
  if v_total_bytes > 104857600 then
    raise exception 'Message media must not exceed 100 MB in total';
  end if;

  for v_attachment in select value from jsonb_array_elements(p_attachments)
  loop
    if v_attachment->>'kind' in ('image', 'video') then
      if split_part(v_attachment->>'storage_path', '/', 1) <> v_user_id::text
         or split_part(v_attachment->>'storage_path', '/', 2) <> v_message.conversation_id::text
         or split_part(v_attachment->>'storage_path', '/', 3) <> p_message_id::text
         or split_part(v_attachment->>'storage_path', '/', 4) = ''
         or split_part(v_attachment->>'storage_path', '/', 5) = '' then
        raise exception 'Invalid versioned media upload path';
      end if;
      if not exists (
        select 1
        from storage.objects o
        where o.bucket_id = 'message-media'
          and o.name = v_attachment->>'storage_path'
          and o.owner_id = v_user_id::text
          and coalesce((o.metadata->>'size')::bigint, -1) = (v_attachment->>'file_size')::bigint
          and coalesce(o.metadata->>'mimetype', '') = v_attachment->>'mime_type'
      ) then
        raise exception 'Uploaded media could not be verified';
      end if;
    end if;
  end loop;

  delete from public.message_attachments where message_id = p_message_id;

  insert into public.message_attachments (
    message_id, kind, sort_order, storage_path, file_name, mime_type,
    file_size, duration_seconds, latitude, longitude
  )
  select
    p_message_id,
    item->>'kind',
    coalesce((item->>'sort_order')::smallint, 0),
    nullif(item->>'storage_path', ''),
    nullif(item->>'file_name', ''),
    nullif(item->>'mime_type', ''),
    nullif(item->>'file_size', '')::bigint,
    nullif(item->>'duration_seconds', '')::smallint,
    nullif(item->>'latitude', '')::double precision,
    nullif(item->>'longitude', '')::double precision
  from jsonb_array_elements(p_attachments) as attachments(item);

  update public.messages
  set text_content = v_text, edited_at = now()
  where id = p_message_id;

  return p_message_id;
end;
$$;

revoke all on function public.send_message(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.edit_message(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.send_message(uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.edit_message(uuid, text, jsonb) to authenticated;

update storage.buckets
set allowed_mime_types = array[
      'image/jpeg', 'image/png', 'image/webp',
      'video/mp4', 'video/webm', 'video/quicktime',
      'audio/webm', 'audio/mp4', 'audio/ogg'
    ]::text[]
where id = 'message-media';

do $$
begin
  if not exists (
    select 1 from storage.buckets where id = 'message-media'
  ) then
    raise exception 'The private message-media bucket is missing';
  end if;
end;
$$;
