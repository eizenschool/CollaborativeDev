-- Module 1: fixes a live bug in 107_m1_safety_report_queue.sql's
-- admin_list_safety_reports, caught immediately after the user deployed
-- 107_m1 and opened the Case queue: "column r.created_at does not exist".
--
-- The subquery aliases sr.created_at as "createdAt" (camelCase, to match
-- the JSON shape AdminConductReview.jsx already reads), but the outer
-- jsonb_agg's ORDER BY referenced the pre-alias name r.created_at, which
-- does not exist on the derived table r - only r."createdAt" does. 107_m1
-- itself is deployed history and is not rewritten; this supersedes only
-- admin_list_safety_reports's body via create-or-replace, same signature,
-- same admin gate, same status-filter validation. submit_safety_report and
-- admin_resolve_safety_report have no equivalent alias mismatch and are
-- untouched.

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
    case when r.status = 'open' then r."createdAt" end asc,
    case when r.status <> 'open' then r."createdAt" end desc
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
