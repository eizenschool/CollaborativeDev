-- Module 1: the MyKad is entered once, on the identity record, and the
-- driver's licence moves with it.
--
-- 019_m1 and 088_m1 put the licence number and its expiry on `vehicles`, so a
-- Host retyped the same MyKad number for every car they registered. A licence
-- belongs to a person, not to a vehicle: one account, one licence, entered
-- once alongside the MyKad photo that 093_m1 already collects.
--
-- The number is held beside the photo, under the same owner-only RLS. That is
-- not a new exposure: the photo already shows the number. It never enters the
-- public profile projection, a Ride card, or any anon-readable path.

alter table public.identity_verifications
  add column if not exists ic_number text,
  add column if not exists license_expiry date;

-- Owners supply both when they submit; neither may be edited to approve
-- themselves, which the existing 093_m1 policies already prevent.
grant insert (user_id, status, document_path, ic_number, license_expiry)
  on table public.identity_verifications to authenticated;
grant update (status, document_path, submitted_at, ic_number, license_expiry)
  on table public.identity_verifications to authenticated;

-- The vehicle-level licence gate from 088_m1 is retired: new vehicles no
-- longer carry a licence number, so leaving that trigger in place would refuse
-- every Ride published with one. `vehicles.driver_license_number` and
-- `vehicles.driver_license_expiry` are left in place, unused, rather than
-- dropped - they still hold what existing rows captured, and dropping columns
-- other modules may read is not this change's business.
drop trigger if exists enforce_ride_driver_license_before_publish on public.rides;

-- Identity now carries both conditions: a submission that has not been
-- rejected, and a licence that has not lapsed.
create or replace function private.enforce_ride_identity_verification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $BODY$
declare
  v_status text;
  v_expiry date;
  v_ic text;
  v_needs_check boolean := false;
begin
  if tg_op = 'INSERT' then
    v_needs_check := new.status = 'Published';
  else
    v_needs_check := new.status = 'Published' and old.status is distinct from 'Published';
  end if;

  if v_needs_check then
    select status, license_expiry, ic_number into v_status, v_expiry, v_ic
    from public.identity_verifications
    where user_id = new.host_id;

    if v_status is null then
      raise exception 'Upload a photo of your MyKad before publishing a ride';
    end if;
    if v_status = 'rejected' then
      raise exception 'Your identity document was not accepted. Upload a clearer photo before publishing a ride';
    end if;
    -- The column is nullable, so the client sending the number with the photo
    -- is not proof a row has one: a direct API write could skip it. A licence
    -- number IS the MyKad number, so a submission without one carries no
    -- licence either. Unlike the expiry above this is checked strictly, because
    -- 093_m1 and 094_m1 deploy together - no row can predate the column.
    if coalesce(btrim(v_ic), '') = '' then
      raise exception 'Add your MyKad number before publishing a ride';
    end if;
    -- A submission made before this migration has no expiry on record. That
    -- unknown is treated as valid rather than lapsed, so no Host who already
    -- verified is locked out by a column that did not exist when they did.
    if v_expiry is not null and v_expiry < current_date then
      raise exception 'Your driver''s licence expired on %. Renew it before publishing a ride', v_expiry;
    end if;
  end if;

  return new;
end;
$BODY$;
