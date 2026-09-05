-- 094_m1 granted only a column-restricted UPDATE (status, document_path,
-- submitted_at, ic_number, license_expiry) on identity_verifications.
-- Confirmed live: supabase-js's .upsert(), which PostgREST turns into
-- INSERT ... ON CONFLICT (user_id) DO UPDATE SET ..., does not accept that
-- column-restricted grant - Postgres itself reports "permission denied for
-- table identity_verifications" and its own hint asks for the plain
-- table-level grant below, not a narrower one. The same trap 071_project
-- already hit on profile_visibility.
--
-- Row Level Security still does the real access control here (093_m1's
-- owner-only policies, and the fact that only private.review_identity_
-- verification, a service-role function, may ever write 'approved' or
-- 'rejected'); this grant only clears the statement-shape rejection that
-- happens before RLS is even evaluated.

grant update on table public.identity_verifications to authenticated;
