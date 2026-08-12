# SQL.md

## Purpose

This is the AI navigation guide for the Let's Tumpang database. Actual SQL
history lives in `database/sql/`; do not duplicate full migrations here.

## Current Status

```text
Supabase connected: Yes
Project ref: pnetstmovctfwqcumodx
Project URL: https://pnetstmovctfwqcumodx.supabase.co
Adopted live scope: Module 1 + Module 2 ride CRUD/search
Official SQL history: 001-012
```

`001-010` were applied atomically as the initial schema on 2026-08-12.
`011-012` are deployed follow-ups for advisor findings and the confirmed
host-owned vehicle requirement. Future database changes start at `013` and
must not rewrite deployed history.

Modules 3-6 still use local adapters. `docs/MODULE6-SCHEMA.md` remains a draft.

## Current Database State

### Tables

- `profiles`: authenticated-visible safe fields only (`full_name`, photo, status).
- `profile_private`: owner-only phone and emergency contact. Email remains solely in Supabase Auth.
- `vehicles`: owner-only CRUD and at most one active vehicle per owner.
- `host_impact_stats`: authenticated read-only; future trusted server pipeline writes.
- `rides`: authenticated browsing of active hosts' published rides; hosts manage their own rides and drafts.

### Security and Storage

- RLS is enabled on all five public tables.
- `anon` has no business-table privileges.
- `authenticated` has explicit least-privilege table/column grants plus owner policies with `USING` and `WITH CHECK`.
- `public.handle_new_user()` is `SECURITY DEFINER`, has an empty `search_path`, uses schema-qualified names, and is not executable by `anon` or `authenticated`.
- The public `avatars` bucket allows JPEG, PNG, and WebP up to 5 MB. Authenticated users can write only below their own UUID folder.
- Rides require a vehicle owned by the host, persist `waypoints` as a JSON array, and enforce `0 <= seats_available <= seats_total`.

### Indexes

- `vehicles_owner_id_idx`
- `vehicles_one_active_per_owner_idx`
- `vehicles_id_owner_id_key`
- `rides_host_created_at_idx`
- `rides_status_date_idx`
- `rides_vehicle_host_idx`

Fresh empty-table indexes may appear as "unused" in the performance advisor until normal traffic exercises them.

## SQL File Map

- `001_m1_create_profiles.sql` - original profiles draft.
- `002_m1_create_vehicles.sql` - original vehicles draft.
- `003_m1_create_host_impact_stats.sql` - impact statistics.
- `004_m1_handle_new_user_trigger.sql` - original Auth trigger.
- `005_m1_enable_rls.sql` - original Module 1 policies.
- `006_m2_create_rides.sql` - original rides schema.
- `007_m2_enable_rls.sql` - original rides policies.
- `008_m1_secure_profiles_and_auth.sql` - private profile split, hardened trigger, grants, and authenticated RLS.
- `009_m1_secure_vehicles_and_avatars.sql` - owner-only vehicles, indexes, active constraint, and avatar bucket policies.
- `010_m2_harden_rides.sql` - waypoints, seat/ownership constraints, indexes, grants, and authenticated RLS.
- `011_project_advisor_followup.sql` - revokes client execution of the platform RLS event function and covers the composite ride FK.
- `012_m2_require_host_vehicle.sql` - makes host-owned vehicle selection mandatory for every ride.

## Rules for New Database Work

1. Plan the smallest required change.
2. Add the next numbered file under `database/sql/` using `NNN_mX_short_description.sql` (or `NNN_project_...`).
3. Never rewrite a deployed file; append a new migration.
4. Deploy through the shared migration tooling, not Dashboard-only edits.
5. Update this file after confirmed database changes.
6. Run security and performance advisors after DDL changes.
7. Never expose service-role/server secrets in frontend code or commit local environment files.
