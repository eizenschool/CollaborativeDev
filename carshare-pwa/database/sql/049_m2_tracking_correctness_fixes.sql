-- Module 2 correctness fixes after the first live-tracking rollout.
--
-- 041 introduced adaptive check-in accuracy. Keep the new RPC requirement,
-- while allowing historical Checked In rows that predate the accuracy column.
-- 046 exposed the Role Admin queue only to service_role, so the actor must be
-- passed explicitly by the already-authenticated project-admin Edge Function.

alter table public.ride_requests
  drop constraint if exists ride_requests_check_in_pair_check;

alter table public.ride_requests
  add constraint ride_requests_check_in_pair_check check (
    (boarding_status <> 'Checked In'
      and checked_in_at is null
      and check_in_distance_meters is null
      and check_in_accuracy_meters is null)
    or (
      boarding_status = 'Checked In'
      and checked_in_at is not null
      and check_in_distance_meters between 0 and 350
      and (check_in_accuracy_meters is null or check_in_accuracy_meters between 0 and 150)
      and no_show_at is null
      and no_show_marked_by is null
    )
  );

drop function if exists public.admin_list_m2_open_disputes();

create function public.admin_list_m2_open_disputes(p_actor_id uuid)
returns table (
  id uuid,
  ride_id uuid,
  opened_by uuid,
  reason text,
  status text,
  assigned_admin_id uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor_id is null or not exists (
    select 1
    from private.project_user_roles
    where user_id = p_actor_id
      and role = 'role_admin'
  ) then
    raise exception 'Role Admin access required';
  end if;

  return query
    select d.id, d.ride_id, d.opened_by, d.reason, d.status,
           d.assigned_admin_id, d.created_at, d.updated_at
    from private.m2_ride_disputes d
    where d.status in ('Open', 'Under Review')
    order by d.created_at asc;
end;
$$;

revoke all on function public.admin_list_m2_open_disputes(uuid)
  from public, anon, authenticated;
grant execute on function public.admin_list_m2_open_disputes(uuid)
  to service_role;
