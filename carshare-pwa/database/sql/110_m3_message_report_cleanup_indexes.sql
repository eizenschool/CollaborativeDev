-- Bound the work of the hourly cleanup and grouped report resolution.
begin;
create index message_report_evidence_cleanup_idx on public.message_report_evidence(resolved_at)
  where purged_at is null and resolved_at is not null;
create index message_report_attempts_cleanup_idx on public.message_report_attempts(created_at);
create index safety_reports_evidence_idx on public.safety_reports(message_evidence_id)
  where message_evidence_id is not null;
commit;
