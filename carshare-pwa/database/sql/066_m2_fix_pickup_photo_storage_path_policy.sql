-- Compensating fix for the deployed 059/060 pickup-photo policies.
-- storage.foldername(name) returns folders only, excluding the filename. The
-- upload path is user-id/ride-id/filename, so it contains two folders.

drop policy if exists "Hosts upload pickup photos for editable rides" on storage.objects;
drop policy if exists "Hosts read own pickup photo upload metadata" on storage.objects;

create policy "Hosts upload pickup photos for editable rides"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'ride-pickup-photos'
    and array_length(storage.foldername(name), 1) = 2
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

create policy "Hosts read own pickup photo upload metadata"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'ride-pickup-photos'
    and owner_id = (select auth.uid())::text
    and array_length(storage.foldername(name), 1) = 2
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
          select 1
          from public.ride_requests rr
          where rr.ride_id = r.id
            and rr.status = 'Accepted'
        )
    )
  );
