-- Every ride must use a vehicle owned by its host.

alter table public.rides
  drop constraint rides_vehicle_owned_by_host_fkey,
  alter column vehicle_id set not null,
  add constraint rides_vehicle_owned_by_host_fkey
    foreign key (vehicle_id, host_id)
    references public.vehicles (id, owner_id);
