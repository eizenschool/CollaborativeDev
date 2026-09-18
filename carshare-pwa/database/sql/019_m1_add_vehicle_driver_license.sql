-- Module 1: capture the owner's driver's license number when adding a
-- vehicle, as an input-capture eligibility gate (not a rigorous verification -
-- that remains Module 6's domain). Defaults to '' so the not-null constraint
-- does not break any existing rows; the application layer (VehicleService.js)
-- requires a non-empty value on every new save.

alter table public.vehicles
  add column driver_license_number text not null default '';

grant insert (driver_license_number) on table public.vehicles to authenticated;
grant update (driver_license_number) on table public.vehicles to authenticated;
