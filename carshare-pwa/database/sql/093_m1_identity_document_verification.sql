-- Module 1: identity verification moves from sign-up to the point of use.
--
-- Sign-up no longer asks for a MyKad number at all. Instead a Host uploads a
-- photo of their MyKad before they can publish a Ride. That closes the hole
-- where "Continue with Google" skipped the sign-up gate entirely, and it stops
-- asking for an identity document from members who only browse or ride along.
--
-- These images are sensitive personal data under the PDPA. They are held in a
-- PRIVATE bucket readable only by their owner, never rendered on a public
-- profile or a Ride card, and no client role can approve its own submission.

-- --- 1. Retire the sign-up flag added by 088_m1 ------------------------------
-- handle_new_user() is restored to its 008_m1 body first, so dropping the
-- column cannot break account creation.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $BODY$
begin
  insert into public.profiles (id, full_name, profile_photo_url)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'New member'
    ),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
      nullif(new.raw_user_meta_data ->> 'picture', '')
    )
  );

  insert into public.profile_private (user_id, phone)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'phone', ''));

  insert into public.host_impact_stats (user_id)
  values (new.id);

  return new;
end;
$BODY$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

alter table public.profile_private
  drop column if exists ic_checked_at;

-- --- 2. Private document storage --------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'identity-documents',
  'identity-documents',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "users upload their own identity documents" on storage.objects;
drop policy if exists "users read their own identity documents" on storage.objects;
drop policy if exists "users replace their own identity documents" on storage.objects;
drop policy if exists "users delete their own identity documents" on storage.objects;

create policy "users upload their own identity documents"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'identity-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Owner-only SELECT. There is deliberately no anon policy and no public URL:
-- the only way to view one of these images is a short-lived signed URL created
-- by the owner, or the service role during review.
create policy "users read their own identity documents"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'identity-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "users replace their own identity documents"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'identity-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'identity-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "users delete their own identity documents"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'identity-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- --- 3. Submission record ----------------------------------------------------
create table if not exists public.identity_verifications (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  document_path text not null,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  review_note text
);

alter table public.identity_verifications enable row level security;

drop policy if exists "owners read their own verification" on public.identity_verifications;
drop policy if exists "owners submit their own verification" on public.identity_verifications;
drop policy if exists "owners resubmit their own verification" on public.identity_verifications;

create policy "owners read their own verification"
  on public.identity_verifications for select to authenticated
  using (user_id = (select auth.uid()));

-- A client may only ever create a pending row for itself.
create policy "owners submit their own verification"
  on public.identity_verifications for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'pending');

-- Resubmission after a rejection returns the row to pending; it can never move
-- itself to approved.
create policy "owners resubmit their own verification"
  on public.identity_verifications for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and status = 'pending');

revoke all on table public.identity_verifications from anon, authenticated;
grant select on table public.identity_verifications to authenticated;
grant insert (user_id, status, document_path) on table public.identity_verifications to authenticated;
grant update (status, document_path, submitted_at) on table public.identity_verifications to authenticated;

-- --- 4. Publishing requires a submitted document -----------------------------
-- Kept separate from the reputation and driver's-licence triggers so each gate
-- stays independently readable and removable.
create or replace function private.enforce_ride_identity_verification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $BODY$
declare
  v_status text;
  v_needs_check boolean := false;
begin
  if tg_op = 'INSERT' then
    v_needs_check := new.status = 'Published';
  else
    v_needs_check := new.status = 'Published' and old.status is distinct from 'Published';
  end if;

  if v_needs_check then
    select status into v_status
    from public.identity_verifications
    where user_id = new.host_id;

    if v_status is null then
      raise exception 'Upload a photo of your MyKad before publishing a ride';
    end if;
    if v_status = 'rejected' then
      raise exception 'Your identity document was not accepted. Upload a clearer photo before publishing a ride';
    end if;
  end if;

  return new;
end;
$BODY$;

drop trigger if exists enforce_ride_identity_before_publish on public.rides;
create trigger enforce_ride_identity_before_publish before insert or update of status on public.rides
for each row execute function private.enforce_ride_identity_verification();

-- --- 5. Review path ----------------------------------------------------------
-- Service-role only, following 078_m1: the shared Trust & Safety admin surface
-- is still an open team decision, and this must not wait for it. No grant to
-- anon or authenticated, so no member can approve anybody - including itself.
create or replace function private.review_identity_verification(
  p_user_id uuid,
  p_outcome text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $BODY$
begin
  if p_outcome not in ('approved', 'rejected') then
    raise exception 'Outcome must be approved or rejected';
  end if;

  update public.identity_verifications
  set status = p_outcome,
      reviewed_at = now(),
      review_note = p_note
  where user_id = p_user_id;

  if not found then
    raise exception 'No identity submission for this member';
  end if;
end;
$BODY$;

revoke all on function private.review_identity_verification(uuid, text, text) from public, anon, authenticated;
