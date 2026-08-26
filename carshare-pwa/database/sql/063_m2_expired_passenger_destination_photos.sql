-- Keep destination-photo Place ID access aligned with terminal Ride Detail
-- access for an Expired former passenger whose request was previously accepted.
-- This is a compensating migration; do not rewrite the deployed 059 function.

create or replace function public.get_ride_destination_photo_place_ids(p_ride_ids uuid[])
returns table (ride_id uuid, destination_place_id text)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if p_ride_ids is null or cardinality(p_ride_ids) = 0 then return; end if;
  if cardinality(p_ride_ids) > 100 then raise exception 'A maximum of 100 rides may be requested'; end if;

  return query
  select r.id, r.destination_place_id
  from public.rides r
  join public.profiles p on p.id = r.host_id
  where r.id = any(p_ride_ids)
    and r.destination_place_id is not null
    and (
      (r.status = 'Published' and p.status = 'active')
      or r.host_id = v_user_id
      or exists (
        select 1
        from public.ride_requests rr
        where rr.ride_id = r.id
          and rr.requester_id = v_user_id
          and (
            rr.status = 'Accepted'
            or (
              r.status = 'Expired'
              and rr.status = 'Expired'
              and to_jsonb(rr)->>'accepted_at' is not null
            )
          )
      )
    );
end;
$$;

revoke all on function public.get_ride_destination_photo_place_ids(uuid[]) from public, anon, authenticated;
grant execute on function public.get_ride_destination_photo_place_ids(uuid[]) to anon, authenticated;
