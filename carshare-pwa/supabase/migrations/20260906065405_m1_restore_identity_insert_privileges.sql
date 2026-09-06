-- Restore the two INSERT columns required by IdentityVerificationService's
-- owner-scoped upsert. RLS remains enabled and continues enforcing ownership.
grant insert (ic_number, license_expiry)
  on table public.identity_verifications to authenticated;
