-- Module 1 vehicle ownership and avatar storage hardening.

drop policy if exists "vehicles are publicly readable" on public.vehicles;
drop policy if exists "owners manage their own vehicles" on public.vehicles;
drop policy if exists "owners update their own vehicles" on public.vehicles;
drop policy if exists "owners delete their own vehicles" on public.vehicles;

create policy "owners read their own vehicles"
  on public.vehicles for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy "owners create their own vehicles"
  on public.vehicles for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "owners update their own vehicles"
  on public.vehicles for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "owners delete their own vehicles"
  on public.vehicles for delete to authenticated
  using ((select auth.uid()) = owner_id);

revoke all on table public.vehicles from public, anon, authenticated;
grant select on table public.vehicles to authenticated;
grant insert (owner_id, make, model, plate, colour, seats, year, active)
  on table public.vehicles to authenticated;
grant update (make, model, plate, colour, seats, year, active)
  on table public.vehicles to authenticated;
grant delete on table public.vehicles to authenticated;

create index vehicles_owner_id_idx on public.vehicles (owner_id);
create unique index vehicles_one_active_per_owner_idx
  on public.vehicles (owner_id) where active;
alter table public.vehicles
  add constraint vehicles_id_owner_id_key unique (id, owner_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "users upload their own avatars" on storage.objects;
drop policy if exists "users update their own avatars" on storage.objects;
drop policy if exists "users delete their own avatars" on storage.objects;

create policy "users upload their own avatars"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "users update their own avatars"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "users delete their own avatars"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
