-- Module 1: the reviewer-facing surface TRUST_SAFETY_HANDOVER.md and the
-- Conduct Severity Rulebook both flag as missing - "no UI exists yet for a
-- reviewer queue" - narrowed to exactly what a reviewer needs to confirm a
-- Trust Case once one is already known about: look up the member, see their
-- current standing, and record an outcome. This does NOT build Safety Report
-- intake, a case queue table, or an appeals workflow - those need M2 (ride/
-- check-in evidence), M3 (message evidence) and M5 (trip records) input per
-- the Rulebook's own scoping note, not just Module 1's. A reviewer today
-- still needs to already know which member and which incident from outside
-- the app (a report elsewhere, a conversation) before opening this page.
--
-- Same admin allowlist as 097_m1/104_m1/105_m1 (private.is_identity_review_admin),
-- same "wrap the service-role-only function, do not widen its own grant"
-- pattern as public.admin_review_identity_verification (097_m1).
--
-- Depends on 072_m1_reputation_events_and_eligibility.sql (get_reputation_summary
-- shape, reputation_evidence_count), 078_m1_conduct_outcome_and_hold_reversal.sql
-- (apply_conduct_outcome, clear_reputation_hold - both still service-role-only,
-- unmodified), 097_m1_admin_identity_review.sql (is_identity_review_admin).
-- Authored locally; not deployed.

-- get_reputation_summary (072_m1) hard-requires auth.uid() = p_user_id - a
-- reviewer confirming a case about someone else cannot use it. Same response
-- shape so the client can reuse one mapper for both the member's own summary
-- and this admin view.
create or replace function public.admin_get_reputation_summary(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_stats public.host_impact_stats%rowtype;
  v_events jsonb;
begin
  if not private.is_identity_review_admin() then
    raise exception 'Not authorized to review reputation standing';
  end if;

  select * into v_stats from public.host_impact_stats where user_id = p_user_id;
  -- Confirmed-conduct history only, not the full ride ledger - this is what
  -- the reviewer actually needs: is this a repeat case, and at which tier.
  select coalesce(jsonb_agg(to_jsonb(e) order by e."createdAt" desc), '[]'::jsonb) into v_events
  from (
    select id, event_type as type, delta, reason, created_at as "createdAt"
    from public.reputation_events
    where user_id = p_user_id and source_module = 'Safety'
    order by created_at desc limit 20
  ) e;
  return jsonb_build_object(
    'score', coalesce(v_stats.reputation_score, 70),
    'hold', coalesce(v_stats.reputation_hold, false),
    'evidenceCount', private.reputation_evidence_count(p_user_id),
    'conductEvents', v_events
  );
end;
$$;

revoke all on function public.admin_get_reputation_summary(uuid) from public, anon;
grant execute on function public.admin_get_reputation_summary(uuid) to authenticated;

-- Generates its own source_event_id (a fresh uuid per confirmation, not
-- day-scoped like 105_m1's overdue penalty) so a reviewer can confirm two
-- separate incidents for the same member on the same day without one
-- silently absorbing the other - each real incident must count on its own
-- toward the 90/180-day escalation windows in private.apply_conduct_outcome.
create or replace function public.admin_apply_conduct_outcome(
  p_user_id uuid,
  p_event_type text,
  p_reason text,
  p_ride_id uuid default null,
  p_set_hold boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_event_id text := gen_random_uuid()::text;
begin
  if not private.is_identity_review_admin() then
    raise exception 'Not authorized to confirm a Trust Case';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to confirm a Trust Case';
  end if;

  return private.apply_conduct_outcome(p_user_id, p_event_type, v_source_event_id, p_reason, p_ride_id, p_set_hold);
end;
$$;

revoke all on function public.admin_apply_conduct_outcome(uuid, text, text, uuid, boolean) from public, anon;
grant execute on function public.admin_apply_conduct_outcome(uuid, text, text, uuid, boolean) to authenticated;

-- Reversal only - never edits or deletes the original confirmed event
-- (071_m1... matches the append-only ledger design throughout 072_m1).
-- Does not insert a compensating score event: private.clear_reputation_hold
-- itself only ever clears the flag, so this wrapper does exactly that and no
-- more. A full appeal path that nets the score back (Rulebook section 5) is
-- separate, larger work this does not attempt.
create or replace function public.admin_clear_reputation_hold(
  p_user_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_identity_review_admin() then
    raise exception 'Not authorized to clear a reputation hold';
  end if;

  perform private.clear_reputation_hold(p_user_id);
end;
$$;

revoke all on function public.admin_clear_reputation_hold(uuid, text) from public, anon;
grant execute on function public.admin_clear_reputation_hold(uuid, text) to authenticated;
