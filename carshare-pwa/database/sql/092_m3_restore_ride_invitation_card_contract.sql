-- Revert 091 and restore the prior Ride invitation card RPC response contract.
drop function public.get_friend_ride_invitation_cards(uuid);

create function public.get_friend_ride_invitation_cards(p_conversation_id uuid)
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

revoke all on function public.get_friend_ride_invitation_cards(uuid)
  from public, anon, authenticated;
grant execute on function public.get_friend_ride_invitation_cards(uuid) to authenticated;
