-- Follow-up for findings returned by Supabase advisors after the initial batch.
-- The platform-created event trigger still works without client EXECUTE access.

revoke all on function public.rls_auto_enable() from public, anon, authenticated;

drop index public.rides_vehicle_id_idx;
create index rides_vehicle_host_idx
  on public.rides (vehicle_id, host_id);
