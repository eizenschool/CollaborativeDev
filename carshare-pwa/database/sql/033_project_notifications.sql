-- Shared notification inbox and Web Push subscription boundary.
-- A Database Webhook must be configured after deployment (see
-- docs/SUPABASE-SETUP.md) to POST INSERT records from user_notifications to
-- the notification-push Edge Function with x-notification-webhook-secret.

create extension if not exists pg_cron;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  source_module text not null check (char_length(source_module) between 1 and 32),
  event_type text not null check (char_length(event_type) between 1 and 64),
  title text not null check (char_length(title) between 1 and 160),
  body text not null check (char_length(body) between 1 and 1000),
  action_path text not null check (
    action_path ~ '^/[^[:space:]]*$'
    and action_path !~ '^//'
    and position(chr(92) in action_path) = 0
  ),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 200),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint user_notifications_recipient_dedupe_key unique (recipient_id, dedupe_key)
);

create index user_notifications_recipient_created_idx
  on public.user_notifications (recipient_id, created_at desc);
create index user_notifications_recipient_unread_idx
  on public.user_notifications (recipient_id, created_at desc)
  where read_at is null;

create table public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://'),
  p256dh text not null check (char_length(p256dh) between 16 and 1024),
  auth text not null check (char_length(auth) between 8 and 256),
  expiration_time timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index web_push_subscriptions_user_idx
  on public.web_push_subscriptions (user_id);

alter table public.user_notifications enable row level security;
alter table public.web_push_subscriptions enable row level security;

create policy "users read their own notifications"
  on public.user_notifications for select to authenticated
  using ((select auth.uid()) = recipient_id);

-- Subscription capability URLs are never returned to browser clients. The
-- authenticated notification-subscriptions Edge Function owns all writes.
revoke all on table public.user_notifications from public, anon, authenticated;
revoke all on table public.web_push_subscriptions from public, anon, authenticated;
grant select on table public.user_notifications to authenticated;

create or replace function private.create_user_notification(
  p_recipient_id uuid,
  p_source_module text,
  p_event_type text,
  p_title text,
  p_body text,
  p_action_path text,
  p_payload jsonb,
  p_dedupe_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notification_id uuid;
begin
  if p_recipient_id is null
     or nullif(btrim(coalesce(p_source_module, '')), '') is null
     or nullif(btrim(coalesce(p_event_type, '')), '') is null
     or nullif(btrim(coalesce(p_title, '')), '') is null
     or nullif(btrim(coalesce(p_body, '')), '') is null
     or nullif(btrim(coalesce(p_dedupe_key, '')), '') is null then
    raise exception 'Notification fields are required';
  end if;
  if coalesce(p_action_path, '') !~ '^/[^[:space:]]*$'
     or p_action_path ~ '^//'
     or position(chr(92) in coalesce(p_action_path, '')) > 0 then
    raise exception 'Notification action path must be an internal path';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Notification payload must be an object';
  end if;

  insert into public.user_notifications (
    recipient_id, source_module, event_type, title, body, action_path, payload, dedupe_key
  ) values (
    p_recipient_id, btrim(p_source_module), btrim(p_event_type), btrim(p_title),
    btrim(p_body), p_action_path, p_payload, btrim(p_dedupe_key)
  )
  on conflict (recipient_id, dedupe_key) do nothing
  returning id into v_notification_id;

  if v_notification_id is null then
    select id into v_notification_id
    from public.user_notifications
    where recipient_id = p_recipient_id and dedupe_key = p_dedupe_key;
  end if;
  return v_notification_id;
end;
$$;

create or replace function public.mark_notification_read(p_notification_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_changed boolean;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  update public.user_notifications
  set read_at = coalesce(read_at, now())
  where id = p_notification_id and recipient_id = v_user_id
  returning true into v_changed;
  return coalesce(v_changed, false);
end;
$$;

create or replace function public.mark_all_notifications_read()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_count integer;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  update public.user_notifications
  set read_at = now()
  where recipient_id = v_user_id and read_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function private.prune_user_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.user_notifications where created_at < now() - interval '30 days';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function private.create_user_notification(uuid, text, text, text, text, text, jsonb, text)
  from public, anon, authenticated;
revoke all on function private.prune_user_notifications() from public, anon, authenticated;
revoke all on function public.mark_notification_read(uuid) from public, anon, authenticated;
revoke all on function public.mark_all_notifications_read() from public, anon, authenticated;
grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.mark_all_notifications_read() to authenticated;

-- Preserve the latest audio/WAV messaging contract from 026 and add the
-- notification producer inside the same locked message transaction.
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
      coalesce(v_attachment->>'mime_type', '') in ('audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav')
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

  select coalesce(nullif(btrim(full_name), ''), 'A member') into v_sender_name
  from public.profiles
  where id = v_user_id;
  v_sender_name := coalesce(v_sender_name, 'A member');
  v_preview := coalesce(
    v_text,
    case
      when v_audio_count = 1 then 'Sent a voice message'
      when v_media_count > 0 and v_location_count > 0 then 'Sent media and a location'
      when v_media_count > 0 then 'Sent a photo or video'
      else 'Shared a location'
    end
  );

  perform private.create_user_notification(
    cm.user_id,
    'm3',
    'message',
    'New message from ' || v_sender_name,
    v_preview,
    '/message/' || p_conversation_id::text,
    jsonb_build_object('conversationId', p_conversation_id, 'messageId', p_message_id),
    'message:' || p_message_id::text
  )
  from public.conversation_members cm
  where cm.conversation_id = p_conversation_id
    and cm.user_id <> v_user_id
    and cm.left_at is null;

  return p_message_id;
end;
$$;

revoke all on function public.send_message(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.send_message(uuid, uuid, text, jsonb) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_notifications'
  ) then
    execute 'alter publication supabase_realtime add table public.user_notifications';
  end if;
end;
$$;

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in select jobid from cron.job where jobname = 'project-notification-retention'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
  perform cron.schedule(
    'project-notification-retention',
    '17 3 * * *',
    'select private.prune_user_notifications();'
  );
end;
$$;
