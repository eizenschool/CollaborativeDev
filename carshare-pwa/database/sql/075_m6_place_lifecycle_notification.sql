-- Module 6: notify a traveller who has shown interest in a place when that
-- place's lifecycle_state degrades to Stale or Retired. Depends on
-- 024_m6_destination_discovery.sql (public.places, public.place_interest,
-- public.ride_notify_registration) and 033_project_notifications.sql
-- (private.create_user_notification). Follows the shape of
-- 041_m6_ride_available_notification.sql - a single trigger, no new tables,
-- no Web Push/Edge Function changes.
--
-- Note: as of this migration, nothing writes public.places.lifecycle_state
-- automatically in production - FR-6.3/6.4/6.5 auto-decay was deliberately
-- left disabled in supabase/functions/m6-ingest/index.ts because Nearby
-- Search's 20-result cap made "not seen this sweep" an untrustworthy
-- absence signal (see that file's comment block). This trigger still fires
-- correctly on a manual admin correction (like 032's one-off UPDATE) and is
-- ready for whichever future caller finally re-enables decay with a
-- trustworthy signal - it does not depend on how lifecycle_state changes,
-- only on the fact that it did.

create or replace function private.notify_m6_place_lifecycle_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_title text;
  v_body text;
  v_event_type text;
begin
  if new.lifecycle_state is not distinct from old.lifecycle_state
     or new.lifecycle_state not in ('Stale', 'Retired') then
    return new;
  end if;

  if new.lifecycle_state = 'Stale' then
    v_event_type := 'place_stale';
    v_title := 'A destination you''re watching is quieter lately';
    v_body := 'We haven''t been able to confirm recent details for ' || new.name
      || '. It''s still listed, but check back before planning around it.';
  else
    v_event_type := 'place_retired';
    v_title := 'A destination you''re watching was removed';
    v_body := new.name || ' is no longer listed in the catalogue.';
  end if;

  for v_user_id in
    select user_id from public.place_interest
      where place_id = new.id
        and travel_date >= (now() at time zone 'Asia/Kuala_Lumpur')::date
    union
    select user_id from public.ride_notify_registration
      where place_id = new.id and status = 'active'
  loop
    perform private.create_user_notification(
      v_user_id, 'm6', v_event_type, v_title, v_body,
      '/discover/' || new.id::text,
      jsonb_build_object('placeId', new.id, 'lifecycleState', new.lifecycle_state),
      'm6:lifecycle:' || new.id::text || ':' || new.lifecycle_state || ':' || v_user_id::text
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists notify_m6_place_lifecycle_change on public.places;
create trigger notify_m6_place_lifecycle_change
after update of lifecycle_state
on public.places
for each row execute function private.notify_m6_place_lifecycle_change();

revoke all on function private.notify_m6_place_lifecycle_change() from public, anon, authenticated;
