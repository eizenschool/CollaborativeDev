-- Module 1: notifies a host when their Composite Host Impact Score badge tier
-- changes, closing the gap UC1.9 documented ("no upgrade/downgrade
-- notification is dispatched" - badgeForScore() was a stateless lookup with
-- no persisted "previous tier" to compare against).
--
-- Mirrors HostImpactEngine.js's CURRENT formula exactly - not the older
-- reputation-weighted one this project's own report described before this
-- migration. Since D034 every member starts at the reputation ceiling, so an
-- additive reputation term put the same ~80-point pedestal under everybody;
-- HostImpactEngine.js now excludes reputation from the composite score
-- entirely and instead uses it (plus a safety hold) to withhold a badge above
-- Bronze regardless of contribution (badgeIsWithheld()). Both copies must be
-- kept in sync exactly like the reputation-delta duplication in 072_m1 - a
-- mismatch here would silently notify a host of the wrong tier.
--
-- Depends on 003_m1_create_host_impact_stats.sql (the table),
-- 072_m1_reputation_events_and_eligibility.sql (reputation_score,
-- reputation_hold columns) and 033_project_notifications.sql
-- (private.create_user_notification). Follows the same shape as
-- 041_m6_ride_available_notification.sql - a single trigger, no new Edge
-- Function, no Web Push change.

alter table public.host_impact_stats
  add column if not exists last_badge_tier text;

-- host minimum reputation threshold below which a badge is withheld -
-- ReputationPolicy.js's REPUTATION_POLICY.hostMinimum. Not read from a table:
-- that constant is hard-coded in the client too, so this mirrors it exactly
-- rather than adding a runtime lookup for a value that never changes without
-- a code deploy on both sides anyway.
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
      or (p_reputation_score is not null and p_reputation_score > 0 and p_reputation_score < 65)
      then 'Bronze Host'
    when (coalesce(p_completed_trips, 0) * 2.0 + coalesce(p_co2_saved_kg, 0) * 0.5) >= 200 then 'Platinum Host'
    when (coalesce(p_completed_trips, 0) * 2.0 + coalesce(p_co2_saved_kg, 0) * 0.5) >= 120 then 'Gold Host'
    when (coalesce(p_completed_trips, 0) * 2.0 + coalesce(p_co2_saved_kg, 0) * 0.5) >= 50 then 'Silver Host'
    else 'Bronze Host'
  end;
$$;

revoke all on function private.badge_tier_for_stats(int, numeric, int, boolean) from public, anon, authenticated;

create or replace function private.badge_tier_rank(p_tier_name text)
returns int
language sql
immutable
security definer
set search_path = ''
as $$
  select case p_tier_name
    when 'Platinum Host' then 3
    when 'Gold Host' then 2
    when 'Silver Host' then 1
    else 0
  end;
$$;

revoke all on function private.badge_tier_rank(text) from public, anon, authenticated;

create or replace function private.notify_badge_tier_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_tier text;
begin
  v_new_tier := private.badge_tier_for_stats(
    new.completed_trips, new.co2_saved_kg, new.reputation_score, new.reputation_hold
  );

  -- Nothing to compare a brand-new row against - just record its starting
  -- tier silently, the same way a member's very first reputation score never
  -- reads as a "change".
  if tg_op = 'INSERT' or old.last_badge_tier is null then
    new.last_badge_tier := v_new_tier;
    return new;
  end if;

  if v_new_tier is distinct from old.last_badge_tier then
    if private.badge_tier_rank(v_new_tier) > private.badge_tier_rank(old.last_badge_tier) then
      perform private.create_user_notification(
        new.user_id, 'm1', 'badge_tier_upgrade',
        'Host tier upgraded',
        'Congratulations! You''ve been upgraded to ' || v_new_tier || ' tier.',
        '/profile',
        jsonb_build_object('previousTier', old.last_badge_tier, 'newTier', v_new_tier),
        'm1:badge_tier:' || new.user_id::text || ':' || old.last_badge_tier || '->' || v_new_tier
      );
    else
      perform private.create_user_notification(
        new.user_id, 'm1', 'badge_tier_downgrade',
        'Host tier changed',
        'Your host tier has changed to ' || v_new_tier || ' based on your recent activity.',
        '/profile',
        jsonb_build_object('previousTier', old.last_badge_tier, 'newTier', v_new_tier),
        'm1:badge_tier:' || new.user_id::text || ':' || old.last_badge_tier || '->' || v_new_tier
      );
    end if;
  end if;

  new.last_badge_tier := v_new_tier;
  return new;
end;
$$;

revoke all on function private.notify_badge_tier_change() from public, anon, authenticated;

drop trigger if exists notify_badge_tier_change on public.host_impact_stats;
create trigger notify_badge_tier_change
before insert or update on public.host_impact_stats
for each row execute function private.notify_badge_tier_change();
