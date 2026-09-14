-- Module 1: a manual admin action for identity verification left unresolved
-- since signup - the one deliberate, narrow exception to "identity documents
-- do not affect reputation" (072_m1, 087_m1). The identity gate
-- (enforce_ride_identity_verification, 093_m1) already blocks publishing
-- outright; this closes the separate gap where a member who never submits
-- anything at all pays no cost whatsoever, indefinitely.
--
-- Deliberately manual, not a scheduled job: no cron/worker infrastructure
-- exists for reputation today - every other event fires from an explicit
-- user/ride action, not elapsed time. A reviewer sees how long an account has
-- gone with zero identity_verifications row (never submitted - a pending or
-- rejected row already means they tried, and stays on the existing Awaiting
-- review / Not accepted tabs, untouched here) and chooses whether to apply a
-- modest penalty. Reuses the admin-allowlist reviewer pattern from
-- 097_m1/104_m1 rather than a new roles table or worker.
--
-- Applies to every active member from signup, not host-only: this is about
-- administrative follow-through on a requirement every member eventually
-- needs before they can host, not a re-statement of the publish gate itself.
--
-- Depends on 072_m1_reputation_events_and_eligibility.sql (reputation_events,
-- record_reputation_event, host_impact_stats) and
-- 097_m1_admin_identity_review.sql (private.is_identity_review_admin).
-- Authored locally; not deployed.

alter table public.reputation_events
  drop constraint if exists reputation_events_event_type_check,
  add constraint reputation_events_event_type_check check (event_type in (
    'ride_completed', 'on_time_check_in',
    'review_5_star', 'review_4_star', 'review_3_star', 'review_2_star', 'review_1_star',
    'host_cancelled_early', 'host_cancelled_late', 'host_cancelled_very_late',
    'traveller_cancelled_early', 'traveller_cancelled_late', 'traveller_cancelled_very_late',
    'no_show',
    'confirmed_minor_conduct', 'confirmed_moderate_conduct',
    'confirmed_serious_conduct', 'confirmed_severe_conduct',
    'identity_verification_overdue'
  ));

-- Every active member with zero identity_verifications row, oldest signup
-- first (most overdue). A 'pending' or 'rejected' row means they submitted
-- something and belongs on the existing admin tabs instead, so it is
-- excluded by the not-exists check rather than a status filter.
create or replace function public.admin_list_unverified_members()
returns table (
  user_id uuid,
  full_name text,
  created_at timestamptz,
  days_since_signup integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_identity_review_admin() then
    raise exception 'Not authorized to review identity verifications';
  end if;

  return query
    select p.id, p.full_name, p.created_at,
      floor(extract(epoch from (now() - p.created_at)) / 86400)::integer
    from public.profiles p
    where p.status = 'active'
      and not exists (
        select 1 from public.identity_verifications iv where iv.user_id = p.id
      )
    order by p.created_at asc;
end;
$$;

revoke all on function public.admin_list_unverified_members() from public, anon;
grant execute on function public.admin_list_unverified_members() to authenticated;

-- Day-scoped source_event_id so a double click cannot double the deduction,
-- but a member still unverified on a later day can be flagged again then.
-- -5 is deliberately lighter than confirmed_minor_conduct (-8): this is an
-- administrative lapse, not confirmed misconduct, and never sets a hold.
create or replace function public.admin_apply_identity_overdue_penalty(
  p_user_id uuid,
  p_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_event_id text := p_user_id::text || ':' || to_char(now(), 'YYYY-MM-DD');
begin
  if not private.is_identity_review_admin() then
    raise exception 'Not authorized to review identity verifications';
  end if;

  return private.record_reputation_event(
    p_user_id, null, 'M1', v_source_event_id, 'identity_verification_overdue',
    'traveller', -5,
    coalesce(p_reason, 'Identity verification still not submitted since signup'),
    '{}'::jsonb
  );
end;
$$;

revoke all on function public.admin_apply_identity_overdue_penalty(uuid, text) from public, anon;
grant execute on function public.admin_apply_identity_overdue_penalty(uuid, text) to authenticated;
