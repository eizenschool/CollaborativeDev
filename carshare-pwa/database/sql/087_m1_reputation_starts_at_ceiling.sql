-- Module 1: reputation starts at the 100 ceiling instead of 70.
-- Supersedes the constants (not the structure) of 072_m1: the ledger, the
-- per-event clamp, the +3 per-Ride positive cap, the event deltas and the
-- three-Ride provisional window are all unchanged.
--
-- Reputation is now standing that is kept rather than points that are earned.
-- Nobody starts below a threshold, so the thresholds move to where losses
-- matter: publishing needs 90 (was 65) and requesting needs 75 (was 50), which
-- keeps roughly the same tolerance for loss the 70 base allowed while raising
-- the standard required to act. Positive Ride outcomes still apply, but at 100
-- they are spent rather than banked - existing least(100, ...) clamping in
-- private.apply_reputation_event() already enforces that.
--
-- Ordinary login, profile completion, identity documents and CO2 impact
-- continue to award no reputation.

-- Rebase live scores onto the new origin before the default moves. Every
-- score recorded under 072 is "70 plus that member's event history", so a
-- +30 shift clamped at 100 reproduces the same history against a 100 start.
-- Guarded by the current column default so re-running this file is a no-op.
do $$
begin
  if (
    select column_default
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'host_impact_stats'
      and column_name = 'reputation_score'
  ) = '70' then
    update public.host_impact_stats
    set reputation_score = least(100, greatest(0, reputation_score) + 30),
        reputation_updated_at = now();
  end if;
end $$;

alter table public.host_impact_stats
  alter column reputation_score set default 100;

create or replace function private.enforce_ride_reputation_eligibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_score integer := 100;
  v_hold boolean := false;
  v_evidence integer := 0;
  v_needs_check boolean := false;
begin
  if tg_op = 'INSERT' then
    v_needs_check := new.status = 'Published';
  else
    v_needs_check := new.status = 'Published' and old.status is distinct from 'Published';
  end if;

  if v_needs_check then
    select reputation_score, reputation_hold into v_score, v_hold
    from public.host_impact_stats where user_id = new.host_id;
    v_evidence := private.reputation_evidence_count(new.host_id);
    if v_hold then raise exception 'Ride publishing is paused while a confirmed safety case is reviewed'; end if;
    if v_evidence >= 3 and v_score < 90 then
      raise exception 'A reputation score of 90 or higher is required to publish a new ride';
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.enforce_request_reputation_eligibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_score integer := 100;
  v_hold boolean := false;
  v_evidence integer := 0;
begin
  select reputation_score, reputation_hold into v_score, v_hold
  from public.host_impact_stats where user_id = new.requester_id;
  v_evidence := private.reputation_evidence_count(new.requester_id);
  if v_hold then raise exception 'Ride requests are paused while a confirmed safety case is reviewed'; end if;
  if v_evidence >= 3 and v_score < 75 then
    raise exception 'A reputation score of 75 or higher is required to request a new ride';
  end if;
  return new;
end;
$$;

create or replace function public.get_reputation_summary(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_stats public.host_impact_stats%rowtype;
  v_review_count integer;
  v_events jsonb;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then raise exception 'Not authorised'; end if;
  select * into v_stats from public.host_impact_stats where user_id = p_user_id;
  select count(*)::integer into v_review_count from public.ride_reviews where reviewee_id = p_user_id;
  select coalesce(jsonb_agg(to_jsonb(e) order by e."createdAt" desc), '[]'::jsonb) into v_events
  from (
    select id, ride_id as "rideId", event_type as type, delta, reason, created_at as "createdAt"
    from public.reputation_events where user_id = p_user_id order by created_at desc limit 20
  ) e;
  return jsonb_build_object(
    'score', coalesce(v_stats.reputation_score, 100),
    'hold', coalesce(v_stats.reputation_hold, false),
    'rating', v_stats.rating,
    'reviewCount', coalesce(v_review_count, 0),
    'completedTrips', coalesce(v_stats.completed_trips, 0),
    'evidenceCount', private.reputation_evidence_count(p_user_id),
    'events', v_events
  );
end;
$$;

create or replace function public.get_ride_eligibility(p_role text default 'traveller')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_score integer := 100;
  v_hold boolean := false;
  v_evidence integer := 0;
  v_minimum integer := case when p_role = 'host' then 90 else 75 end;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select reputation_score, reputation_hold into v_score, v_hold
  from public.host_impact_stats where user_id = v_user_id;
  v_evidence := private.reputation_evidence_count(v_user_id);
  return jsonb_build_object(
    'eligible', not v_hold and (v_evidence < 3 or v_score >= v_minimum),
    'score', v_score, 'hold', v_hold, 'evidenceCount', v_evidence,
    'provisional', v_evidence < 3, 'minimum', v_minimum
  );
end;
$$;

-- Re-asserted rather than assumed: 072_m1 established this exact grant shape,
-- and repeating it keeps the two functions callable if any earlier replace
-- dropped their ACL. This file does not touch the private schema's grants.
revoke all on function public.get_reputation_summary(uuid) from public, anon, authenticated;
revoke all on function public.get_ride_eligibility(text) from public, anon, authenticated;
grant execute on function public.get_reputation_summary(uuid) to authenticated;
grant execute on function public.get_ride_eligibility(text) to authenticated;
