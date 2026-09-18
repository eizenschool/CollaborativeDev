-- Module 1: closes a gap found auditing the Host Impact badge system -
-- host_impact_stats.completed_trips and co2_saved_kg were never written by
-- any ride-completion code path. private.record_reputation_event (072_m1)
-- only ever touches reputation_score; the trigger that fires when a ride
-- reaches Completed (074_m1's private.reputation_from_ride_status) records a
-- +1 ride_completed reputation event and stops there. Every account's
-- HostImpactEngine.js composite score (completedTrips x 2.0 + co2SavedKg x
-- 0.5) is therefore permanently 0 - Bronze forever, and the Module 5 monthly
-- leaderboard (which filters host_impact_stats for completed_trips > 0) is
-- permanently empty - regardless of how many rides actually complete.
--
-- Extends the same trigger rather than adding a second one, so a completed
-- ride's Host Impact credit and its Reputation credit apply atomically in one
-- transaction and can never drift out of step with each other. Only
-- increments when private.record_reputation_event actually applies a new
-- event - reusing its own on-conflict dedup on (user_id, source_module,
-- source_event_id, event_type) rather than adding a second guard, so this
-- stays correct even if a ride's 'Completed' transition were ever re-fired.
--
-- The CO2 estimate is not a new formula: private.ride_carbon_saved_kg mirrors
-- src/business-logic/m5-trips/TripHistoryEngine.js's already-shipped
-- estimateCarbonSavedKg() exactly (same AVG_DISTANCE_KM fallback table, same
-- 0.12 kg/passenger-km factor) instead of inventing a second estimate. That
-- factor is still an open, unratified decision per docs/ai/modules/
-- M5_TRIP_ECO.md's "Open Questions" - if the team revises it, this function
-- and TripHistoryEngine.js's constant are the two places to update together.
--
-- Both the host and each checked-in traveller receive full credit for the
-- ride's estimated carbon saving, not a per-seat share - matches how this
-- same trigger already gives every verified participant a full +1
-- ride_completed reputation event for the same ride, and how
-- TripHistoryEngine.js's own toHistoryCard() reports the same carbonSavedKg
-- on both the host's and each passenger's own history card.
--
-- Depends on 003_m1_create_host_impact_stats.sql (completed_trips,
-- co2_saved_kg columns), 028_m2_route_schedule_and_completion.sql
-- (rides.route_distance_meters), 072_m1_reputation_events_and_eligibility.sql
-- (record_reputation_event), and 074_m1_fix_ride_reputation_status_trigger.sql
-- (the currently-live trigger body this supersedes). Authored locally; not
-- deployed.

create or replace function private.ride_carbon_saved_kg(
  p_route_distance_meters integer,
  p_journey_scale text,
  p_seats_total integer,
  p_seats_available integer
)
returns numeric
language sql
immutable
security definer
set search_path = ''
as $$
  select case
    when greatest(0, coalesce(p_seats_total, 0) - coalesce(p_seats_available, 0)) <= 0 then 0::numeric
    else round(
      (case
        when p_route_distance_meters is not null and p_route_distance_meters > 0
          then p_route_distance_meters / 1000.0
        when p_journey_scale = 'Intercity' then 340
        else 18
      end)
      * greatest(0, coalesce(p_seats_total, 0) - coalesce(p_seats_available, 0))
      * 0.12,
    1)
  end;
$$;

revoke all on function private.ride_carbon_saved_kg(integer, text, integer, integer)
  from public, anon, authenticated;

create or replace function private.reputation_from_ride_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event text;
  v_delta integer;
  v_cancelled_at timestamptz;
  v_request record;
  v_carbon numeric;
  v_applied boolean;
begin
  if new.status = 'Completed' and old.status is distinct from 'Completed' then
    v_carbon := private.ride_carbon_saved_kg(
      new.route_distance_meters, new.journey_scale, new.seats_total, new.seats_available
    );

    v_applied := private.record_reputation_event(
      new.host_id, new.id, 'M2', new.id::text || ':completed:host', 'ride_completed', 'host', 1,
      'Verified completed ride'
    );
    if v_applied then
      update public.host_impact_stats
      set completed_trips = completed_trips + 1,
          co2_saved_kg = co2_saved_kg + v_carbon,
          updated_at = now()
      where user_id = new.host_id;
    end if;

    for v_request in
      select id, requester_id from public.ride_requests
      where ride_id = new.id and status = 'Accepted' and boarding_status = 'Checked In'
    loop
      v_applied := private.record_reputation_event(
        v_request.requester_id, new.id, 'M2', v_request.id::text || ':completed', 'ride_completed',
        'traveller', 1, 'Verified completed ride'
      );
      if v_applied then
        update public.host_impact_stats
        set completed_trips = completed_trips + 1,
            co2_saved_kg = co2_saved_kg + v_carbon,
            updated_at = now()
        where user_id = v_request.requester_id;
      end if;
    end loop;
  elsif new.status = 'Cancelled' and old.status is distinct from 'Cancelled' then
    v_cancelled_at := coalesce(new.recruitment_closed_at, new.updated_at, now());
    if new.departure_at - v_cancelled_at > interval '24 hours' then v_event := 'host_cancelled_early'; v_delta := -1;
    elsif new.departure_at - v_cancelled_at >= interval '6 hours' then v_event := 'host_cancelled_late'; v_delta := -3;
    else v_event := 'host_cancelled_very_late'; v_delta := -6;
    end if;
    perform private.record_reputation_event(
      new.host_id, new.id, 'M2', new.id::text || ':cancelled:host', v_event, 'host', v_delta,
      'Driver cancellation'
    );
  end if;
  return new;
end;
$$;
