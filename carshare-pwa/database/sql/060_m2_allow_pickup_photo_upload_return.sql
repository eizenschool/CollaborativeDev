-- Supabase Storage returns the inserted object row after upload. The original
-- pickup-photo contract granted INSERT and DELETE only, so the RETURNING read
-- was rejected by storage.objects RLS even when the Host upload was valid.

drop policy if exists "Hosts read own pickup photo upload metadata" on storage.objects;

create policy "Hosts read own pickup photo upload metadata"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'ride-pickup-photos'
    and owner_id = (select auth.uid())::text
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
          select 1
          from public.ride_requests rr
          where rr.ride_id = r.id
            and rr.status = 'Accepted'
        )
    )
  );
