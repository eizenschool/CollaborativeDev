-- Module 1: a minimal in-app surface for the review path 093_m1 deliberately
-- left service-role-only ("the shared Trust & Safety admin surface is still
-- an open team decision"). That decision is still open - Module 2 built a
-- full Trust Admin role and removed it again (055_m2_remove_trust_admin) - so
-- this does not build a role system. It is a single email allowlist checked
-- inside SECURITY DEFINER functions and RLS policies, reviewable and
-- reversible without a schema migration to a roles table.
--
-- Adding an admin here means adding their email to the array literal below
-- and re-running this file; there is deliberately no admin_users table yet.

create or replace function private.is_identity_review_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $BODY$
  select coalesce(auth.email(), '') = any (array['donghuanlin25@gmail.com']);
$BODY$;

-- Needed by both the RLS policies below and the wrapper function further
-- down, all of which run as `authenticated`, not as this function's owner.
revoke all on function private.is_identity_review_admin() from public, anon;
grant execute on function private.is_identity_review_admin() to authenticated;

-- --- Admin read access -------------------------------------------------------
-- Permissive policies OR together, so these add admin visibility on top of
-- the existing owner-only policies from 093_m1 without narrowing them.
drop policy if exists "admins read every identity verification" on public.identity_verifications;
create policy "admins read every identity verification"
  on public.identity_verifications for select to authenticated
  using (private.is_identity_review_admin());

drop policy if exists "admins read any identity document" on storage.objects;
create policy "admins read any identity document"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'identity-documents'
    and private.is_identity_review_admin()
  );

-- --- Admin review RPC ---------------------------------------------------------
-- private.review_identity_verification stays service-role-only exactly as
-- 093_m1 defined it; this wraps it with the same admin check enforced above,
-- rather than widening its own grant.
create or replace function public.admin_review_identity_verification(
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
  if not private.is_identity_review_admin() then
    raise exception 'Not authorized to review identity verifications';
  end if;

  perform private.review_identity_verification(p_user_id, p_outcome, p_note);
end;
$BODY$;

revoke all on function public.admin_review_identity_verification(uuid, text, text) from public, anon;
grant execute on function public.admin_review_identity_verification(uuid, text, text) to authenticated;
