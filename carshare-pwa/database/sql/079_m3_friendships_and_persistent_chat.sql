-- Module 3: mutually accepted friendships and one persistent direct chat per
-- account pair. Ride-bound direct and group conversations keep their existing
-- lifecycle and are never merged into friend conversations.
-- Depends on 073_m1, 075_m3, and 077_m3.

begin;

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  member_low_id uuid not null references public.profiles(id) on delete cascade,
  member_high_id uuid not null references public.profiles(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'removed')),
  request_revision integer not null default 1 check (request_revision > 0),
  requested_at timestamptz not null default now(),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint friendships_distinct_members_check
    check (member_low_id::text < member_high_id::text),
  constraint friendships_requester_is_member_check
    check (requested_by in (member_low_id, member_high_id)),
  constraint friendships_response_shape_check check (
    (status = 'pending' and responded_at is null)
    or (status <> 'pending' and responded_at is not null)
  ),
  constraint friendships_unique_pair unique (member_low_id, member_high_id)
);

create index friendships_member_high_status_idx
  on public.friendships (member_high_id, status, updated_at desc);
create index friendships_requested_by_idx
  on public.friendships (requested_by);

alter table public.friendships enable row level security;
alter table public.friendships replica identity full;

create policy "friendship participants read their relationships"
  on public.friendships for select to authenticated
  using (
    (select auth.uid()) is not null
    and (select auth.uid()) in (member_low_id, member_high_id)
  );

revoke all on table public.friendships from public, anon, authenticated;
grant select on table public.friendships to authenticated;

-- Existing conversations become explicitly Ride-scoped. A friend-scoped row
-- has no Ride lifecycle and points at the relationship that authorizes writes.
alter table public.conversations
  add column scope text not null default 'ride'
    check (scope in ('ride', 'friend')),
  add column friendship_id uuid references public.friendships(id) on delete cascade;

alter table public.conversations alter column ride_id drop not null;
alter table public.conversations alter column ride_status drop not null;
alter table public.conversations drop constraint if exists conversations_type_shape_check;
alter table public.conversations drop constraint if exists conversations_scope_shape_check;
alter table public.conversations
  add constraint conversations_scope_shape_check check (
    (
      scope = 'ride'
      and ride_id is not null
      and ride_status is not null
      and friendship_id is null
      and (
        (type = 'direct' and direct_user_id is not null)
        or (type = 'group' and direct_user_id is null)
      )
    )
    or (
      scope = 'friend'
      and type = 'direct'
      and ride_id is null
      and direct_user_id is null
      and friendship_id is not null
      and ride_status is null
      and trip_route is null
      and trip_departure_at is null
      and terminal_at is null
      and expires_at is null
    )
  );

create unique index conversations_one_friend_per_friendship_idx
  on public.conversations (friendship_id);

alter table public.conversation_members
  drop constraint if exists conversation_members_role_check;
alter table public.conversation_members
  add constraint conversation_members_role_check
  check (role in ('host', 'traveller', 'friend'));

-- The public table is participant-readable only. These internal helpers run as
-- the migration owner, pin the search path, and are never callable by clients.
create or replace function private.friend_public_summary(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_profile jsonb;
begin
  v_profile := public.get_public_profile(p_user_id);
  if v_profile is null then
    return jsonb_build_object(
      'id', p_user_id,
      'displayName', 'Member',
      'profilePhotoUrl', null
    );
  end if;
  return jsonb_build_object(
    'id', p_user_id,
    'displayName', coalesce(v_profile->>'displayName', 'Member'),
    'profilePhotoUrl', v_profile->'profilePhotoUrl'
  );
end;
$$;

create or replace function private.ensure_friend_conversation(
  p_friendship_id uuid,
  p_created_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_friendship public.friendships%rowtype;
  v_conversation_id uuid;
begin
  select * into v_friendship
  from public.friendships
  where id = p_friendship_id
  for update;

  if not found or v_friendship.status <> 'accepted' then
    raise exception 'An accepted friendship is required';
  end if;

  insert into public.conversations (
    scope, friendship_id, type, ride_id, direct_user_id, ride_status,
    trip_route, trip_departure_at, terminal_at, expires_at, created_at, updated_at
  ) values (
    'friend', v_friendship.id, 'direct', null, null, null,
    null, null, null, null, p_created_at, now()
  )
  on conflict (friendship_id)
  do update set updated_at = now()
  returning id into v_conversation_id;

  insert into public.conversation_members (
    conversation_id, user_id, role, joined_at, left_at,
    archived_at, access_expires_at
  ) values
    (v_conversation_id, v_friendship.member_low_id, 'friend', p_created_at, null, null, null),
    (v_conversation_id, v_friendship.member_high_id, 'friend', p_created_at, null, null, null)
  on conflict (conversation_id, user_id) do update
  set role = 'friend',
      left_at = null,
      access_expires_at = null;

  return v_conversation_id;
end;
$$;

create or replace function private.friendship_payload(
  p_friendship_id uuid,
  p_viewer_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_friendship public.friendships%rowtype;
  v_other_id uuid;
  v_conversation_id uuid;
  v_status text;
begin
  select * into v_friendship
  from public.friendships
  where id = p_friendship_id
    and p_viewer_id in (member_low_id, member_high_id);
  if not found then return null; end if;

  v_other_id := case
    when v_friendship.member_low_id = p_viewer_id then v_friendship.member_high_id
    else v_friendship.member_low_id
  end;
  v_status := case
    when v_friendship.status = 'pending' and v_friendship.requested_by = p_viewer_id
      then 'outgoing_pending'
    when v_friendship.status = 'pending' then 'incoming_pending'
    when v_friendship.status = 'accepted' then 'accepted'
    when v_friendship.status = 'removed' then 'removed'
    else 'none'
  end;

  select id into v_conversation_id
  from public.conversations
  where friendship_id = v_friendship.id and scope = 'friend';

  return jsonb_build_object(
    'id', v_friendship.id,
    'status', v_status,
    'otherUser', private.friend_public_summary(v_other_id),
    'conversationId', v_conversation_id,
    'requestedAt', v_friendship.requested_at,
    'updatedAt', v_friendship.updated_at
  );
end;
$$;

revoke all on function private.friend_public_summary(uuid)
  from public, anon, authenticated;
revoke all on function private.ensure_friend_conversation(uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function private.friendship_payload(uuid, uuid)
  from public, anon, authenticated;

create or replace function public.get_friend_relationship(p_other_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_low_id uuid;
  v_high_id uuid;
  v_friendship_id uuid;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_other_user_id is null or p_other_user_id = v_user_id then
    raise exception 'Choose another member';
  end if;

  if v_user_id::text < p_other_user_id::text then
    v_low_id := v_user_id; v_high_id := p_other_user_id;
  else
    v_low_id := p_other_user_id; v_high_id := v_user_id;
  end if;

  select id into v_friendship_id
  from public.friendships
  where member_low_id = v_low_id and member_high_id = v_high_id;

  if v_friendship_id is null then
    return jsonb_build_object(
      'id', null,
      'status', 'none',
      'otherUser', private.friend_public_summary(p_other_user_id),
      'conversationId', null,
      'requestedAt', null,
      'updatedAt', null
    );
  end if;
  return private.friendship_payload(v_friendship_id, v_user_id);
end;
$$;

create or replace function public.list_friend_connections()
returns setof jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  return query
  select private.friendship_payload(f.id, v_user_id)
  from public.friendships f
  where v_user_id in (f.member_low_id, f.member_high_id)
    and f.status in ('pending', 'accepted')
  order by
    case
      when f.status = 'pending' and f.requested_by <> v_user_id then 0
      when f.status = 'accepted' then 1
      else 2
    end,
    f.updated_at desc,
    f.id;
end;
$$;

create or replace function public.send_friend_request(p_other_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_low_id uuid;
  v_high_id uuid;
  v_friendship public.friendships%rowtype;
  v_sender_name text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_other_user_id is null or p_other_user_id = v_user_id then
    raise exception 'You cannot add yourself as a friend';
  end if;
  if not exists (select 1 from public.profiles where id = v_user_id and status = 'active') then
    raise exception 'Your account is unavailable';
  end if;
  if not exists (select 1 from public.profiles where id = p_other_user_id and status = 'active') then
    raise exception 'This member is unavailable';
  end if;

  if v_user_id::text < p_other_user_id::text then
    v_low_id := v_user_id; v_high_id := p_other_user_id;
  else
    v_low_id := p_other_user_id; v_high_id := v_user_id;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('m3-friend:' || v_low_id::text || ':' || v_high_id::text, 0)
  );

  select * into v_friendship
  from public.friendships
  where member_low_id = v_low_id and member_high_id = v_high_id
  for update;

  if found and v_friendship.status = 'accepted' then
    return private.friendship_payload(v_friendship.id, v_user_id);
  end if;
  if found and v_friendship.status = 'pending' then
    if v_friendship.requested_by = v_user_id then
      return private.friendship_payload(v_friendship.id, v_user_id);
    end if;
    raise exception 'This member has already sent you a friend request';
  end if;

  if found then
    update public.friendships
    set requested_by = v_user_id,
        status = 'pending',
        request_revision = request_revision + 1,
        requested_at = now(),
        responded_at = null,
        updated_at = now()
    where id = v_friendship.id
    returning * into v_friendship;
  else
    insert into public.friendships (
      member_low_id, member_high_id, requested_by
    ) values (
      v_low_id, v_high_id, v_user_id
    ) returning * into v_friendship;
  end if;

  v_sender_name := coalesce(
    private.friend_public_summary(v_user_id)->>'displayName',
    'A member'
  );
  perform private.create_user_notification(
    p_other_user_id,
    'm3',
    'friend_request',
    coalesce(v_sender_name, 'A member') || ' sent you a friend request',
    'Open Friends to accept or decline the request.',
    '/message/friends',
    jsonb_build_object(
      'friendshipId', v_friendship.id,
      'requesterId', v_user_id,
      'requestRevision', v_friendship.request_revision
    ),
    'friend-request:' || v_friendship.id::text || ':' || v_friendship.request_revision::text
  );
  return private.friendship_payload(v_friendship.id, v_user_id);
end;
$$;

create or replace function public.respond_to_friend_request(
  p_other_user_id uuid,
  p_accept boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_low_id uuid;
  v_high_id uuid;
  v_friendship public.friendships%rowtype;
  v_conversation_id uuid;
  v_responder_name text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_other_user_id is null or p_other_user_id = v_user_id or p_accept is null then
    raise exception 'A valid friend request response is required';
  end if;
  if not exists (select 1 from public.profiles where id = v_user_id and status = 'active')
     or not exists (select 1 from public.profiles where id = p_other_user_id and status = 'active') then
    raise exception 'This friend request is unavailable';
  end if;

  if v_user_id::text < p_other_user_id::text then
    v_low_id := v_user_id; v_high_id := p_other_user_id;
  else
    v_low_id := p_other_user_id; v_high_id := v_user_id;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('m3-friend:' || v_low_id::text || ':' || v_high_id::text, 0)
  );

  select * into v_friendship
  from public.friendships
  where member_low_id = v_low_id and member_high_id = v_high_id
  for update;
  if not found or v_friendship.status <> 'pending'
     or v_friendship.requested_by <> p_other_user_id then
    raise exception 'This incoming friend request is unavailable';
  end if;

  update public.friendships
  set status = case when p_accept then 'accepted' else 'declined' end,
      responded_at = now(),
      updated_at = now()
  where id = v_friendship.id
  returning * into v_friendship;

  if p_accept then
    v_conversation_id := private.ensure_friend_conversation(v_friendship.id, now());
    v_responder_name := coalesce(
      private.friend_public_summary(v_user_id)->>'displayName',
      'A member'
    );
    perform private.create_user_notification(
      p_other_user_id,
      'm3',
      'friend_accepted',
      coalesce(v_responder_name, 'A member') || ' accepted your friend request',
      'Your permanent friend chat is ready.',
      '/message/' || v_conversation_id::text,
      jsonb_build_object(
        'friendshipId', v_friendship.id,
        'conversationId', v_conversation_id
      ),
      'friend-accepted:' || v_friendship.id::text || ':' || v_friendship.request_revision::text
    );
  end if;

  return private.friendship_payload(v_friendship.id, v_user_id);
end;
$$;

create or replace function public.cancel_friend_request(p_other_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_low_id uuid;
  v_high_id uuid;
  v_friendship public.friendships%rowtype;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_other_user_id is null or p_other_user_id = v_user_id then
    raise exception 'Choose another member';
  end if;
  if v_user_id::text < p_other_user_id::text then
    v_low_id := v_user_id; v_high_id := p_other_user_id;
  else
    v_low_id := p_other_user_id; v_high_id := v_user_id;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('m3-friend:' || v_low_id::text || ':' || v_high_id::text, 0)
  );
  select * into v_friendship
  from public.friendships
  where member_low_id = v_low_id and member_high_id = v_high_id
  for update;
  if not found or v_friendship.status <> 'pending' or v_friendship.requested_by <> v_user_id then
    raise exception 'This outgoing friend request is unavailable';
  end if;
  update public.friendships
  set status = 'removed', responded_at = now(), updated_at = now()
  where id = v_friendship.id
  returning * into v_friendship;
  return private.friendship_payload(v_friendship.id, v_user_id);
end;
$$;

create or replace function public.remove_friend(p_other_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_low_id uuid;
  v_high_id uuid;
  v_friendship public.friendships%rowtype;
  v_conversation_id uuid;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_other_user_id is null or p_other_user_id = v_user_id then
    raise exception 'Choose another member';
  end if;
  if v_user_id::text < p_other_user_id::text then
    v_low_id := v_user_id; v_high_id := p_other_user_id;
  else
    v_low_id := p_other_user_id; v_high_id := v_user_id;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('m3-friend:' || v_low_id::text || ':' || v_high_id::text, 0)
  );
  select * into v_friendship
  from public.friendships
  where member_low_id = v_low_id and member_high_id = v_high_id
  for update;
  if not found or v_friendship.status <> 'accepted' then
    raise exception 'This friendship is unavailable';
  end if;

  update public.friendships
  set status = 'removed', responded_at = now(), updated_at = now()
  where id = v_friendship.id
  returning * into v_friendship;

  select id into v_conversation_id
  from public.conversations
  where friendship_id = v_friendship.id and scope = 'friend';
  if v_conversation_id is not null then
    update public.conversations set updated_at = now() where id = v_conversation_id;
    update public.call_sessions
    set status = case when status = 'ringing' then 'cancelled' else 'ended' end,
        ended_at = coalesce(ended_at, now()),
        updated_at = now()
    where conversation_id = v_conversation_id and status in ('ringing', 'accepted');
  end if;
  return private.friendship_payload(v_friendship.id, v_user_id);
end;
$$;

create or replace function public.open_friend_conversation(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_low_id uuid;
  v_high_id uuid;
  v_friendship_id uuid;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_other_user_id is null or p_other_user_id = v_user_id then
    raise exception 'Choose another member';
  end if;
  if v_user_id::text < p_other_user_id::text then
    v_low_id := v_user_id; v_high_id := p_other_user_id;
  else
    v_low_id := p_other_user_id; v_high_id := v_user_id;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('m3-friend:' || v_low_id::text || ':' || v_high_id::text, 0)
  );
  select id into v_friendship_id
  from public.friendships
  where member_low_id = v_low_id
    and member_high_id = v_high_id
    and status = 'accepted';
  if v_friendship_id is null then raise exception 'An accepted friendship is required'; end if;
  return private.ensure_friend_conversation(v_friendship_id, now());
end;
$$;

revoke all on function public.get_friend_relationship(uuid) from public, anon, authenticated;
revoke all on function public.list_friend_connections() from public, anon, authenticated;
revoke all on function public.send_friend_request(uuid) from public, anon, authenticated;
revoke all on function public.respond_to_friend_request(uuid, boolean) from public, anon, authenticated;
revoke all on function public.cancel_friend_request(uuid) from public, anon, authenticated;
revoke all on function public.remove_friend(uuid) from public, anon, authenticated;
revoke all on function public.open_friend_conversation(uuid) from public, anon, authenticated;
grant execute on function public.get_friend_relationship(uuid) to authenticated;
grant execute on function public.list_friend_connections() to authenticated;
grant execute on function public.send_friend_request(uuid) to authenticated;
grant execute on function public.respond_to_friend_request(uuid, boolean) to authenticated;
grant execute on function public.cancel_friend_request(uuid) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
grant execute on function public.open_friend_conversation(uuid) to authenticated;

-- Friend history remains visible after removal, while every user-message and
-- call admission path shares this accepted-friendship write gate.
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
    left join public.friendships f on f.id = c.friendship_id
    where cm.conversation_id = p_conversation_id
      and cm.user_id = p_user_id
      and cm.left_at is null
      and (c.expires_at is null or c.expires_at > now())
      and (
        (
          c.scope = 'ride'
          and not (c.type = 'group' and c.ride_status in ('Cancelled', 'Expired'))
        )
        or (
          c.scope = 'friend'
          and f.status = 'accepted'
          and p_user_id in (f.member_low_id, f.member_high_id)
          and exists (
            select 1 from public.profiles low_profile
            where low_profile.id = f.member_low_id and low_profile.status = 'active'
          )
          and exists (
            select 1 from public.profiles high_profile
            where high_profile.id = f.member_high_id and high_profile.status = 'active'
          )
        )
      )
  );
$$;
revoke all on function private.conversation_is_writable(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.conversation_is_writable(uuid, uuid) to authenticated;

create or replace function private.conversation_personal_controls_allowed(
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
    select 1 from public.conversations c
    where c.id = p_conversation_id
      and (select private.conversation_is_visible(c.id, p_user_id))
      and (
        c.scope = 'friend'
        or (c.scope = 'ride' and c.ride_status in ('Completed', 'Cancelled', 'Expired'))
      )
  );
$$;
revoke all on function private.conversation_personal_controls_allowed(uuid, uuid)
  from public, anon, authenticated;

create or replace function public.archive_conversation(p_conversation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null or not (
    select private.conversation_personal_controls_allowed(p_conversation_id, v_user_id)
  ) then raise exception 'Conversation cannot be archived'; end if;
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
  if v_user_id is null or not (
    select private.conversation_personal_controls_allowed(p_conversation_id, v_user_id)
  ) then raise exception 'Conversation cannot be unarchived'; end if;
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
  if v_user_id is null or not (
    select private.conversation_personal_controls_allowed(p_conversation_id, v_user_id)
  ) then raise exception 'Conversation cannot be deleted for you'; end if;
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
  if v_user_id is null or p_muted is null or not (
    select private.conversation_personal_controls_allowed(p_conversation_id, v_user_id)
  ) then raise exception 'Conversation cannot be muted'; end if;
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

-- Retained friend-chat members may continue seeing the same safe identity fields
-- after an unfriend. Contact details remain in profile_private and are untouched.
create or replace function private.profile_is_relevant_to_viewer(
  p_profile_id uuid,
  p_viewer_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_profile_id = p_viewer_id
    or exists (
      select 1 from public.rides r
      where r.host_id = p_profile_id and r.status = 'Published'
    )
    or (
      p_viewer_id is not null
      and exists (
        select 1
        from public.ride_requests rr
        join public.rides r on r.id = rr.ride_id
        where (rr.requester_id = p_profile_id and r.host_id = p_viewer_id)
           or (r.host_id = p_profile_id and rr.requester_id = p_viewer_id)
      )
    )
    or (
      p_viewer_id is not null
      and exists (
        select 1
        from public.conversations c
        join public.conversation_members viewer
          on viewer.conversation_id = c.id and viewer.user_id = p_viewer_id
        join public.conversation_members profile_member
          on profile_member.conversation_id = c.id and profile_member.user_id = p_profile_id
        where c.scope = 'friend'
      )
    );
$$;
revoke all on function private.profile_is_relevant_to_viewer(uuid, uuid)
  from public;
grant usage on schema private to anon, authenticated;
grant execute on function private.profile_is_relevant_to_viewer(uuid, uuid)
  to anon, authenticated;

do $$
begin
  alter publication supabase_realtime add table public.friendships;
exception
  when duplicate_object then null;
end $$;

commit;
