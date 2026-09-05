-- Module 1: strengthen the two identity gates that already exist, without
-- introducing document photos. Nothing here is identity verification - no
-- badge, no public signal, and no reputation effect (D030 still stands).
--
-- 1. Record that the MyKad structural gate ran on an account, without ever
--    storing the IC number itself.
-- 2. Give a vehicle's driver's license an expiry date, and make a usable
--    license a server-enforced condition of publishing a Ride.

-- --- 1. MyKad structural gate ------------------------------------------------
-- Only the fact and time of the check are kept. The IC number stays client-side
-- and is still never transmitted or persisted, so this column is a record that
-- the sign-up gate ran - not proof the number belongs to the account holder.
alter table public.profile_private
  add column if not exists ic_checked_at timestamptz;

-- Deliberately absent: any insert/update grant on ic_checked_at. Only the
-- account-creation trigger below writes it, so a client cannot set its own.
revoke update (ic_checked_at) on table public.profile_private from anon, authenticated;

-- Replaces the 008_m1 definition verbatim plus the ic_checked_at line. The
-- trigger reads the sign-up payload at account creation, which is the only
-- moment the gate result is available for both the confirmed-session and
-- pending-email-confirmation sign-up paths.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, profile_photo_url)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'New member'
    ),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
      nullif(new.raw_user_meta_data ->> 'picture', '')
    )
  );

  insert into public.profile_private (user_id, phone, ic_checked_at)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'phone', ''),
    case
      when (new.raw_user_meta_data ->> 'ic_format_checked') = 'true' then now()
      else null
    end
  );

  insert into public.host_impact_stats (user_id)
  values (new.id);

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

-- --- 2. Driver's license expiry ----------------------------------------------
-- Nullable for the same reason 019_m1 defaulted the number to '': existing rows
-- are not backfilled, and a null expiry means "not captured" rather than
-- "expired". VehicleService requires a future date on every new save, so the
-- unknown case drains as owners edit their vehicles.
alter table public.vehicles
  add column if not exists driver_license_expiry date;

grant insert (driver_license_expiry) on table public.vehicles to authenticated;
grant update (driver_license_expiry) on table public.vehicles to authenticated;

-- Publishing already needs a vehicle; it now also needs that vehicle's license
-- to be present and, when the expiry is known, unexpired. Separate from
-- private.enforce_ride_reputation_eligibility() so the two gates stay
-- independently readable and independently removable.
create or replace function private.enforce_ride_driver_license()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expiry date;
  v_number text;
  v_needs_check boolean := false;
begin
  if tg_op = 'INSERT' then
    v_needs_check := new.status = 'Published';
  else
    v_needs_check := new.status = 'Published' and old.status is distinct from 'Published';
  end if;

  if v_needs_check and new.vehicle_id is not null then
    select btrim(coalesce(driver_license_number, '')), driver_license_expiry
    into v_number, v_expiry
    from public.vehicles
    where id = new.vehicle_id;

    if v_number = '' then
      raise exception 'Add your driver''s license number to this vehicle before publishing a ride';
    end if;

    if v_expiry is not null and v_expiry < current_date then
      raise exception 'This vehicle''s driver''s license expired on %. Renew it before publishing a ride', v_expiry;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_ride_driver_license_before_publish on public.rides;
create trigger enforce_ride_driver_license_before_publish before insert or update of status on public.rides
for each row execute function private.enforce_ride_driver_license();
