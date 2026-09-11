-- Module 1: one MyKad number can back only one account.
--
-- Nothing before this stopped the same IC number appearing on two different
-- rows: a member whose reputation dropped, or whose document was rejected,
-- could sign up again under a fresh email and resubmit the same MyKad to
-- start clean. The number is normalized (dashes stripped) by
-- normalizeMalaysianIC before it is ever written, so a plain unique index is
-- enough - there is no second spelling of the same number to slip past it.
--
-- A partial index, not a table constraint: the column is nullable (093_m1),
-- and Postgres already treats every null as distinct from every other null in
-- a unique index, but the `where` makes that explicit rather than relying on
-- default behaviour. A submission's own resubmission keeps the same row
-- (093_m1's owner-only `onConflict: 'user_id'` upsert), so this only ever
-- blocks a *second account* reusing a number already on record - never a
-- member updating their own.
create unique index if not exists identity_verifications_ic_number_key
  on public.identity_verifications (ic_number)
  where ic_number is not null;
