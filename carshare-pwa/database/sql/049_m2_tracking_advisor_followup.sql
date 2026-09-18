-- M2 live tracking / Trust Admin advisor follow-up.
-- Keep the deployed 041-043 history immutable; add FK coverage and make the
-- Realtime auth lookup an init-plan expression instead of a per-row call.

create index if not exists m2_location_sessions_user_idx
  on private.m2_location_sessions (user_id, ride_id);
create index if not exists m2_live_locations_user_idx
  on private.m2_live_locations (user_id, ride_id);
create index if not exists m2_live_locations_session_idx
  on private.m2_live_locations (session_id);
create index if not exists m2_location_history_session_idx
  on private.m2_location_history (session_id);
create index if not exists m2_family_location_shares_owner_idx
  on private.m2_family_location_shares (owner_id, ride_id);
create index if not exists m2_dispute_evidence_access_log_case_idx
  on private.m2_dispute_evidence_access_log (case_id, accessed_at desc);
create index if not exists m2_dispute_evidence_access_log_admin_idx
  on private.m2_dispute_evidence_access_log (admin_id, accessed_at desc);
create index if not exists m2_ride_disputes_opened_by_idx
  on private.m2_ride_disputes (opened_by, created_at desc);
create index if not exists m2_ride_disputes_assigned_admin_idx
  on private.m2_ride_disputes (assigned_admin_id, status, created_at);
create index if not exists project_role_audit_actor_idx
  on private.project_role_audit (actor_id, created_at desc);
create index if not exists project_role_audit_subject_idx
  on private.project_role_audit (subject_id, created_at desc);

drop policy if exists m2_live_driver_read on realtime.messages;
create policy m2_live_driver_read on realtime.messages for select to authenticated using (
  realtime.topic() ~ '^m2-live:[0-9a-f-]{36}:driver$' and exists (
    select 1 from public.rides r
    where r.id = substring(realtime.topic() from '^m2-live:([0-9a-f-]{36}):driver$')::uuid
      and (r.host_id = (select auth.uid()) or exists (
        select 1 from public.ride_requests rr
        where rr.ride_id = r.id and rr.requester_id = (select auth.uid()) and rr.status = 'Accepted'
      ))
  )
);

drop policy if exists m2_live_host_read on realtime.messages;
create policy m2_live_host_read on realtime.messages for select to authenticated using (
  realtime.topic() ~ '^m2-live:[0-9a-f-]{36}:host$' and exists (
    select 1 from public.rides r
    where r.id = substring(realtime.topic() from '^m2-live:([0-9a-f-]{36}):host$')::uuid
      and r.host_id = (select auth.uid())
  )
);
