-- Module 1: the Safety Report intake `106_m1`'s own header explicitly left
-- out - "this does NOT build Safety Report intake, a case queue table, or an
-- appeals workflow". Scoped narrowly, by user decision, to the self-service
-- slice that stays inside Module 1's owned surfaces: any signed-in member can
-- flag another member from their public profile with a reason and an
-- optional ride reference; a Trust & Safety reviewer sees the resulting
-- queue on `/admin/conduct` instead of needing to already know a member's
-- user ID from outside the app. Pulling in actual M2 ride-dispute, M3
-- message, or M5 trip evidence automatically is still out of scope - that
-- was the Rulebook's own scoping note and remains a separate, larger,
-- cross-module decision.
--
-- Same admin allowlist as 097_m1/104_m1/105_m1/106_m1
-- (private.is_identity_review_admin, deployed by 097_m1). Depends on
-- 001_m1_create_profiles.sql (profiles) and 006_m2_create_rides.sql (rides,
-- for the optional ride reference). Authored locally; not deployed.

create table public.safety_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_user_id uuid not null references public.profiles(id) on delete cascade,
  ride_id uuid references public.rides(id) on delete set null,
  reason text not null,
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id),
  resolution_note text,
  constraint safety_reports_not_self check (reporter_id <> reported_user_id),
  constraint safety_reports_reason_not_blank check (length(trim(reason)) > 0),
  constraint safety_reports_resolution_pair check (
    (status = 'open' and resolved_at is null and resolved_by is null)
    or (status <> 'open' and resolved_at is not null and resolved_by is not null)
  )
);

create index safety_reports_status_created_idx
  on public.safety_reports (status, created_at);
create index safety_reports_reported_user_idx
  on public.safety_reports (reported_user_id);
-- One open report per (reporter, reported member) pair - repeat clicks or a
-- second unrelated incident should not spam the queue with duplicates; the
-- reporter can always add more detail by contacting a reviewer directly
-- once a report is already open. A resolved/dismissed report does not block
-- a fresh one, since that is a distinct incident being raised again.
create unique index safety_reports_one_open_per_pair_idx
  on public.safety_reports (reporter_id, reported_user_id)
  where status = 'open';

alter table public.safety_reports enable row level security;

create policy "reporters read their own submitted reports"
  on public.safety_reports for select to authenticated
  using ((select auth.uid()) = reporter_id);

create policy "admins read every safety report"
  on public.safety_reports for select to authenticated
  using (private.is_identity_review_admin());

revoke all on table public.safety_reports from public, anon, authenticated;
grant select on table public.safety_reports to authenticated;

-- Any signed-in member may report any other active member. Deliberately no
-- ride/message/trip evidence requirement here (that is the out-of-scope
-- cross-module intake) - reason is free text, same as the reviewer's own
-- Trust Case reason field, and the optional ride ID just gives the reviewer
-- a starting point, exactly like Confirm a Trust Case's own optional field.
create or replace function public.submit_safety_report(
  p_reported_user_id uuid,
  p_reason text,
  p_ride_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reporter_id uuid := auth.uid();
  v_id uuid;
begin
  if v_reporter_id is null then
    raise exception 'Sign in to report a member';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to report a member';
  end if;
  if p_reported_user_id = v_reporter_id then
    raise exception 'You cannot report yourself';
  end if;
  if not exists (
    select 1 from public.profiles where id = p_reported_user_id and status = 'active'
  ) then
    raise exception 'That member could not be found';
  end if;

  insert into public.safety_reports (reporter_id, reported_user_id, ride_id, reason)
  values (v_reporter_id, p_reported_user_id, p_ride_id, trim(p_reason))
  on conflict (reporter_id, reported_user_id) where status = 'open' do nothing
  returning id into v_id;

  if v_id is null then
    raise exception 'You already have an open report for this member';
  end if;

  return v_id;
end;
$$;

revoke all on function public.submit_safety_report(uuid, text, uuid) from public, anon;
grant execute on function public.submit_safety_report(uuid, text, uuid) to authenticated;

-- Same response shape AdminConductReview already renders a summary from -
-- reporter/reported display names resolved server-side so the client never
-- needs a second round trip per queue row. `p_status` selects which slice of
-- the queue to view; 'open' (the default, queue semantics) sorts oldest
-- first so a reviewer naturally works through the backlog in order,
-- 'resolved'/'dismissed'/'all' sort newest first as a activity history.
create or replace function public.admin_list_safety_reports(p_status text default 'open')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_reports jsonb;
begin
  if not private.is_identity_review_admin() then
    raise exception 'Not authorized to view the safety report queue';
  end if;
  if p_status not in ('open', 'resolved', 'dismissed', 'all') then
    raise exception 'Unknown report status filter: %', p_status;
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by
    case when r.status = 'open' then r.created_at end asc,
    case when r.status <> 'open' then r.created_at end desc
  ), '[]'::jsonb)
  into v_reports
  from (
    select
      sr.id,
      sr.reporter_id as "reporterId",
      reporter.full_name as "reporterName",
      sr.reported_user_id as "reportedUserId",
      reported.full_name as "reportedName",
      sr.ride_id as "rideId",
      sr.reason,
      sr.status,
      sr.created_at as "createdAt",
      sr.resolved_at as "resolvedAt",
      sr.resolution_note as "resolutionNote"
    from public.safety_reports sr
    join public.profiles reporter on reporter.id = sr.reporter_id
    join public.profiles reported on reported.id = sr.reported_user_id
    where p_status = 'all' or sr.status = p_status
  ) r;

  return v_reports;
end;
$$;

revoke all on function public.admin_list_safety_reports(text) from public, anon;
grant execute on function public.admin_list_safety_reports(text) to authenticated;

-- Resolving/dismissing the queue entry is a separate, manual reviewer action
-- from confirming a Trust Case (public.admin_apply_conduct_outcome, 106_m1) -
-- a report can be dismissed without any conduct outcome (nothing was found),
-- and one confirmed Trust Case might close several open reports about the
-- same member at once. Never edits report contents, only its resolution
-- state - matches the append-only spirit of the reputation ledger itself.
create or replace function public.admin_resolve_safety_report(
  p_report_id uuid,
  p_status text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.is_identity_review_admin() then
    raise exception 'Not authorized to resolve a safety report';
  end if;
  if p_status not in ('resolved', 'dismissed') then
    raise exception 'A resolved report must be marked resolved or dismissed';
  end if;

  update public.safety_reports
  set status = p_status, resolved_at = now(), resolved_by = auth.uid(), resolution_note = p_note
  where id = p_report_id and status = 'open'
  returning id into v_id;

  if v_id is null then
    raise exception 'That report is no longer open';
  end if;
end;
$$;

revoke all on function public.admin_resolve_safety_report(uuid, text, text) from public, anon;
grant execute on function public.admin_resolve_safety_report(uuid, text, text) to authenticated;
