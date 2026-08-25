-- Module 2 pickup meeting photos and narrow destination-photo Place ID access.
-- Pickup photos stay private in Storage; only short-lived URLs are returned by
-- the m2-ride-pickup-photo Edge Function after ride-visibility checks.

alter table public.rides
  add column if not exists pickup_photo_path text;

alter table public.rides
  drop constraint if exists rides_pickup_photo_path_check;
alter table public.rides
  add constraint rides_pickup_photo_path_check check (
    pickup_photo_path is null
    or pickup_photo_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|png|jpg)$'
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ride-pickup-photos',
  'ride-pickup-photos',
  false,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Hosts upload pickup photos for editable rides" on storage.objects;
drop policy if exists "Hosts delete their pickup photos" on storage.objects;

create policy "Hosts upload pickup photos for editable rides"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'ride-pickup-photos'
    and array_length(storage.foldername(name), 1) = 3
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1
      from public.rides r
      where r.id = case
          when (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then ((storage.foldername(name))[2])::uuid
          else null
        end
        and r.host_id = (select auth.uid())
        and r.status in ('Draft', 'Published')
        and not exists (
          select 1 from public.ride_requests rr
          where rr.ride_id = r.id and rr.status = 'Accepted'
        )
    )
  );

create policy "Hosts delete their pickup photos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'ride-pickup-photos'
    and owner_id = (select auth.uid())::text
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create or replace function public.set_ride_pickup_photo(
  p_ride_id uuid,
  p_storage_path text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_ride public.rides%rowtype;
  v_old_path text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;

  select * into v_ride
  from public.rides
  where id = p_ride_id
  for update;

  if not found or v_ride.host_id <> v_user_id then raise exception 'Only the Host can change this pickup photo'; end if;
  if v_ride.status not in ('Draft', 'Published') then raise exception 'This Ride can no longer be edited'; end if;
  if exists (select 1 from public.ride_requests where ride_id = p_ride_id and status = 'Accepted') then
    raise exception 'This Ride already has an accepted request and can no longer be edited';
  end if;

  if nullif(btrim(p_storage_path), '') is not null then
    if split_part(p_storage_path, '/', 1) <> v_user_id::text
       or split_part(p_storage_path, '/', 2) <> p_ride_id::text
       or array_length(string_to_array(p_storage_path, '/'), 1) <> 3 then
      raise exception 'Invalid pickup photo path';
    end if;
    if not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'ride-pickup-photos'
        and o.name = p_storage_path
        and o.owner_id = v_user_id::text
        and coalesce((o.metadata->>'size')::bigint, 2097153) <= 2097152
        and coalesce(o.metadata->>'mimetype', '') in ('image/jpeg', 'image/png', 'image/webp')
    ) then raise exception 'Uploaded pickup photo could not be verified'; end if;
  end if;

  v_old_path := v_ride.pickup_photo_path;
  update public.rides
  set pickup_photo_path = nullif(btrim(p_storage_path), ''), updated_at = now()
  where id = p_ride_id;
  return v_old_path;
end;
$$;

create or replace function public.get_ride_destination_photo_place_ids(p_ride_ids uuid[])
returns table (ride_id uuid, destination_place_id text)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if p_ride_ids is null or cardinality(p_ride_ids) = 0 then return; end if;
  if cardinality(p_ride_ids) > 100 then raise exception 'A maximum of 100 rides may be requested'; end if;

  return query
  select r.id, r.destination_place_id
  from public.rides r
  join public.profiles p on p.id = r.host_id
  where r.id = any(p_ride_ids)
    and r.destination_place_id is not null
    and (
      (r.status = 'Published' and p.status = 'active')
      or r.host_id = v_user_id
      or exists (
        select 1 from public.ride_requests rr
        where rr.ride_id = r.id and rr.requester_id = v_user_id and rr.status = 'Accepted'
      )
    );
end;
$$;

create or replace function public.get_public_ride_pickup_context(p_ride_id uuid)
returns table (pickup_instructions text, has_photo boolean)
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(r.pickup_instructions, ''), r.pickup_photo_path is not null
  from public.rides r
  join public.profiles p on p.id = r.host_id and p.status = 'active'
  where r.id = p_ride_id and r.status = 'Published';
$$;

revoke all on function public.set_ride_pickup_photo(uuid, text) from public, anon, authenticated;
grant execute on function public.set_ride_pickup_photo(uuid, text) to authenticated;
revoke all on function public.get_ride_destination_photo_place_ids(uuid[]) from public, anon, authenticated;
grant execute on function public.get_ride_destination_photo_place_ids(uuid[]) to anon, authenticated;
revoke all on function public.get_public_ride_pickup_context(uuid) from public, anon, authenticated;
grant execute on function public.get_public_ride_pickup_context(uuid) to anon, authenticated;
