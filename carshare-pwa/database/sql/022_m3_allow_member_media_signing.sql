-- Module 3: permit a current conversation member to generate a short-lived
-- download URL for committed media without allowing bucket listing.
--
-- Recent Supabase Storage versions classify these POST endpoints separately
-- from the authenticated GET endpoint. The existing policy permitted the
-- eventual download but rejected createSignedUrl(s) with HTTP 400.

drop policy if exists "members download committed message media" on storage.objects;

create policy "members download committed message media"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'message-media'
    and storage.allow_any_operation(array[
      'storage.object.sign',
      'storage.object.sign_many',
      'storage.object.get_authenticated_info',
      'storage.object.get_authenticated'
    ])
    and exists (
      select 1
      from public.message_attachments ma
      join public.messages m on m.id = ma.message_id
      where ma.storage_path = storage.objects.name
        and (select private.conversation_is_visible(
          m.conversation_id,
          (select auth.uid())
        ))
    )
  );
