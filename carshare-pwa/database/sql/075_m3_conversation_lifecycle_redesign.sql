-- Module 3: persistent direct conversations, personal conversation state,
-- account blocking, and ride-group closure without ride-terminal expiry.

begin;

-- Account-level blocks are intentionally separate from conversation state.
create table public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_user_id),
  constraint user_blocks_distinct_users check (blocker_id <> blocked_user_id)
);
create index user_blocks_blocked_user_idx
  on public.user_blocks (blocked_user_id, blocker_id);
alter table public.user_blocks enable row level security;
create policy "users read blocks they created"
  on public.user_blocks for select to authenticated
  using (blocker_id = (select auth.uid()));
revoke all on table public.user_blocks from public, anon, authenticated;
grant select on table public.user_blocks to authenticated;

create or replace function private.users_are_blocked(p_first uuid, p_second uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_first is not null
    and p_second is not null
    and exists (
      select 1 from public.user_blocks ub
      where (ub.blocker_id = p_first and ub.blocked_user_id = p_second)
         or (ub.blocker_id = p_second and ub.blocked_user_id = p_first)
    );
$$;
revoke all on function private.users_are_blocked(uuid, uuid) from public, anon, authenticated;

create or replace function private.users_share_accepted_ride(p_first uuid, p_second uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.rides r
    join public.ride_requests rr on rr.ride_id = r.id
    where rr.accepted_at is not null
      and ((r.host_id = p_first and rr.requester_id = p_second)
        or (r.host_id = p_second and rr.requester_id = p_first))
  );
$$;
revoke all on function private.users_share_accepted_ride(uuid, uuid) from public, anon, authenticated;

-- Policy-facing helpers bind the viewer to auth.uid(). This avoids recursive
-- profiles/rides/ride_requests policy evaluation without exposing an arbitrary
-- two-account block oracle through the Data API.
create or replace function private.viewer_can_contact(p_other_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is null
    or not private.users_are_blocked(auth.uid(), p_other_user_id);
$$;
revoke all on function private.viewer_can_contact(uuid) from public, anon, authenticated;
grant execute on function private.viewer_can_contact(uuid) to anon, authenticated;

create or replace function private.viewer_can_view_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() = p_profile_id
    or private.viewer_can_contact(p_profile_id)
    or private.users_share_accepted_ride(auth.uid(), p_profile_id);
$$;
revoke all on function private.viewer_can_view_profile(uuid) from public, anon, authenticated;
grant execute on function private.viewer_can_view_profile(uuid) to authenticated;

create or replace function private.viewer_can_view_ride(p_ride_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.rides r
    where r.id = p_ride_id
      and (
        r.host_id = auth.uid()
        or private.viewer_can_contact(r.host_id)
        or exists (
          select 1 from public.ride_requests rr
          where rr.ride_id = r.id
            and rr.requester_id = auth.uid()
            and rr.accepted_at is not null
        )
      )
  );
$$;
revoke all on function private.viewer_can_view_ride(uuid) from public, anon, authenticated;
grant execute on function private.viewer_can_view_ride(uuid) to authenticated;

create or replace function private.viewer_can_view_ride_request(
  p_ride_id uuid,
  p_requester_id uuid,
  p_accepted_at timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_accepted_at is not null
    or exists (
      select 1 from public.rides r
      where r.id = p_ride_id
        and auth.uid() in (r.host_id, p_requester_id)
        and not private.users_are_blocked(r.host_id, p_requester_id)
    );
$$;
revoke all on function private.viewer_can_view_ride_request(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function private.viewer_can_view_ride_request(uuid, uuid, timestamptz)
  to authenticated;

alter table public.conversation_members
  add column deleted_before timestamptz;
alter table public.conversation_members
  drop constraint if exists conversation_members_role_check;
alter table public.conversation_members
  add constraint conversation_members_role_check
  check (role in ('member', 'host', 'traveller'));

alter table public.conversations
  add column direct_participant_low_id uuid references public.profiles(id) on delete cascade,
  add column direct_participant_high_id uuid references public.profiles(id) on delete cascade,
  add column closed_at timestamptz;

create table public.conversation_ride_contexts (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  ride_id uuid not null references public.rides(id) on delete cascade,
  added_by uuid references public.profiles(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (conversation_id, ride_id)
);
create index conversation_ride_contexts_ride_idx
  on public.conversation_ride_contexts (ride_id, conversation_id);

create table public.conversation_aliases (
  old_conversation_id uuid primary key,
  canonical_conversation_id uuid not null references public.conversations(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint conversation_aliases_distinct_ids
    check (old_conversation_id <> canonical_conversation_id)
);
create index conversation_aliases_canonical_idx
  on public.conversation_aliases (canonical_conversation_id);

-- Derive stable unordered direct pairs from membership before merging.
update public.conversations c
set direct_participant_low_id = pair.low_id,
    direct_participant_high_id = pair.high_id
from (
  select cm.conversation_id,
         min(cm.user_id::text)::uuid as low_id,
         max(cm.user_id::text)::uuid as high_id
  from public.conversation_members cm
  join public.conversations direct on direct.id = cm.conversation_id
  where direct.type = 'direct'
  group by cm.conversation_id
  having count(*) = 2
) pair
where c.id = pair.conversation_id;

insert into public.conversation_ride_contexts (conversation_id, ride_id, added_by, added_at)
select c.id, c.ride_id, c.direct_user_id, c.created_at
from public.conversations c
where c.type = 'direct' and c.ride_id is not null
on conflict do nothing;

create temporary table m3_direct_merge_map on commit drop as
select id as source_id,
       first_value(id) over (
         partition by direct_participant_low_id, direct_participant_high_id
         order by created_at, id
       ) as canonical_id
from public.conversations
where type = 'direct';

insert into public.conversation_aliases (old_conversation_id, canonical_conversation_id)
select source_id, canonical_id
from m3_direct_merge_map
where source_id <> canonical_id;

-- Ride context follows the canonical pair.
insert into public.conversation_ride_contexts (conversation_id, ride_id, added_by, added_at)
select map.canonical_id, context.ride_id, context.added_by, context.added_at
from public.conversation_ride_contexts context
join m3_direct_merge_map map on map.source_id = context.conversation_id
on conflict (conversation_id, ride_id) do update
set added_at = least(public.conversation_ride_contexts.added_at, excluded.added_at);

update public.messages m
set conversation_id = map.canonical_id
from m3_direct_merge_map map
where m.conversation_id = map.source_id
  and map.source_id <> map.canonical_id;

update public.call_sessions cs
set conversation_id = map.canonical_id
from m3_direct_merge_map map
where cs.conversation_id = map.source_id
  and map.source_id <> map.canonical_id;

create temporary table m3_direct_member_rollup on commit drop as
select map.canonical_id as conversation_id,
       cm.user_id,
       min(cm.joined_at) as joined_at,
       max(cm.last_read_at) as last_read_at,
       case when bool_or(cm.archived_at is null) then null else max(cm.archived_at) end as archived_at
from public.conversation_members cm
join m3_direct_merge_map map on map.source_id = cm.conversation_id
group by map.canonical_id, cm.user_id;

insert into public.conversation_members (
  conversation_id, user_id, role, joined_at, left_at, archived_at, last_read_at
)
select conversation_id, user_id, 'member', joined_at, null, archived_at, last_read_at
from m3_direct_member_rollup
on conflict (conversation_id, user_id) do update
set role = 'member',
    joined_at = least(public.conversation_members.joined_at, excluded.joined_at),
    left_at = null,
    archived_at = excluded.archived_at,
    last_read_at = greatest(public.conversation_members.last_read_at, excluded.last_read_at);

delete from public.conversation_members cm
using m3_direct_merge_map map
where cm.conversation_id = map.source_id
  and map.source_id <> map.canonical_id;

delete from public.conversation_ride_contexts context
using m3_direct_merge_map map
where context.conversation_id = map.source_id
  and map.source_id <> map.canonical_id;

delete from public.conversations c
using m3_direct_merge_map map
where c.id = map.source_id
  and map.source_id <> map.canonical_id;

drop index if exists public.conversations_one_direct_per_ride_user_idx;
alter table public.conversations alter column ride_id drop not null;
alter table public.conversations alter column ride_status drop not null;
alter table public.conversations drop constraint if exists conversations_type_shape_check;
alter table public.conversations drop constraint if exists conversations_expiry_check;

update public.conversations
set ride_id = null,
    direct_user_id = null,
    ride_status = null,
    terminal_at = null,
    expires_at = null,
    trip_route = null,
    trip_departure_at = null
where type = 'direct';
update public.conversations
set terminal_at = null, expires_at = null
where type = 'group';

alter table public.conversations
  add constraint conversations_lifecycle_shape_check check (
    (type = 'direct'
      and ride_id is null
      and direct_participant_low_id is not null
      and direct_participant_high_id is not null
      and direct_participant_low_id::text < direct_participant_high_id::text
      and closed_at is null)
    or
    (type = 'group'
      and ride_id is not null
      and direct_participant_low_id is null
      and direct_participant_high_id is null)
  );
create unique index conversations_one_direct_per_pair_idx
  on public.conversations (direct_participant_low_id, direct_participant_high_id)
  where type = 'direct';

-- Recompute summaries after direct timelines have been merged.
update public.conversations c
set last_message_id = (
      select m.id from public.messages m where m.conversation_id = c.id
      order by m.created_at desc, m.id desc limit 1
    ),
    last_message_at = (
      select m.created_at from public.messages m where m.conversation_id = c.id
      order by m.created_at desc, m.id desc limit 1
    );

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
      and c.closed_at is null
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
      and c.closed_at is null
      and (
        c.type = 'group'
        or not (select private.users_are_blocked(
          c.direct_participant_low_id,
          c.direct_participant_high_id
        ))
      )
  );
$$;

create or replace function private.message_is_visible(p_message_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.messages m
    join public.conversation_members cm
      on cm.conversation_id = m.conversation_id and cm.user_id = p_user_id
    where m.id = p_message_id
      and cm.left_at is null
      and (select private.conversation_is_visible(m.conversation_id, p_user_id))
      and (cm.deleted_before is null or m.created_at > cm.deleted_before)
  );
$$;

revoke all on function private.conversation_is_visible(uuid, uuid) from public, anon, authenticated;
revoke all on function private.conversation_is_writable(uuid, uuid) from public, anon, authenticated;
revoke all on function private.message_is_visible(uuid, uuid) from public, anon, authenticated;
grant execute on function private.conversation_is_visible(uuid, uuid) to authenticated;
grant execute on function private.conversation_is_writable(uuid, uuid) to authenticated;
grant execute on function private.message_is_visible(uuid, uuid) to authenticated;

alter table public.conversation_ride_contexts enable row level security;
alter table public.conversation_aliases enable row level security;
create policy "members read direct ride contexts"
  on public.conversation_ride_contexts for select to authenticated
  using (
    (select private.conversation_is_visible(conversation_id, (select auth.uid())))
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_ride_contexts.conversation_id
        and (
          c.type = 'group'
          or (select private.viewer_can_view_ride(conversation_ride_contexts.ride_id))
        )
    )
  );
create policy "members read conversation aliases"
  on public.conversation_aliases for select to authenticated
  using ((select private.conversation_is_visible(canonical_conversation_id, (select auth.uid()))));
revoke all on table public.conversation_ride_contexts from public, anon, authenticated;
revoke all on table public.conversation_aliases from public, anon, authenticated;
grant select on table public.conversation_ride_contexts to authenticated;
grant select on table public.conversation_aliases to authenticated;

drop policy if exists "members read visible messages" on public.messages;
create policy "members read personally visible messages"
  on public.messages for select to authenticated
  using ((select private.message_is_visible(id, (select auth.uid()))));
drop policy if exists "members read visible attachments" on public.message_attachments;
create policy "members read personally visible attachments"
  on public.message_attachments for select to authenticated
  using ((select private.message_is_visible(message_id, (select auth.uid()))));
drop policy if exists "members read visible message translations" on public.message_translations;
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
drop policy if exists "visible conversation participants read their calls" on public.call_sessions;
drop policy if exists "call participants read their calls" on public.call_sessions;
create policy "participants read personally visible calls"
  on public.call_sessions for select to authenticated
  using (
    (select auth.uid()) in (caller_id, callee_id)
    and (select private.conversation_is_visible(conversation_id, (select auth.uid())))
    and created_at > coalesce((
      select cm.deleted_before
      from public.conversation_members cm
      where cm.conversation_id = call_sessions.conversation_id
        and cm.user_id = (select auth.uid())
    ), '-infinity'::timestamptz)
  );

create or replace function public.resolve_conversation_id(p_conversation_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_resolved uuid;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select coalesce(a.canonical_conversation_id, p_conversation_id)
  into v_resolved
  from (select p_conversation_id as id) input
  left join public.conversation_aliases a on a.old_conversation_id = input.id;
  if not (select private.conversation_is_visible(v_resolved, v_user_id)) then
    raise exception 'Conversation unavailable';
  end if;
  return v_resolved;
end;
$$;

create or replace function public.open_ride_direct_conversation(p_ride_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_ride public.rides%rowtype;
  v_low uuid;
  v_high uuid;
  v_conversation_id uuid;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found or v_ride.status <> 'Published' then
    raise exception 'Only a Published ride can start a private conversation';
  end if;
  if v_ride.host_id = v_user_id then raise exception 'Hosts cannot message themselves'; end if;
  if (select private.users_are_blocked(v_user_id, v_ride.host_id)) then
    raise exception 'Private interaction is unavailable';
  end if;
  v_low := least(v_user_id::text, v_ride.host_id::text)::uuid;
  v_high := greatest(v_user_id::text, v_ride.host_id::text)::uuid;
  insert into public.conversations (
    type, direct_participant_low_id, direct_participant_high_id, last_message_at
  ) values ('direct', v_low, v_high, now())
  on conflict (direct_participant_low_id, direct_participant_high_id) where type = 'direct'
  do update set updated_at = now()
  returning id into v_conversation_id;
  insert into public.conversation_members (conversation_id, user_id, role)
  values (v_conversation_id, v_low, 'member'), (v_conversation_id, v_high, 'member')
  on conflict (conversation_id, user_id) do update set role = 'member', left_at = null;
  insert into public.conversation_ride_contexts (conversation_id, ride_id, added_by)
  values (v_conversation_id, p_ride_id, v_user_id)
  on conflict do nothing;
  return v_conversation_id;
end;
$$;

create or replace function public.archive_conversation(p_conversation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null or not (select private.conversation_is_visible(p_conversation_id, v_user_id)) then
    raise exception 'Conversation unavailable';
  end if;
  update public.conversation_members
  set archived_at = coalesce(archived_at, now())
  where conversation_id = p_conversation_id and user_id = v_user_id and left_at is null;
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
  if v_user_id is null or not (select private.conversation_is_visible(p_conversation_id, v_user_id)) then
    raise exception 'Conversation unavailable';
  end if;
  update public.conversation_members set archived_at = null
  where conversation_id = p_conversation_id and user_id = v_user_id and left_at is null;
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
    where c.id = p_conversation_id and c.type = 'direct'
      and (select private.conversation_is_visible(c.id, v_user_id))
  ) then raise exception 'Private conversation unavailable'; end if;
  update public.conversation_members
  set deleted_before = now(), archived_at = null, last_read_at = now()
  where conversation_id = p_conversation_id and user_id = v_user_id and left_at is null;
  return found;
end;
$$;

create or replace function public.get_user_block_state(p_user_id uuid)
returns table (blocked_by_me boolean, interaction_blocked boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_blocks
    where blocker_id = auth.uid() and blocked_user_id = p_user_id
  ), (select private.users_are_blocked(auth.uid(), p_user_id))
  where auth.uid() is not null and p_user_id is distinct from auth.uid();
$$;

create or replace function public.block_user(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_user_id is null or p_user_id = v_user_id
     or not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'User unavailable';
  end if;
  insert into public.user_blocks (blocker_id, blocked_user_id)
  values (v_user_id, p_user_id) on conflict do nothing;
  update public.conversations
  set updated_at = now()
  where type = 'direct'
    and direct_participant_low_id = least(v_user_id::text, p_user_id::text)::uuid
    and direct_participant_high_id = greatest(v_user_id::text, p_user_id::text)::uuid;
  update public.ride_requests rr
  set status = 'Cancelled', cancelled_by = 'System', cancelled_at = now(), processed_at = now()
  from public.rides r
  where r.id = rr.ride_id and rr.status = 'Pending'
    and ((r.host_id = v_user_id and rr.requester_id = p_user_id)
      or (r.host_id = p_user_id and rr.requester_id = v_user_id));
  update public.call_sessions
  set status = case when status = 'ringing' then 'cancelled' else 'ended' end,
      ended_at = now(), updated_at = now()
  where status in ('ringing', 'accepted')
    and ((caller_id = v_user_id and callee_id = p_user_id)
      or (caller_id = p_user_id and callee_id = v_user_id));
  return true;
end;
$$;

create or replace function public.unblock_user(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid := auth.uid(); v_removed boolean;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  delete from public.user_blocks
  where blocker_id = v_user_id and blocked_user_id = p_user_id;
  v_removed := found;
  update public.conversations
  set updated_at = now()
  where type = 'direct'
    and direct_participant_low_id = least(v_user_id::text, p_user_id::text)::uuid
    and direct_participant_high_id = greatest(v_user_id::text, p_user_id::text)::uuid;
  return v_removed;
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
  v_role text;
  v_name text;
  v_message_id uuid;
  v_travellers_remaining integer;
begin
  perform 1 from public.conversations c
  where c.id = p_conversation_id and c.type = 'group'
    and c.ride_status in ('Completed', 'Cancelled', 'Expired') and c.closed_at is null
  for update;
  if v_user_id is null or not found then raise exception 'Only an ended group can be left'; end if;
  select role into v_role from public.conversation_members
  where conversation_id = p_conversation_id and user_id = v_user_id and left_at is null
  for update;
  if v_role is distinct from 'traveller' then raise exception 'Only Travellers can leave the ride group'; end if;
  perform 1 from public.conversation_members
  where conversation_id = p_conversation_id and left_at is null
  order by user_id for update;
  select full_name into v_name from public.profiles where id = v_user_id;
  update public.conversation_members
  set left_at = now(), archived_at = null
  where conversation_id = p_conversation_id and user_id = v_user_id;
  insert into public.messages (conversation_id, sender_id, kind, text_content)
  values (p_conversation_id, null, 'system', coalesce(v_name, 'A member') || ' left the group.')
  returning id into v_message_id;
  select count(*) into v_travellers_remaining
  from public.conversation_members
  where conversation_id = p_conversation_id and role = 'traveller' and left_at is null;
  if v_travellers_remaining = 0 then
    update public.conversation_members set left_at = now(), archived_at = null
    where conversation_id = p_conversation_id and role = 'host' and left_at is null;
    update public.conversations set closed_at = now(), last_message_id = v_message_id,
      last_message_at = now(), updated_at = now() where id = p_conversation_id;
  else
    update public.conversations set last_message_id = v_message_id,
      last_message_at = now(), updated_at = now() where id = p_conversation_id;
  end if;
  return v_message_id;
end;
$$;

-- Ride lifecycle remains context for groups only and never sets a retention expiry.
create or replace function public.set_messaging_ride_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    update public.conversations
    set ride_status = new.status, updated_at = now()
    where ride_id = new.id and type = 'group' and closed_at is null;
  end if;
  return new;
end;
$$;

-- Preserve the current composite/voice/notification contract while removing
-- archive and ride-terminal write gates. A user message restores every active
-- member's inbox placement.
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
  if not found then raise exception 'This conversation is unavailable for messaging'; end if;
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
  set archived_at = null,
      last_read_at = case when user_id = v_user_id then now() else last_read_at end
  where conversation_id = p_conversation_id and left_at is null;
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
  select * into v_message from public.messages where id = p_message_id for update;
  if v_user_id is null or not found or v_message.sender_id <> v_user_id
     or v_message.kind <> 'user' or v_message.deleted_at is not null then
    raise exception 'Only the original sender may delete this message';
  end if;
  if not (select private.conversation_is_visible(v_message.conversation_id, v_user_id)) then
    raise exception 'Conversation unavailable';
  end if;
  select coalesce(array_agg(storage_path) filter (where storage_path is not null), '{}')
  into v_paths from public.message_attachments where message_id = p_message_id;
  delete from public.message_attachments where message_id = p_message_id;
  update public.messages set text_content = null, deleted_at = now(), edited_at = null
  where id = p_message_id;
  return v_paths;
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
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select * into v_message from public.messages where id = p_message_id for update;
  if not found or v_message.sender_id <> v_user_id or v_message.kind <> 'user'
     or v_message.deleted_at is not null then
    raise exception 'Only the original sender may edit this message';
  end if;
  if not (select private.conversation_is_writable(v_message.conversation_id, v_user_id)) then
    raise exception 'Conversation unavailable for editing';
  end if;
  perform 1 from public.conversation_members cm
  where cm.conversation_id = v_message.conversation_id
  order by cm.user_id for update;
  if exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = v_message.conversation_id
      and cm.user_id <> v_user_id and cm.last_read_at is not null
      and cm.last_read_at >= v_message.created_at
  ) then raise exception 'This message has already been read and cannot be edited'; end if;
  if p_attachments is null or jsonb_typeof(p_attachments) <> 'array' then
    raise exception 'Attachments must be an array';
  end if;
  if exists (
    select 1 from public.message_attachments ma
    where ma.message_id = p_message_id and ma.kind = 'audio'
  ) or exists (
    select 1 from jsonb_array_elements(p_attachments) as attachments(item)
    where item->>'kind' = 'audio'
  ) then raise exception 'Voice messages cannot be edited'; end if;
  if v_text is not null and char_length(v_text) > 1000 then
    raise exception 'Message must not exceed 1000 characters';
  end if;
  select count(*) filter (where item->>'kind' in ('image', 'video')),
    count(*) filter (where item->>'kind' = 'location'),
    coalesce(sum(case when item->>'kind' in ('image', 'video')
      then (item->>'file_size')::bigint else 0 end), 0)
  into v_media_count, v_location_count, v_total_bytes
  from jsonb_array_elements(p_attachments) as attachments(item);
  if v_text is null and jsonb_array_length(p_attachments) = 0 then
    raise exception 'Add text, media, or a location before saving';
  end if;
  if v_media_count > 10 or v_location_count > 1
     or v_media_count + v_location_count <> jsonb_array_length(p_attachments) then
    raise exception 'Invalid attachment selection';
  end if;
  if v_total_bytes > 104857600 then raise exception 'Message media must not exceed 100 MB in total'; end if;
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
        select 1 from storage.objects o
        where o.bucket_id = 'message-media' and o.name = v_attachment->>'storage_path'
          and o.owner_id = v_user_id::text
          and coalesce((o.metadata->>'size')::bigint, -1) = (v_attachment->>'file_size')::bigint
          and coalesce(o.metadata->>'mimetype', '') = v_attachment->>'mime_type'
      ) then raise exception 'Uploaded media could not be verified'; end if;
    end if;
  end loop;
  delete from public.message_attachments where message_id = p_message_id;
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
  update public.messages set text_content = v_text, edited_at = now()
  where id = p_message_id;
  return p_message_id;
end;
$$;

create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid := auth.uid(); v_latest timestamptz;
begin
  if v_user_id is null or not (select private.conversation_is_visible(p_conversation_id, v_user_id)) then
    raise exception 'Conversation unavailable';
  end if;
  select max(m.created_at) into v_latest
  from public.messages m
  join public.conversation_members cm
    on cm.conversation_id = m.conversation_id and cm.user_id = v_user_id
  where m.conversation_id = p_conversation_id
    and m.sender_id is distinct from v_user_id
    and (cm.deleted_before is null or m.created_at > cm.deleted_before);
  if v_latest is null then return false; end if;
  update public.conversation_members
  set last_read_at = greatest(coalesce(last_read_at, '-infinity'::timestamptz), v_latest)
  where conversation_id = p_conversation_id and user_id = v_user_id;
  return found;
end;
$$;

create or replace function public.start_voice_call(p_conversation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid := auth.uid(); v_callee_id uuid; v_call_id uuid;
begin
  if v_user_id is null then raise exception 'Sign in before starting a voice call'; end if;
  select other_member.user_id into v_callee_id
  from public.conversations c
  join public.conversation_members current_member
    on current_member.conversation_id = c.id and current_member.user_id = v_user_id
    and current_member.left_at is null
  join public.conversation_members other_member
    on other_member.conversation_id = c.id and other_member.user_id <> v_user_id
    and other_member.left_at is null
  where c.id = p_conversation_id and c.type = 'direct' and c.closed_at is null
    and (select private.conversation_is_writable(c.id, v_user_id))
  order by other_member.user_id limit 1;
  if v_callee_id is null then raise exception 'This private chat is unavailable for calling'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(least(v_user_id::text, v_callee_id::text), 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(greatest(v_user_id::text, v_callee_id::text), 0));
  update public.call_sessions set status = 'missed', ended_at = now(), updated_at = now()
  where status = 'ringing' and created_at < now() - interval '45 seconds'
    and (caller_id in (v_user_id, v_callee_id) or callee_id in (v_user_id, v_callee_id));
  update public.call_sessions set status = 'failed', ended_at = now(), updated_at = now()
  where status = 'accepted' and answered_at < now() - interval '60 minutes'
    and (caller_id in (v_user_id, v_callee_id) or callee_id in (v_user_id, v_callee_id));
  if exists (
    select 1 from public.call_sessions active_call
    where active_call.status in ('ringing', 'accepted')
      and (active_call.caller_id in (v_user_id, v_callee_id)
        or active_call.callee_id in (v_user_id, v_callee_id))
  ) then raise exception 'One of you is already on another call'; end if;
  insert into public.call_sessions (conversation_id, caller_id, callee_id)
  values (p_conversation_id, v_user_id, v_callee_id) returning id into v_call_id;
  update public.conversation_members set archived_at = null
  where conversation_id = p_conversation_id and user_id = v_user_id;
  return v_call_id;
end;
$$;

-- Reject new Pending/Accepted relationships between blocked accounts while
-- preserving already accepted trip obligations.
create or replace function private.guard_blocked_ride_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_host_id uuid;
begin
  if new.status in ('Pending', 'Accepted')
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    select host_id into v_host_id from public.rides where id = new.ride_id;
    if (select private.users_are_blocked(v_host_id, new.requester_id)) then
      raise exception 'Ride interaction is unavailable';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_blocked_ride_request() from public, anon, authenticated;
drop trigger if exists guard_blocked_ride_request on public.ride_requests;
create trigger guard_blocked_ride_request
before insert or update of status on public.ride_requests
for each row execute function private.guard_blocked_ride_request();

-- Account-specific restrictive visibility. Anonymous public browsing remains
-- unchanged because there is no authenticated viewer identity.
create policy "blocked accounts restrict profile visibility"
  on public.profiles as restrictive for select to authenticated
  using ((select private.viewer_can_view_profile(id)));
create policy "blocked accounts restrict ride visibility"
  on public.rides as restrictive for select to authenticated
  using ((select private.viewer_can_view_ride(id)));
create policy "blocked accounts restrict request visibility"
  on public.ride_requests as restrictive for select to authenticated
  using ((select private.viewer_can_view_ride_request(ride_id, requester_id, accepted_at)));

create or replace function public.get_public_profile(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_viewer_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_stats public.host_impact_stats%rowtype;
  v_visibility public.profile_visibility%rowtype;
  v_parts text[];
  v_display_name text;
  v_review_count integer := 0;
  v_evidence_count integer := 0;
begin
  if v_viewer_id is not null
     and (select private.users_are_blocked(v_viewer_id, p_user_id))
     and not (select private.users_share_accepted_ride(v_viewer_id, p_user_id)) then
    return null;
  end if;
  select * into v_profile from public.profiles
  where id = p_user_id and status = 'active';
  if not found then return null; end if;
  select * into v_stats from public.host_impact_stats where user_id = p_user_id;
  select * into v_visibility from public.profile_visibility where user_id = p_user_id;
  if not found then
    v_visibility.show_profile_photo := true;
    v_visibility.show_spoken_languages := true;
    v_visibility.show_completed_trips := true;
    v_visibility.show_eco_impact := false;
  end if;
  v_parts := regexp_split_to_array(btrim(v_profile.full_name), '\s+');
  if coalesce(array_length(v_parts, 1), 0) < 2 then
    v_display_name := coalesce(v_parts[1], 'Member');
  else
    v_display_name := v_parts[1] || ' '
      || upper(left(v_parts[array_length(v_parts, 1)], 1)) || '.';
  end if;
  select count(*)::integer into v_review_count
  from public.ride_reviews where reviewee_id = p_user_id;
  v_evidence_count := private.reputation_evidence_count(p_user_id);
  return jsonb_build_object(
    'id', v_profile.id, 'displayName', v_display_name,
    'profilePhotoUrl', case when v_visibility.show_profile_photo then v_profile.profile_photo_url else null end,
    'spokenLanguages', case when v_visibility.show_spoken_languages
      then to_jsonb(v_profile.spoken_languages) else '[]'::jsonb end,
    'createdAt', v_profile.created_at,
    'reputationScore', coalesce(v_stats.reputation_score, 70),
    'rating', v_stats.rating, 'reviewCount', v_review_count,
    'completedTrips', case when v_visibility.show_completed_trips
      then coalesce(v_stats.completed_trips, 0) else null end,
    'co2SavedKg', case when v_visibility.show_eco_impact
      then coalesce(v_stats.co2_saved_kg, 0) else null end,
    'provisional', v_evidence_count < 3,
    'visibility', jsonb_build_object(
      'showProfilePhoto', v_visibility.show_profile_photo,
      'showSpokenLanguages', v_visibility.show_spoken_languages,
      'showCompletedTrips', v_visibility.show_completed_trips,
      'showEcoImpact', v_visibility.show_eco_impact
    )
  );
end;
$$;

create or replace function public.search_public_rides_near_destination(
  p_destination_place_id text, p_radius_km integer, p_pickup text default null,
  p_departure_start timestamptz default null, p_departure_end timestamptz default null
)
returns table (
  ride_id uuid, host_id uuid, pickup text, destination text, departure_at timestamptz,
  journey_scale text, seats_total integer, seats_available integer, contribution text,
  restriction_tags text[], status text, estimated_arrival_at timestamptz,
  proximity_distance_km double precision, host_full_name text,
  host_profile_photo_url text, host_completed_trips integer, host_co2_saved_kg numeric,
  host_reputation_score integer, host_rating numeric
)
language sql stable security invoker set search_path = ''
as $$
  select q.* from private.search_public_rides_near_destination(
    p_destination_place_id, p_radius_km, p_pickup, p_departure_start, p_departure_end
  ) q
  where (select private.viewer_can_contact(q.host_id));
$$;

create or replace function public.get_public_ride_pickup_context(p_ride_id uuid)
returns table (pickup_instructions text, has_photo boolean)
language sql security definer stable set search_path = ''
as $$
  select coalesce(r.pickup_instructions, ''), r.pickup_photo_path is not null
  from public.rides r
  join public.profiles p on p.id = r.host_id and p.status = 'active'
  where r.id = p_ride_id and r.status = 'Published'
    and (
      auth.uid() is null
      or not (select private.users_are_blocked(auth.uid(), r.host_id))
      or exists (
        select 1 from public.ride_requests rr
        where rr.ride_id = r.id and rr.requester_id = auth.uid() and rr.accepted_at is not null
      )
    );
$$;

create or replace function public.search_public_rides_with_compatibility(
  p_pickup text default null, p_destination text default null,
  p_departure_start timestamptz default null, p_departure_end timestamptz default null,
  p_destination_place_id text default null, p_radius_km integer default null,
  p_vehicle_type text default null, p_language text default null
)
returns table (
  ride_id uuid, host_id uuid, pickup text, destination text, departure_at timestamptz,
  journey_scale text, seats_total integer, seats_available integer, contribution text,
  restriction_tags text[], status text, estimated_arrival_at timestamptz,
  proximity_distance_km double precision, vehicle_type text, host_spoken_languages text[],
  host_full_name text, host_profile_photo_url text, host_completed_trips integer,
  host_co2_saved_kg numeric, host_reputation_score integer, host_rating numeric
)
language sql stable security invoker set search_path = ''
as $$
  select q.* from private.search_public_rides_with_compatibility(
    p_pickup, p_destination, p_departure_start, p_departure_end,
    p_destination_place_id, p_radius_km, p_vehicle_type, p_language
  ) q
  where (select private.viewer_can_contact(q.host_id));
$$;

create or replace function public.list_my_favourite_rides()
returns table (
  ride_id uuid, host_id uuid, pickup text, destination text, departure_at timestamptz,
  journey_scale text, seats_total integer, seats_available integer, contribution text,
  restriction_tags text[], status text, favourited_at timestamptz, vehicle_type text,
  host_spoken_languages text[], host_full_name text, host_profile_photo_url text,
  host_completed_trips integer, host_co2_saved_kg numeric,
  host_reputation_score integer, host_rating numeric
)
language sql stable security invoker set search_path = ''
as $$
  select q.* from private.list_my_favourite_rides() q
  where (select private.viewer_can_contact(q.host_id));
$$;

create or replace function public.search_public_multi_leg_journeys(
  p_pickup text, p_destination text default null,
  p_departure_start timestamptz default null, p_departure_end timestamptz default null,
  p_depart_after time default null, p_destination_place_id text default null,
  p_radius_km integer default null, p_journey_scale text default null,
  p_min_seats integer default 1, p_tags text[] default '{}',
  p_contribution text default null, p_min_rating numeric default null,
  p_vehicle_type text default null, p_language text default null
)
returns table (
  journey_id text, journey_type text, transfer_point_name text,
  transfer_point_category text, wait_minutes integer, estimated_arrival_at timestamptz,
  seats_available integer, journey_scale text, proximity_distance_km double precision,
  legs jsonb
)
language sql stable security invoker set search_path = ''
as $$
  select q.* from private.search_public_multi_leg_journeys(
    p_pickup, p_destination, p_departure_start, p_departure_end, p_depart_after,
    p_destination_place_id, p_radius_km, p_journey_scale, p_min_seats, p_tags,
    p_contribution, p_min_rating, p_vehicle_type, p_language
  ) q
  where auth.uid() is null or not exists (
    select 1 from jsonb_array_elements(q.legs) leg
    where (leg->>'hostId') is not null
      and not (select private.viewer_can_contact((leg->>'hostId')::uuid))
  );
$$;

-- Replace direct-message/call policies and RPC privileges below after all
-- function definitions in this migration.
revoke all on function public.resolve_conversation_id(uuid) from public, anon, authenticated;
revoke all on function public.open_ride_direct_conversation(uuid) from public, anon, authenticated;
revoke all on function public.archive_conversation(uuid) from public, anon, authenticated;
revoke all on function public.unarchive_conversation(uuid) from public, anon, authenticated;
revoke all on function public.delete_conversation_for_me(uuid) from public, anon, authenticated;
revoke all on function public.get_user_block_state(uuid) from public, anon, authenticated;
revoke all on function public.block_user(uuid) from public, anon, authenticated;
revoke all on function public.unblock_user(uuid) from public, anon, authenticated;
revoke all on function public.leave_group_conversation(uuid) from public, anon, authenticated;
grant execute on function public.resolve_conversation_id(uuid) to authenticated;
grant execute on function public.open_ride_direct_conversation(uuid) to authenticated;
grant execute on function public.archive_conversation(uuid) to authenticated;
grant execute on function public.unarchive_conversation(uuid) to authenticated;
grant execute on function public.delete_conversation_for_me(uuid) to authenticated;
grant execute on function public.get_user_block_state(uuid) to authenticated;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;
grant execute on function public.leave_group_conversation(uuid) to authenticated;
revoke all on function public.send_message(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.edit_message(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.delete_message(uuid) from public, anon, authenticated;
revoke all on function public.mark_conversation_read(uuid) from public, anon, authenticated;
revoke all on function public.start_voice_call(uuid) from public, anon, authenticated;
grant execute on function public.send_message(uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.edit_message(uuid, text, jsonb) to authenticated;
grant execute on function public.delete_message(uuid) to authenticated;
grant execute on function public.mark_conversation_read(uuid) to authenticated;
grant execute on function public.start_voice_call(uuid) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_blocks'
  ) then
    execute 'alter publication supabase_realtime add table public.user_blocks';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversation_ride_contexts'
  ) then
    execute 'alter publication supabase_realtime add table public.conversation_ride_contexts';
  end if;
end;
$$;

commit;
