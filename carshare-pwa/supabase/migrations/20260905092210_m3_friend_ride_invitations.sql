-- Friend-chat Ride invitation cards. An invitation stores only a Ride reference;
-- every rendered field is resolved from the current Ride row.

create table public.message_ride_invitations (
  message_id uuid primary key references public.messages(id) on delete cascade,
  ride_id uuid not null references public.rides(id) on delete restrict
);

create index message_ride_invitations_ride_idx
  on public.message_ride_invitations (ride_id);

alter table public.message_ride_invitations enable row level security;

create policy "members read visible ride invitations"
  on public.message_ride_invitations for select to authenticated
  using ((select private.message_is_visible(message_id, (select auth.uid()))));

revoke all on table public.message_ride_invitations from public, anon, authenticated;
grant select on table public.message_ride_invitations to authenticated;

create or replace function public.list_friend_ride_invite_options(p_conversation_id uuid)
returns table (
  ride_id uuid,
  pickup text,
  destination text,
  departure_at timestamptz,
  seats_available integer,
  contribution text,
  ride_status text,
  source_role text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_friend_id uuid;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;

  select other_member.user_id into v_friend_id
  from public.conversations c
  join public.conversation_members own_member
    on own_member.conversation_id = c.id and own_member.user_id = v_user_id
  join public.conversation_members other_member
    on other_member.conversation_id = c.id and other_member.user_id <> v_user_id
  where c.id = p_conversation_id
    and c.scope = 'friend'
    and c.type = 'direct'
    and own_member.left_at is null
    and other_member.left_at is null
    and (select private.conversation_is_writable(c.id, v_user_id))
  limit 1;
  if v_friend_id is null then raise exception 'An accepted friend chat is required'; end if;

  return query
  select r.id, r.pickup, r.destination, r.departure_at, r.seats_available,
         r.contribution, r.status,
         case when r.host_id = v_user_id then 'host' else 'passenger' end
  from public.rides r
  where r.status = 'Published'
    and r.seats_available > 0
    and r.departure_at - interval '1 hour' >= now()
    and r.host_id <> v_friend_id
    and (
      r.host_id = v_user_id
      or exists (
        select 1 from public.ride_requests sender_request
        where sender_request.ride_id = r.id
          and sender_request.requester_id = v_user_id
          and sender_request.status in ('Pending', 'Accepted')
      )
    )
    and not exists (
      select 1 from public.ride_requests friend_request
      where friend_request.ride_id = r.id
        and friend_request.requester_id = v_friend_id
        and friend_request.status in ('Pending', 'Accepted', 'Rejected')
    )
  order by r.departure_at, r.id;
end;
$$;

create or replace function public.get_friend_ride_invitation_cards(p_conversation_id uuid)
returns table (
  message_id uuid,
  ride_id uuid,
  pickup text,
  destination text,
  departure_at timestamptz,
  seats_available integer,
  contribution text,
  ride_status text,
  request_status text,
  can_request boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not (select private.conversation_is_visible(p_conversation_id, v_user_id)) then
    raise exception 'Conversation unavailable';
  end if;

  return query
  select invitation.message_id, r.id, r.pickup, r.destination, r.departure_at,
         r.seats_available, r.contribution, r.status, viewer_request.status,
         (
           r.host_id <> v_user_id
           and r.status = 'Published'
           and r.seats_available > 0
           and r.departure_at - interval '1 hour' >= now()
           and coalesce(viewer_request.status, '') not in ('Pending', 'Accepted', 'Rejected')
         ) as can_request
  from public.message_ride_invitations invitation
  join public.messages message on message.id = invitation.message_id
  join public.rides r on r.id = invitation.ride_id
  left join lateral (
    select request.status
    from public.ride_requests request
    where request.ride_id = r.id and request.requester_id = v_user_id
    order by request.created_at desc, request.id desc
    limit 1
  ) viewer_request on true
  where message.conversation_id = p_conversation_id
    and message.deleted_at is null
    and (select private.message_is_visible(message.id, v_user_id))
  order by message.created_at, message.id;
end;
$$;

create or replace function public.send_friend_ride_invitation(
  p_conversation_id uuid,
  p_message_id uuid,
  p_ride_id uuid,
  p_text text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_friend_id uuid;
  v_text text := nullif(btrim(coalesce(p_text, '')), '');
  v_ride public.rides%rowtype;
  v_sender_name text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_message_id is null or p_ride_id is null then raise exception 'A message and Ride are required'; end if;
  if v_text is not null and char_length(v_text) > 1000 then
    raise exception 'Message must not exceed 1000 characters';
  end if;

  select other_member.user_id into v_friend_id
  from public.conversations c
  join public.conversation_members own_member
    on own_member.conversation_id = c.id and own_member.user_id = v_user_id
  join public.conversation_members other_member
    on other_member.conversation_id = c.id and other_member.user_id <> v_user_id
  where c.id = p_conversation_id
    and c.scope = 'friend'
    and c.type = 'direct'
    and own_member.left_at is null
    and other_member.left_at is null
    and (select private.conversation_is_writable(c.id, v_user_id))
  limit 1
  for update of c, own_member, other_member;
  if v_friend_id is null then raise exception 'An accepted friend chat is required'; end if;

  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found then raise exception 'Ride not found'; end if;
  if v_ride.status <> 'Published' or v_ride.seats_available < 1 then
    raise exception 'This Ride is not accepting requests';
  end if;
  if now() > v_ride.departure_at - interval '1 hour' then
    raise exception 'Requests close 1 hour before departure';
  end if;
  if v_ride.host_id = v_friend_id then raise exception 'A Host cannot request their own Ride'; end if;
  if v_ride.host_id <> v_user_id and not exists (
    select 1 from public.ride_requests sender_request
    where sender_request.ride_id = v_ride.id
      and sender_request.requester_id = v_user_id
      and sender_request.status in ('Pending', 'Accepted')
  ) then raise exception 'You must host, request, or join this Ride before inviting a friend'; end if;
  if exists (
    select 1 from public.ride_requests friend_request
    where friend_request.ride_id = v_ride.id
      and friend_request.requester_id = v_friend_id
      and friend_request.status in ('Pending', 'Accepted', 'Rejected')
  ) then raise exception 'This friend cannot request this Ride'; end if;

  insert into public.messages (id, conversation_id, sender_id, text_content)
  values (p_message_id, p_conversation_id, v_user_id, v_text);
  insert into public.message_ride_invitations (message_id, ride_id)
  values (p_message_id, p_ride_id);

  update public.conversations
  set last_message_id = p_message_id, last_message_at = now(), updated_at = now()
  where id = p_conversation_id;
  update public.conversation_members
  set last_read_at = case when user_id = v_user_id then now() else last_read_at end,
      archived_at = null
  where conversation_id = p_conversation_id and left_at is null;

  select coalesce(nullif(btrim(full_name), ''), 'A friend') into v_sender_name
  from public.profiles where id = v_user_id;
  perform private.create_user_notification(
    v_friend_id, 'm3', 'ride_invitation',
    coalesce(v_sender_name, 'A friend') || ' invited you to a Ride',
    v_ride.pickup || ' to ' || v_ride.destination,
    '/message/' || p_conversation_id::text,
    jsonb_build_object('conversationId', p_conversation_id, 'messageId', p_message_id, 'rideId', p_ride_id),
    'ride-invitation:' || p_message_id::text
  );
  return p_message_id;
end;
$$;

create or replace function private.remove_deleted_ride_invitation_payload()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    delete from public.message_ride_invitations where message_id = new.id;
  end if;
  return new;
end;
$$;

create trigger remove_deleted_ride_invitation_payload
after update of deleted_at on public.messages
for each row execute function private.remove_deleted_ride_invitation_payload();

revoke all on function public.list_friend_ride_invite_options(uuid) from public, anon, authenticated;
revoke all on function public.get_friend_ride_invitation_cards(uuid) from public, anon, authenticated;
revoke all on function public.send_friend_ride_invitation(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.remove_deleted_ride_invitation_payload() from public, anon, authenticated;
grant execute on function public.list_friend_ride_invite_options(uuid) to authenticated;
grant execute on function public.get_friend_ride_invitation_cards(uuid) to authenticated;
grant execute on function public.send_friend_ride_invitation(uuid, uuid, uuid, text) to authenticated;

comment on table public.message_ride_invitations is
  'One structured Friend-chat Ride invitation per message; current Ride details are resolved at read time.';
