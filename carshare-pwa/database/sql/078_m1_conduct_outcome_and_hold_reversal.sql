-- Minimal Trust & Safety enforcement path for Module 1.
-- Authored, not deployed - see docs/ai/SQL.md.
-- confirmed_minor_conduct/confirmed_serious_conduct and reputation_hold have existed
-- since 072_m1 (its reputation_events.source_module check already allows 'Safety')
-- but nothing has ever written them; this closes that gap with a service-role-only
-- path rather than a client-facing admin surface, which TRUST_SAFETY_HANDOVER.md
-- flags as a separate whole-team decision.
-- Depends on 072_m1_reputation_events_and_eligibility.sql.

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
  v_delta integer;
  v_applied boolean;
begin
  if p_event_type not in ('confirmed_minor_conduct', 'confirmed_serious_conduct') then
    raise exception 'Unsupported conduct event type: %', p_event_type;
  end if;
  v_delta := case p_event_type when 'confirmed_minor_conduct' then -8 else -20 end;

  v_applied := private.record_reputation_event(
    p_user_id, p_ride_id, 'Safety', p_source_event_id, p_event_type,
    'traveller', v_delta, coalesce(p_reason, ''), '{}'::jsonb
  );

  if p_set_hold then
    update public.host_impact_stats
    set reputation_hold = true, reputation_updated_at = now(), updated_at = now()
    where user_id = p_user_id;
  end if;

  return v_applied;
end;
$$;

create or replace function private.clear_reputation_hold(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.host_impact_stats
  set reputation_hold = false, reputation_updated_at = now(), updated_at = now()
  where user_id = p_user_id;
end;
$$;

-- Neither function is granted to anon/authenticated: only service_role (which
-- bypasses grants in Supabase) can call them, same pattern as
-- transition_verified_ride in 014_m2_lifecycle_cron.sql.
revoke all on function private.apply_conduct_outcome(uuid, text, text, text, uuid, boolean)
  from public, anon, authenticated;
revoke all on function private.clear_reputation_hold(uuid)
  from public, anon, authenticated;
