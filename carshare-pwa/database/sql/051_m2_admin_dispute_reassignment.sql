-- Role Admin case queue/reassignment. GPS evidence remains assigned-only.

create table if not exists private.m2_dispute_admin_audit (
  id bigint generated always as identity primary key,
  case_id uuid not null references private.m2_ride_disputes(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  subject_id uuid references public.profiles(id),
  action text not null check (action in ('reassign')),
  created_at timestamptz not null default now()
);
alter table private.m2_dispute_admin_audit enable row level security;
revoke all on private.m2_dispute_admin_audit from public, anon, authenticated;
create index if not exists m2_dispute_admin_audit_case_idx
  on private.m2_dispute_admin_audit (case_id, created_at desc);

create or replace function public.admin_list_m2_open_disputes()
returns table (id uuid, ride_id uuid, opened_by uuid, reason text, status text, assigned_admin_id uuid, created_at timestamptz, updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from private.project_user_roles where user_id = auth.uid() and role = 'role_admin') then
    raise exception 'Role Admin access required';
  end if;
  return query
    select d.id, d.ride_id, d.opened_by, d.reason, d.status, d.assigned_admin_id, d.created_at, d.updated_at
    from private.m2_ride_disputes d
    where d.status in ('Open', 'Under Review')
    order by d.created_at asc;
end;
$$;

create or replace function public.admin_reassign_m2_ride_dispute(p_actor_id uuid, p_case_id uuid, p_new_admin_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if not exists (select 1 from private.project_user_roles where user_id = p_actor_id and role = 'role_admin') then
    raise exception 'Role Admin access required';
  end if;
  if not exists (select 1 from private.project_user_roles where user_id = p_new_admin_id and role = 'trust_admin') then
    raise exception 'Choose an active Trust Admin';
  end if;
  update private.m2_ride_disputes
  set assigned_admin_id = p_new_admin_id,
      status = case when status = 'Open' then 'Under Review' else status end,
      updated_at = now()
  where id = p_case_id and status in ('Open', 'Under Review');
  get diagnostics v_count = row_count;
  if v_count = 1 then
    insert into private.m2_dispute_admin_audit (case_id, actor_id, subject_id, action)
    values (p_case_id, p_actor_id, p_new_admin_id, 'reassign');
  end if;
  return v_count = 1;
end;
$$;

revoke all on function public.admin_list_m2_open_disputes() from public, anon, authenticated;
revoke all on function public.admin_reassign_m2_ride_dispute(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_list_m2_open_disputes() to service_role;
grant execute on function public.admin_reassign_m2_ride_dispute(uuid, uuid, uuid) to service_role;
