-- Module 6 demo aid: lets a signed-in user flip the lifecycle_state of a
-- place they have already shown interest in, so 075's notification trigger
-- can be demonstrated from the app itself instead of the SQL Editor.
-- Depends on 024_m6_destination_discovery.sql (public.places,
-- public.place_interest, public.ride_notify_registration) and
-- 075_m6_place_lifecycle_notification.sql (the trigger this update fires).
--
-- 024 deliberately left public.places with no user-facing write path
-- ("no administrative actor and no user-facing path that edits a place").
-- This migration opens exactly one narrow one: a caller may only move a
-- place they themselves have recorded interest in or hold an active
-- notify-me registration for - never an arbitrary place in the shared
-- catalogue. It is a demo aid, not an admin tool.

create or replace function public.m6_demo_set_place_lifecycle_state(
  p_place_id uuid,
  p_state text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed boolean;
begin
  if p_state not in ('Active', 'Stale', 'Retired') then
    raise exception 'Unsupported lifecycle state for the demo toggle.';
  end if;

  select exists (
    select 1 from public.place_interest
      where user_id = (select auth.uid()) and place_id = p_place_id
    union
    select 1 from public.ride_notify_registration
      where user_id = (select auth.uid()) and place_id = p_place_id and status = 'active'
  ) into v_allowed;

  if not v_allowed then
    raise exception 'You can only change the status of a place you have shown interest in.';
  end if;

  update public.places set lifecycle_state = p_state where id = p_place_id;
end;
$$;

revoke all on function public.m6_demo_set_place_lifecycle_state(uuid, text) from public, anon;
grant execute on function public.m6_demo_set_place_lifecycle_state(uuid, text) to authenticated;
