-- Restore the M3 evidence discriminator after the legacy M1 queue function
-- was deployed without message_evidence_id. Without this field the client
-- renders message cases as profile reports and the resolution guard correctly
-- rejects Mark resolved / Dismiss with "Use the message evidence review action".
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
      sr.message_evidence_id as "messageEvidenceId",
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
