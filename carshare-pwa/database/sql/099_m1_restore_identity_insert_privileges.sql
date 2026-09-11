-- Module 1: restore the INSERT privileges required by the identity upsert.
--
-- The live table retained 093_m1's original INSERT grant for user_id, status
-- and document_path, but not the ic_number and license_expiry columns added by
-- 094_m1. IdentityVerificationService submits all five columns in one
-- INSERT ... ON CONFLICT DO UPDATE statement, so Postgres rejects the whole
-- statement with 42501 before the owner-only RLS policies are evaluated.
--
-- Keep this column-scoped: authenticated members still receive no broad table
-- INSERT grant, and 093_m1's RLS policy continues limiting inserts to their own
-- user_id with status = 'pending'.

grant insert (ic_number, license_expiry)
  on table public.identity_verifications to authenticated;
