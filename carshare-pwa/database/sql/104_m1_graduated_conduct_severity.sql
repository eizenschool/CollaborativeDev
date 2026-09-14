-- Module 1: replace the two-value conduct penalty with a graduated severity
-- scale, and make repeated confirmed conduct escalate on its own.
--
-- 078_m1 gave private.apply_conduct_outcome exactly two outcomes -
-- confirmed_minor_conduct (-8) or confirmed_serious_conduct (-20), an
-- if/else with nothing in between. A shove and a slur cost the same as
-- smoking in someone's car; a member who racks up minor complaints forever
-- never crosses into anything worse. Neither matches the severity spread
-- FR-6.26-6.31 (Trust Case enforcement) actually needs. 078_m1 is
-- unmodified - both of its event types remain valid and keep their original
-- deltas - this only adds two more tiers between and above them, and teaches
-- apply_conduct_outcome to escalate a repeat offender to the next tier
-- itself rather than trusting the caller to reclassify by hand.
--
-- Depends on 072_m1_reputation_events_and_eligibility.sql (reputation_events,
-- record_reputation_event) and 078_m1_conduct_outcome_and_hold_reversal.sql
-- (apply_conduct_outcome, clear_reputation_hold, both still in force).
-- Authored locally; not deployed. Requires a Trust Case reviewer to call it,
-- which still does not exist (see docs/ai/modules/TRUST_SAFETY_HANDOVER.md).

alter table public.reputation_events
  drop constraint if exists reputation_events_event_type_check,
  add constraint reputation_events_event_type_check check (event_type in (
    'ride_completed', 'on_time_check_in',
    'review_5_star', 'review_4_star', 'review_3_star', 'review_2_star', 'review_1_star',
    'host_cancelled_early', 'host_cancelled_late', 'host_cancelled_very_late',
    'traveller_cancelled_early', 'traveller_cancelled_late', 'traveller_cancelled_very_late',
    'no_show',
    'confirmed_minor_conduct', 'confirmed_moderate_conduct',
    'confirmed_serious_conduct', 'confirmed_severe_conduct'
  ));

-- Four tiers instead of two:
--   minor    -8  no automatic hold  - etiquette/trust friction, no danger
--   moderate -14 no automatic hold  - aggressive/discriminatory conduct, still not a hold on its own
--   serious  -20 automatic hold     - dangerous or exploitative (078_m1's original "serious")
--   severe   -30 automatic hold     - the ceiling: assault, DUI endangerment, serious fraud
--
-- Escalation - a repeat offender is reclassified upward automatically:
--   3rd confirmed minor within 90 days    -> recorded as moderate instead
--   2nd confirmed moderate within 180 days -> recorded as serious instead
--   2nd confirmed serious ever             -> recorded as severe instead
-- "3rd/2nd" means the count of the member's *prior* confirmed events at that
-- tier already meets the threshold before this one is added, so the
-- escalated event itself is what a Trust Case reviewer sees and the ledger
-- entry always reflects what actually got applied, never the milder request
-- that came in. p_event_type is preserved in metadata so the original
-- classification a reviewer chose is never lost.
create or replace function private.apply_conduct_outcome(
  p_user_id uuid,
  p_event_type text,
  p_source_event_id text,
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
  v_effective_type text := p_event_type;
  v_escalated boolean := false;
  v_prior_count integer;
  v_delta integer;
  v_hold boolean;
  v_applied boolean;
begin
  if p_event_type not in (
    'confirmed_minor_conduct', 'confirmed_moderate_conduct',
    'confirmed_serious_conduct', 'confirmed_severe_conduct'
  ) then
    raise exception 'Unsupported conduct event type: %', p_event_type;
  end if;

  if p_event_type = 'confirmed_minor_conduct' then
    select count(*) into v_prior_count from public.reputation_events
      where user_id = p_user_id and event_type = 'confirmed_minor_conduct'
        and source_module = 'Safety' and created_at >= now() - interval '90 days';
    if v_prior_count >= 2 then
      v_effective_type := 'confirmed_moderate_conduct';
      v_escalated := true;
    end if;
  elsif p_event_type = 'confirmed_moderate_conduct' then
    select count(*) into v_prior_count from public.reputation_events
      where user_id = p_user_id and event_type = 'confirmed_moderate_conduct'
        and source_module = 'Safety' and created_at >= now() - interval '180 days';
    if v_prior_count >= 1 then
      v_effective_type := 'confirmed_serious_conduct';
      v_escalated := true;
    end if;
  elsif p_event_type = 'confirmed_serious_conduct' then
    select count(*) into v_prior_count from public.reputation_events
      where user_id = p_user_id and event_type = 'confirmed_serious_conduct'
        and source_module = 'Safety';
    if v_prior_count >= 1 then
      v_effective_type := 'confirmed_severe_conduct';
      v_escalated := true;
    end if;
  end if;

  v_delta := case v_effective_type
    when 'confirmed_minor_conduct' then -8
    when 'confirmed_moderate_conduct' then -14
    when 'confirmed_serious_conduct' then -20
    else -30
  end;

  -- serious/severe always hold; p_set_hold still lets a reviewer hold a
  -- minor/moderate case pending further review without changing its delta.
  v_hold := p_set_hold or v_effective_type in ('confirmed_serious_conduct', 'confirmed_severe_conduct');

  v_applied := private.record_reputation_event(
    p_user_id, p_ride_id, 'Safety', p_source_event_id, v_effective_type,
    'traveller', v_delta,
    case when v_escalated
      then coalesce(p_reason, '') || ' (escalated from ' || p_event_type || ' after repeat confirmed conduct)'
      else coalesce(p_reason, '')
    end,
    jsonb_build_object('requestedType', p_event_type, 'escalated', v_escalated)
  );

  if v_hold then
    update public.host_impact_stats
    set reputation_hold = true, reputation_updated_at = now(), updated_at = now()
    where user_id = p_user_id;
  end if;

  return v_applied;
end;
$$;

revoke all on function private.apply_conduct_outcome(uuid, text, text, text, uuid, boolean)
  from public, anon, authenticated;
