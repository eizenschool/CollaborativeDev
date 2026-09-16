-- Module 1: fixes a threshold drift found auditing the Host Impact badge
-- system. 098_m1_badge_tier_change_notification.sql's own header says
-- private.badge_tier_for_stats() withholds a badge "below the Driver
-- publishing threshold" and mirrors ReputationPolicy.js's
-- REPUTATION_POLICY.hostMinimum exactly, but hard-coded that comparison
-- against the pre-087 value of sixty-five. 087_m1_reputation_starts_at_
-- ceiling.sql (an earlier migration number than 098_m1, so already in force
-- when 098_m1 was authored) raised hostMinimum to ninety. 098_m1 was never
-- updated to match, so a host with a score in that gap would be shown Bronze
-- on their own profile (HostImpactEngine.js's badgeIsWithheld(), correctly
-- gated at the current threshold) while this trigger would consider them
-- un-withheld and could fire an incorrect tier-upgrade notification at that
-- same score.
--
-- 098_m1 itself is not rewritten - it is prior migration history, same as
-- every other superseded function in this file - this supersedes only
-- private.badge_tier_for_stats()'s body via create-or-replace (same
-- signature, same grants). private.badge_tier_rank() and
-- private.notify_badge_tier_change() have no threshold of their own and are
-- untouched.
--
-- Depends on 098_m1_badge_tier_change_notification.sql (the function this
-- supersedes) and 087_m1_reputation_starts_at_ceiling.sql (the 90 threshold
-- this now actually matches). Authored locally; not deployed. 098_m1's own
-- deployment status has no tracked entry in docs/ai/SQL.md - confirm whether
-- 098_m1 is live before assuming this fix has anything to correct in
-- production.

create or replace function private.badge_tier_for_stats(
  p_completed_trips int,
  p_co2_saved_kg numeric,
  p_reputation_score int,
  p_reputation_hold boolean
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce(p_reputation_hold, false)
      or (p_reputation_score is not null and p_reputation_score > 0 and p_reputation_score < 90)
      then 'Bronze Host'
    when (coalesce(p_completed_trips, 0) * 2.0 + coalesce(p_co2_saved_kg, 0) * 0.5) >= 200 then 'Platinum Host'
    when (coalesce(p_completed_trips, 0) * 2.0 + coalesce(p_co2_saved_kg, 0) * 0.5) >= 120 then 'Gold Host'
    when (coalesce(p_completed_trips, 0) * 2.0 + coalesce(p_co2_saved_kg, 0) * 0.5) >= 50 then 'Silver Host'
    else 'Bronze Host'
  end;
$$;

revoke all on function private.badge_tier_for_stats(int, numeric, int, boolean) from public, anon, authenticated;
