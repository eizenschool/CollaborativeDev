-- Module 1: repair live schema drift left by the retired per-vehicle
-- driver's-licence publish gate.
--
-- Driver documents now belong to the account-level identity verification
-- record. The current publish guard is
-- private.enforce_ride_identity_verification(), installed on public.rides as
-- enforce_ride_identity_before_publish. Do not remove the legacy vehicle gate
-- unless that replacement is present.

do $BODY$
begin
  if not exists (
    select 1
    from pg_catalog.pg_trigger as trigger
    join pg_catalog.pg_class as relation on relation.oid = trigger.tgrelid
    join pg_catalog.pg_namespace as relation_schema on relation_schema.oid = relation.relnamespace
    join pg_catalog.pg_proc as trigger_function on trigger_function.oid = trigger.tgfoid
    join pg_catalog.pg_namespace as function_schema on function_schema.oid = trigger_function.pronamespace
    where not trigger.tgisinternal
      and relation_schema.nspname = 'public'
      and relation.relname = 'rides'
      and trigger.tgname = 'enforce_ride_identity_before_publish'
      and function_schema.nspname = 'private'
      and trigger_function.proname = 'enforce_ride_identity_verification'
  ) then
    raise exception 'Cannot remove the legacy vehicle licence gate: the account-level identity publish gate is missing';
  end if;
end;
$BODY$;

drop trigger if exists enforce_ride_driver_license_before_publish on public.rides;
