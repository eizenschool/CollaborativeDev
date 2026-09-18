-- Project Trust Admin roles and the Module 2 ride-dispute evidence boundary.

create schema if not exists private;

create table if not exists private.project_user_roles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('role_admin', 'trust_admin')),
  granted_at timestamptz not null default now(),
  granted_by uuid references public.profiles(id),
  primary key (user_id, role)
);
create table if not exists private.project_role_audit (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  subject_id uuid not null references public.profiles(id),
  action text not null check (action in ('grant', 'revoke', 'bootstrap')),
  role text not null check (role in ('role_admin', 'trust_admin')),
  created_at timestamptz not null default now()
);

create table if not exists private.m2_ride_disputes (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides(id) on delete cascade,
  opened_by uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (length(btrim(reason)) between 20 and 2000),
  status text not null default 'Open' check (status in ('Open', 'Under Review', 'Resolved', 'Dismissed')),
  assigned_admin_id uuid references public.profiles(id),
  resolution text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index if not exists m2_ride_disputes_one_open_idx
  on private.m2_ride_disputes (ride_id, opened_by)
  where status in ('Open', 'Under Review');
create index if not exists m2_ride_disputes_queue_idx
  on private.m2_ride_disputes (status, created_at);

create table if not exists private.m2_dispute_evidence_access_log (
  id bigint generated always as identity primary key,
  case_id uuid not null references private.m2_ride_disputes(id) on delete cascade,
  admin_id uuid not null references public.profiles(id),
  reason text not null check (length(btrim(reason)) between 10 and 500),
  accessed_at timestamptz not null default now()
);

alter table private.project_user_roles enable row level security;
alter table private.project_role_audit enable row level security;
alter table private.m2_ride_disputes enable row level security;
alter table private.m2_dispute_evidence_access_log enable row level security;
revoke all on all tables in schema private from public, anon, authenticated;

create or replace function public.get_my_project_roles()
returns text[] language sql security definer set search_path = '' as $$
  select coalesce(array_agg(role order by role), '{}'::text[]) from private.project_user_roles where user_id = auth.uid();
$$;

create or replace function public.open_m2_ride_dispute(p_ride_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid := auth.uid(); v_ride public.rides%rowtype; v_id uuid;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if private.m2_participant_role(p_ride_id, v_user_id) is null then raise exception 'Only ride participants can open a dispute'; end if;
  if nullif(btrim(p_reason), '') is null or length(btrim(p_reason)) < 20 or length(btrim(p_reason)) > 2000 then raise exception 'Describe the dispute in 20 to 2000 characters'; end if;
  select * into v_ride from public.rides where id = p_ride_id;
  if v_ride.status not in ('Completed', 'Cancelled') or coalesce(v_ride.updated_at, v_ride.created_at) < now() - interval '30 days' then raise exception 'Disputes open within 30 days after a completed or cancelled Ride'; end if;
  insert into private.m2_ride_disputes (ride_id, opened_by, reason) values (p_ride_id, v_user_id, btrim(p_reason)) returning id into v_id;
  insert into private.m2_location_evidence_holds (ride_id, active_until) values (p_ride_id, now() + interval '100 years') on conflict (ride_id) do update set active_until = greatest(private.m2_location_evidence_holds.active_until, excluded.active_until);
  perform private.create_user_notification(r.user_id, 'm2', 'ride_dispute_opened', 'A ride dispute needs review', 'A participant opened a ride dispute for review.', '/safety/admin', jsonb_build_object('case_id', v_id), 'm2:dispute:opened:' || v_id::text)
    from private.project_user_roles r where r.role = 'trust_admin';
  return v_id;
end;
$$;

create or replace function public.list_m2_open_disputes()
returns table (id uuid, ride_id uuid, opened_by uuid, reason text, status text, assigned_admin_id uuid, created_at timestamptz, updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from private.project_user_roles where user_id = auth.uid() and role = 'trust_admin') then raise exception 'Trust Admin access required'; end if;
  return query select d.id, d.ride_id, d.opened_by, d.reason, d.status, d.assigned_admin_id, d.created_at, d.updated_at from private.m2_ride_disputes d where d.status in ('Open', 'Under Review') order by d.created_at asc;
end;
$$;

create or replace function public.claim_m2_ride_dispute(p_case_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if not exists (select 1 from private.project_user_roles where user_id = auth.uid() and role = 'trust_admin') then raise exception 'Trust Admin access required'; end if;
  update private.m2_ride_disputes set assigned_admin_id = auth.uid(), status = 'Under Review', updated_at = now() where id = p_case_id and status = 'Open' and assigned_admin_id is null;
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

create or replace function public.resolve_m2_ride_dispute(p_case_id uuid, p_status text, p_resolution text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if p_status not in ('Resolved', 'Dismissed') or nullif(btrim(p_resolution), '') is null then raise exception 'A resolution and final status are required'; end if;
  if not exists (select 1 from private.project_user_roles where user_id = auth.uid() and role = 'trust_admin') then raise exception 'Trust Admin access required'; end if;
  update private.m2_ride_disputes set status = p_status, resolution = btrim(p_resolution), resolved_at = now(), updated_at = now() where id = p_case_id and assigned_admin_id = auth.uid() and status = 'Under Review';
  get diagnostics v_count = row_count;
  if v_count = 1 then update private.m2_location_evidence_holds set active_until = now() + interval '90 days' where ride_id = (select ride_id from private.m2_ride_disputes where id = p_case_id); end if;
  return v_count = 1;
end;
$$;

create or replace function public.get_m2_dispute_evidence(p_case_id uuid, p_reason text)
returns table (ride_id uuid, user_id uuid, user_role text, latitude double precision, longitude double precision, accuracy_meters double precision, captured_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_ride_id uuid; v_admin uuid := auth.uid();
begin
  if nullif(btrim(p_reason), '') is null or length(btrim(p_reason)) < 10 then raise exception 'An evidence access reason is required'; end if;
  if not exists (select 1 from private.project_user_roles where user_id = v_admin and role = 'trust_admin') then raise exception 'Trust Admin access required'; end if;
  select d.ride_id into v_ride_id from private.m2_ride_disputes d where d.id = p_case_id and d.assigned_admin_id = v_admin and d.status in ('Open', 'Under Review');
  if v_ride_id is null then raise exception 'Only the assigned Trust Admin can view this evidence'; end if;
  insert into private.m2_dispute_evidence_access_log (case_id, admin_id, reason) values (p_case_id, v_admin, btrim(p_reason));
  return query select h.ride_id, h.user_id, h.user_role, h.latitude, h.longitude, h.accuracy_meters, h.captured_at from private.m2_location_history h where h.ride_id = v_ride_id order by h.captured_at asc, h.id asc;
end;
$$;

create or replace function public.admin_list_project_roles()
returns table (user_id uuid, role text, granted_at timestamptz)
language sql security definer set search_path = '' as $$ select user_id, role, granted_at from private.project_user_roles order by granted_at desc $$;

create or replace function public.admin_grant_trust_admin(p_actor_id uuid, p_subject_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if not exists (select 1 from private.project_user_roles where user_id = p_actor_id and role = 'role_admin') then raise exception 'Role Admin access required'; end if;
  insert into private.project_user_roles (user_id, role, granted_by) values (p_subject_id, 'trust_admin', p_actor_id) on conflict (user_id, role) do nothing;
  get diagnostics v_count = row_count;
  insert into private.project_role_audit (actor_id, subject_id, action, role) values (p_actor_id, p_subject_id, 'grant', 'trust_admin');
  return v_count = 1;
end;
$$;

create or replace function public.admin_revoke_trust_admin(p_actor_id uuid, p_subject_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if not exists (select 1 from private.project_user_roles where user_id = p_actor_id and role = 'role_admin') then raise exception 'Role Admin access required'; end if;
  if exists (select 1 from private.m2_ride_disputes where assigned_admin_id = p_subject_id and status in ('Open', 'Under Review')) then raise exception 'Reassign open disputes before revoking this Trust Admin'; end if;
  delete from private.project_user_roles where user_id = p_subject_id and role = 'trust_admin';
  get diagnostics v_count = row_count;
  if v_count = 1 then insert into private.project_role_audit (actor_id, subject_id, action, role) values (p_actor_id, p_subject_id, 'revoke', 'trust_admin'); end if;
  return v_count = 1;
end;
$$;

revoke all on function public.get_my_project_roles() from public, anon;
revoke all on function public.open_m2_ride_dispute(uuid, text) from public, anon;
revoke all on function public.list_m2_open_disputes() from public, anon;
revoke all on function public.claim_m2_ride_dispute(uuid) from public, anon;
revoke all on function public.resolve_m2_ride_dispute(uuid, text, text) from public, anon;
revoke all on function public.get_m2_dispute_evidence(uuid, text) from public, anon;
revoke all on function public.admin_list_project_roles() from public, anon, authenticated;
revoke all on function public.admin_grant_trust_admin(uuid, uuid) from public, anon, authenticated;
revoke all on function public.admin_revoke_trust_admin(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_my_project_roles() to authenticated;
grant execute on function public.open_m2_ride_dispute(uuid, text) to authenticated;
grant execute on function public.list_m2_open_disputes() to authenticated;
grant execute on function public.claim_m2_ride_dispute(uuid) to authenticated;
grant execute on function public.resolve_m2_ride_dispute(uuid, text, text) to authenticated;
grant execute on function public.get_m2_dispute_evidence(uuid, text) to authenticated;
grant execute on function public.admin_list_project_roles() to service_role;
grant execute on function public.admin_grant_trust_admin(uuid, uuid) to service_role;
grant execute on function public.admin_revoke_trust_admin(uuid, uuid) to service_role;
