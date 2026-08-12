-- Module 3 production messaging: ride-bound conversations, composite messages,
-- Realtime publication, private media storage, lifecycle expiry, and RLS.

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides(id) on delete cascade,
  type text not null check (type in ('direct', 'group')),
  direct_user_id uuid references public.profiles(id) on delete cascade,
  title text,
  trip_route text,
  trip_departure_at timestamptz,
  ride_status text not null check (
    ride_status in ('Draft', 'Published', 'Matched', 'In Transit', 'Completed', 'Cancelled', 'Expired')
  ),
  last_message_at timestamptz,
  terminal_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversations_type_shape_check check (
    (type = 'direct' and direct_user_id is not null)
    or (type = 'group' and direct_user_id is null)
  ),
  constraint conversations_expiry_check check (
    (terminal_at is null and expires_at is null)
    or (terminal_at is not null and expires_at = terminal_at + interval '7 days')
  )
);

create unique index conversations_one_direct_per_ride_user_idx
  on public.conversations (ride_id, direct_user_id)
  where type = 'direct';
create unique index conversations_one_group_per_ride_idx
  on public.conversations (ride_id)
  where type = 'group';
create index conversations_ride_id_idx on public.conversations (ride_id);
create index conversations_active_last_message_idx
  on public.conversations (last_message_at desc nulls last, created_at desc);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('host', 'traveller')),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  archived_at timestamptz,
  last_read_at timestamptz,
  primary key (conversation_id, user_id),
  constraint conversation_members_archive_check check (
    archived_at is null or left_at is null
  )
);

create index conversation_members_user_active_idx
  on public.conversation_members (user_id, archived_at, conversation_id)
  where left_at is null;
create index conversation_members_conversation_active_idx
  on public.conversation_members (conversation_id, user_id, last_read_at)
  where left_at is null;

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid references public.profiles(id) on delete set null,
  kind text not null default 'user' check (kind in ('user', 'system')),
  text_content text,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  constraint messages_sender_check check (
    (kind = 'user' and sender_id is not null)
    or (kind = 'system' and sender_id is null)
  ),
  constraint messages_text_length_check check (
    text_content is null or char_length(text_content) between 1 and 1000
  ),
  constraint messages_deleted_payload_check check (
    deleted_at is null or text_content is null
  )
);

create index messages_conversation_created_idx
  on public.messages (conversation_id, created_at, id);
create index messages_sender_created_idx
  on public.messages (sender_id, created_at desc)
  where sender_id is not null;

alter table public.conversations
  add column last_message_id uuid references public.messages(id) on delete set null;
create index conversations_last_message_id_idx
  on public.conversations (last_message_id)
  where last_message_id is not null;

create table public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  kind text not null check (kind in ('image', 'video', 'location')),
  sort_order smallint not null default 0 check (sort_order between 0 and 10),
  storage_path text,
  file_name text,
  mime_type text,
  file_size bigint,
  latitude double precision,
  longitude double precision,
  created_at timestamptz not null default now(),
  constraint message_attachments_shape_check check (
    (
      kind in ('image', 'video')
      and storage_path is not null
      and file_name is not null
      and mime_type is not null
      and file_size is not null
      and file_size > 0
      and latitude is null
      and longitude is null
    )
    or (
      kind = 'location'
      and storage_path is null
      and file_name is null
      and mime_type is null
      and file_size is null
      and latitude between -90 and 90
      and longitude between -180 and 180
    )
  ),
  constraint message_attachments_file_limit_check check (
    kind = 'location'
    or (kind = 'image' and file_size <= 10485760)
    or (kind = 'video' and file_size <= 52428800)
  ),
  constraint message_attachments_mime_check check (
    kind = 'location'
    or (kind = 'image' and mime_type in ('image/jpeg', 'image/png', 'image/webp'))
    or (kind = 'video' and mime_type in ('video/mp4', 'video/webm', 'video/quicktime'))
  )
);

create index message_attachments_message_sort_idx
  on public.message_attachments (message_id, sort_order, id);
create unique index message_attachments_one_location_idx
  on public.message_attachments (message_id)
  where kind = 'location';
create unique index message_attachments_storage_path_idx
  on public.message_attachments (storage_path)
  where storage_path is not null;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

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
      and cm.left_at is null
      and (c.expires_at is null or c.expires_at > now())
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
      and cm.archived_at is null
      and (c.expires_at is null or c.expires_at > now())
  );
$$;

create or replace function private.ensure_ride_group(
  p_ride_id uuid,
  p_traveller_id uuid,
  p_joined_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ride public.rides%rowtype;
  v_conversation_id uuid;
begin
  select * into v_ride
  from public.rides
  where id = p_ride_id
  for update;

  if not found then
    raise exception 'Ride not found';
  end if;

  insert into public.conversations (
    ride_id, type, title, trip_route, trip_departure_at, ride_status,
    last_message_at, terminal_at, expires_at
  ) values (
    v_ride.id,
    'group',
    v_ride.pickup || ' to ' || v_ride.destination || ' Trip Group',
    v_ride.pickup || ' to ' || v_ride.destination,
    v_ride.departure_at,
    v_ride.status,
    p_joined_at,
    case when v_ride.status in ('Completed', 'Cancelled', 'Expired') then p_joined_at else null end,
    case when v_ride.status in ('Completed', 'Cancelled', 'Expired') then p_joined_at + interval '7 days' else null end
  )
  on conflict (ride_id) where type = 'group'
  do update set
    title = excluded.title,
    trip_route = excluded.trip_route,
    trip_departure_at = excluded.trip_departure_at,
    ride_status = excluded.ride_status,
    updated_at = now()
  returning id into v_conversation_id;

  insert into public.conversation_members (
    conversation_id, user_id, role, joined_at
  ) values (
    v_conversation_id, v_ride.host_id, 'host', p_joined_at
  )
  on conflict (conversation_id, user_id) do update set
    role = 'host',
    left_at = null;

  insert into public.conversation_members (
    conversation_id, user_id, role, joined_at
  ) values (
    v_conversation_id, p_traveller_id, 'traveller', p_joined_at
  )
  on conflict (conversation_id, user_id) do update set
    role = 'traveller',
    left_at = null;

  return v_conversation_id;
end;
$$;

revoke all on function private.conversation_is_visible(uuid, uuid) from public, anon, authenticated;
revoke all on function private.conversation_is_writable(uuid, uuid) from public, anon, authenticated;
revoke all on function private.ensure_ride_group(uuid, uuid, timestamptz) from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.conversation_is_visible(uuid, uuid) to authenticated;
grant execute on function private.conversation_is_writable(uuid, uuid) to authenticated;

create or replace function public.open_ride_direct_conversation(p_ride_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_ride public.rides%rowtype;
  v_conversation_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into v_ride
  from public.rides
  where id = p_ride_id
  for update;

  if not found or v_ride.status <> 'Published' then
    raise exception 'Only a Published ride can start a private conversation';
  end if;
  if v_ride.host_id = v_user_id then
    raise exception 'Hosts cannot start a private chat with themselves';
  end if;

  insert into public.conversations (
    ride_id, type, direct_user_id, trip_route, trip_departure_at,
    ride_status, last_message_at
  ) values (
    v_ride.id,
    'direct',
    v_user_id,
    v_ride.pickup || ' to ' || v_ride.destination,
    v_ride.departure_at,
    v_ride.status,
    now()
  )
  on conflict (ride_id, direct_user_id) where type = 'direct'
  do update set
    trip_route = excluded.trip_route,
    trip_departure_at = excluded.trip_departure_at,
    ride_status = excluded.ride_status,
    updated_at = now()
  returning id into v_conversation_id;

  insert into public.conversation_members (conversation_id, user_id, role)
  values
    (v_conversation_id, v_ride.host_id, 'host'),
    (v_conversation_id, v_user_id, 'traveller')
  on conflict (conversation_id, user_id) do update set left_at = null;

  return v_conversation_id;
end;
$$;

create or replace function public.send_message(
  p_conversation_id uuid,
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
  v_message_id uuid;
  v_text text := nullif(btrim(coalesce(p_text, '')), '');
  v_media_count integer;
  v_location_count integer;
  v_total_bytes bigint;
  v_attachment jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
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
    count(*) filter (where item->>'kind' = 'location'),
    coalesce(sum(case when item->>'kind' in ('image', 'video') then (item->>'file_size')::bigint else 0 end), 0)
  into v_media_count, v_location_count, v_total_bytes
  from jsonb_array_elements(p_attachments) as attachments(item);

  if v_text is null and jsonb_array_length(p_attachments) = 0 then
    raise exception 'Add text, media, or a location before sending';
  end if;
  if v_media_count > 10 then
    raise exception 'A message can contain at most 10 photos or videos';
  end if;
  if v_location_count > 1 then
    raise exception 'A message can contain at most one location';
  end if;
  if v_media_count + v_location_count <> jsonb_array_length(p_attachments) then
    raise exception 'Unsupported attachment type';
  end if;
  if v_total_bytes > 104857600 then
    raise exception 'Message media must not exceed 100 MB in total';
  end if;

  for v_attachment in select value from jsonb_array_elements(p_attachments)
  loop
    if v_attachment->>'kind' in ('image', 'video') then
      if split_part(v_attachment->>'storage_path', '/', 1) <> v_user_id::text
         or split_part(v_attachment->>'storage_path', '/', 2) <> p_conversation_id::text
         or split_part(v_attachment->>'storage_path', '/', 3) <> 'staging' then
        raise exception 'Invalid media upload path';
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

  insert into public.messages (conversation_id, sender_id, text_content)
  values (p_conversation_id, v_user_id, v_text)
  returning id into v_message_id;

  insert into public.message_attachments (
    message_id, kind, sort_order, storage_path, file_name, mime_type,
    file_size, latitude, longitude
  )
  select
    v_message_id,
    item->>'kind',
    coalesce((item->>'sort_order')::smallint, 0),
    nullif(item->>'storage_path', ''),
    nullif(item->>'file_name', ''),
    nullif(item->>'mime_type', ''),
    nullif(item->>'file_size', '')::bigint,
    nullif(item->>'latitude', '')::double precision,
    nullif(item->>'longitude', '')::double precision
  from jsonb_array_elements(p_attachments) as attachments(item);

  update public.conversations
  set last_message_id = v_message_id,
      last_message_at = now(),
      updated_at = now()
  where id = p_conversation_id;

  update public.conversation_members
  set last_read_at = now()
  where conversation_id = p_conversation_id and user_id = v_user_id;

  return v_message_id;
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

  -- Freeze every member's read cursor until the entire replacement commits.
  -- mark_conversation_read() will wait on these rows, closing the read/edit race.
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
         or split_part(v_attachment->>'storage_path', '/', 2) <> v_message.conversation_id::text then
        raise exception 'Invalid media upload path';
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
    file_size, latitude, longitude
  )
  select
    p_message_id,
    item->>'kind',
    coalesce((item->>'sort_order')::smallint, 0),
    nullif(item->>'storage_path', ''),
    nullif(item->>'file_name', ''),
    nullif(item->>'mime_type', ''),
    nullif(item->>'file_size', '')::bigint,
    nullif(item->>'latitude', '')::double precision,
    nullif(item->>'longitude', '')::double precision
  from jsonb_array_elements(p_attachments) as attachments(item);

  update public.messages
  set text_content = v_text, edited_at = now()
  where id = p_message_id;

  return p_message_id;
end;
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
    and cm.archived_at is null
    and (c.expires_at is null or c.expires_at > now())
  for update of c, cm;
  if not found then
    raise exception 'This conversation is read-only or unavailable';
  end if;

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
  set last_read_at = greatest(coalesce(last_read_at, '-infinity'::timestamptz), v_latest)
  where conversation_id = p_conversation_id and user_id = v_user_id;

  return found;
end;
$$;

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
     or v_conversation.ride_status <> 'Completed'
     or not (select private.conversation_is_visible(p_conversation_id, v_user_id)) then
    raise exception 'This conversation cannot be managed until the trip is completed';
  end if;

  update public.conversation_members
  set archived_at = coalesce(archived_at, now())
  where conversation_id = p_conversation_id and user_id = v_user_id;

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

  select role into v_role
  from public.conversation_members
  where conversation_id = p_conversation_id
    and user_id = v_user_id
    and left_at is null
  for update;

  if v_user_id is null or not found
     or v_conversation.type <> 'group'
     or v_conversation.ride_status <> 'Completed' then
    raise exception 'This conversation cannot be managed until the trip is completed';
  end if;
  if v_role <> 'traveller' then
    raise exception 'The ride Host cannot leave the trip group';
  end if;

  select full_name into v_name from public.profiles where id = v_user_id;

  update public.conversation_members
  set left_at = now(), archived_at = null
  where conversation_id = p_conversation_id and user_id = v_user_id;

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

create or replace function public.set_messaging_ride_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_terminal_at timestamptz;
begin
  if new.status is distinct from old.status then
    v_terminal_at := case
      when new.status = 'Cancelled' then coalesce(new.updated_at, now())
      when new.status = 'Expired' then coalesce(new.expired_at, new.updated_at, now())
      when new.status = 'Completed' then coalesce(new.updated_at, now())
      else null
    end;

    update public.conversations
    set ride_status = new.status,
        terminal_at = case
          when new.status in ('Completed', 'Cancelled', 'Expired')
            then coalesce(terminal_at, v_terminal_at)
          else terminal_at
        end,
        expires_at = case
          when new.status in ('Completed', 'Cancelled', 'Expired')
            then coalesce(expires_at, v_terminal_at + interval '7 days')
          else expires_at
        end,
        updated_at = now()
    where ride_id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.set_messaging_ride_lifecycle() from public, anon, authenticated;
create trigger sync_messaging_ride_lifecycle
after update of status on public.rides
for each row execute function public.set_messaging_ride_lifecycle();

-- Preserve the deployed Module 2 RPC signature while adding group membership to
-- the same acceptance transaction.
create or replace function public.respond_to_ride_request(
  p_request_id uuid,
  p_decision text,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_ride_id uuid;
  v_ride public.rides%rowtype;
  v_request public.ride_requests%rowtype;
begin
  if p_decision not in ('Accepted', 'Rejected') then
    raise exception 'Decision must be Accepted or Rejected';
  end if;
  if p_decision = 'Rejected' and nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'A rejection reason is required';
  end if;

  select ride_id into v_ride_id from public.ride_requests where id = p_request_id;
  if not found then
    raise exception 'Ride request not found';
  end if;

  select * into v_ride from public.rides where id = v_ride_id for update;
  select * into v_request from public.ride_requests where id = p_request_id for update;

  if v_user_id is null or v_ride.host_id <> v_user_id then
    raise exception 'Only the ride Host can process requests';
  end if;
  if v_ride.status <> 'Published' or v_ride.departure_at <= now() then
    raise exception 'This ride can no longer process requests';
  end if;
  if v_request.status <> 'Pending' then
    raise exception 'This request has already been processed';
  end if;

  if p_decision = 'Accepted' then
    if v_request.seats_requested > v_ride.seats_available then
      raise exception 'Not enough seats remain for this request';
    end if;
    update public.rides
    set seats_available = seats_available - v_request.seats_requested
    where id = v_ride_id;
  end if;

  update public.ride_requests
  set status = p_decision,
      decision_reason = nullif(btrim(coalesce(p_reason, '')), ''),
      processed_at = now()
  where id = p_request_id;

  if p_decision = 'Accepted' then
    perform private.ensure_ride_group(v_ride_id, v_request.requester_id, now());
  end if;

  return p_request_id;
end;
$$;

-- Backfill the already accepted Module 2 participation state without demo data.
do $$
declare
  v_request record;
begin
  for v_request in
    select ride_id, requester_id, coalesce(processed_at, updated_at, created_at) as joined_at
    from public.ride_requests
    where status = 'Accepted'
    order by created_at
  loop
    perform private.ensure_ride_group(v_request.ride_id, v_request.requester_id, v_request.joined_at);
  end loop;
end;
$$;

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.message_attachments enable row level security;

create policy "members read visible conversations"
  on public.conversations for select to authenticated
  using ((select private.conversation_is_visible(id, (select auth.uid()))));

create policy "members read conversation memberships"
  on public.conversation_members for select to authenticated
  using ((select private.conversation_is_visible(conversation_id, (select auth.uid()))));

create policy "members read visible messages"
  on public.messages for select to authenticated
  using ((select private.conversation_is_visible(conversation_id, (select auth.uid()))));

create policy "members read visible attachments"
  on public.message_attachments for select to authenticated
  using (
    exists (
      select 1
      from public.messages m
      where m.id = message_attachments.message_id
        and (select private.conversation_is_visible(m.conversation_id, (select auth.uid())))
    )
  );

revoke all on table public.conversations from public, anon, authenticated;
revoke all on table public.conversation_members from public, anon, authenticated;
revoke all on table public.messages from public, anon, authenticated;
revoke all on table public.message_attachments from public, anon, authenticated;
grant select on table public.conversations to authenticated;
grant select on table public.conversation_members to authenticated;
grant select on table public.messages to authenticated;
grant select on table public.message_attachments to authenticated;

revoke all on function public.open_ride_direct_conversation(uuid) from public, anon, authenticated;
revoke all on function public.send_message(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.edit_message(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.delete_message(uuid) from public, anon, authenticated;
revoke all on function public.mark_conversation_read(uuid) from public, anon, authenticated;
revoke all on function public.archive_conversation(uuid) from public, anon, authenticated;
revoke all on function public.leave_group_conversation(uuid) from public, anon, authenticated;
grant execute on function public.open_ride_direct_conversation(uuid) to authenticated;
grant execute on function public.send_message(uuid, text, jsonb) to authenticated;
grant execute on function public.edit_message(uuid, text, jsonb) to authenticated;
grant execute on function public.delete_message(uuid) to authenticated;
grant execute on function public.mark_conversation_read(uuid) to authenticated;
grant execute on function public.archive_conversation(uuid) to authenticated;
grant execute on function public.leave_group_conversation(uuid) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'message-media',
  'message-media',
  false,
  52428800,
  array[
    'image/jpeg', 'image/png', 'image/webp',
    'video/mp4', 'video/webm', 'video/quicktime'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "members upload staged message media"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'message-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (storage.foldername(name))[3] = 'staging'
    and (select private.conversation_is_writable(
      ((storage.foldername(name))[2])::uuid,
      (select auth.uid())
    ))
  );

create policy "members download committed message media"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'message-media'
    and storage.allow_any_operation(array[
      'object.get_authenticated_info',
      'object.get_authenticated'
    ])
    and exists (
      select 1
      from public.message_attachments ma
      join public.messages m on m.id = ma.message_id
      where ma.storage_path = storage.objects.name
        and (select private.conversation_is_visible(
          m.conversation_id,
          (select auth.uid())
        ))
    )
  );

create policy "owners delete their message media"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'message-media'
    and owner_id = (select auth.uid())::text
  );

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'conversations'
  ) then
    execute 'alter publication supabase_realtime add table public.conversations';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'conversation_members'
  ) then
    execute 'alter publication supabase_realtime add table public.conversation_members';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    execute 'alter publication supabase_realtime add table public.messages';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'message_attachments'
  ) then
    execute 'alter publication supabase_realtime add table public.message_attachments';
  end if;
end;
$$;
