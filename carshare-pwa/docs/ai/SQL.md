# SQL.md

## Purpose

This is the AI navigation guide for the Let's Tumpang database. Actual SQL
history lives in `database/sql/`; do not duplicate full migrations here.

## Current Status

```text
Supabase connected: Yes
Project ref: pnetstmovctfwqcumodx
Project URL: https://pnetstmovctfwqcumodx.supabase.co
Adopted live scope: Module 1 + Module 2 + Module 3 messaging
Deployed SQL history: 001-018
Repository SQL history: 001-020
```

`001-010` were applied atomically as the initial schema on 2026-08-12.
`011-012` are deployed follow-ups for advisor findings and the confirmed
host-owned vehicle requirement. `013-015` were deployed on 2026-08-12 for the
confirmed Module 2 request, lifecycle, and review design. `016-018` were deployed
on 2026-08-13 for production Module 3 messaging, advisor follow-up, and versioned
media paths. `019_m1_add_vehicle_driver_license.sql` is the next repository
migration and is not deployed yet. `020_m2_add_route_locations.sql` is also
pending deployment and adds confirmed route references and pickup instructions.
Future changes start at `021`; deployed
history must not be rewritten.

Modules 4-6 still use local adapters. `docs/MODULE6-SCHEMA.md` remains a draft.

## Current Database State

### Tables

- `profiles`: authenticated-visible safe fields only (`full_name`, photo, status).
- `profile_private`: owner-only phone and emergency contact. Email remains solely in Supabase Auth.
- `vehicles`: owner-only CRUD and at most one active vehicle per owner. The repository expects an owner-only `driver_license_number` after pending migration `019`; live deployment is still required.
- `host_impact_stats`: authenticated read-only; Module 2 review inserts maintain the public `rating` average, while other impact fields remain unchanged.
- `rides`: authoritative `departure_at`, lifecycle metadata, authenticated browsing, and RPC-only mutation.
- `ride_requests`: private to requester and ride Host; multi-seat request state and companion names; RPC-only mutation.
- `ride_reviews`: authenticated-readable mutual reviews for Completed rides; RPC-only insert.
- `conversations`: one ride/traveller direct chat and one ride group, lifecycle snapshot, last-message pointer, and terminal retention.
- `conversation_members`: role, join/leave, per-user archive, and trusted read cursor.
- `messages`: user/system message rows with edit/delete tombstone state.
- `message_attachments`: ordered image/video Storage metadata or one coordinate pair.

### Security and Storage

- RLS is enabled on all eleven public tables.
- `anon` has no business-table privileges.
- `authenticated` has explicit least-privilege table/column grants plus owner policies with `USING` and `WITH CHECK`.
- `public.handle_new_user()` is `SECURITY DEFINER`, has an empty `search_path`, uses schema-qualified names, and is not executable by `anon` or `authenticated`.
- The public `avatars` bucket allows JPEG, PNG, and WebP up to 5 MB. Authenticated users can write only below their own UUID folder.
- The private `message-media` bucket accepts the approved image/video MIME types up to 50 MB per object. Listing is blocked and committed downloads require current conversation access.
- Rides require a vehicle owned by the host, persist `waypoints` as a JSON array, and enforce `0 <= seats_available <= seats_total`.
- Authenticated clients have SELECT but no direct INSERT/UPDATE/DELETE on rides, requests, or reviews. Narrow `SECURITY DEFINER` RPCs enforce ownership and cross-row invariants with an empty `search_path`.
- `private.process_ride_lifecycle()` runs every minute through active Cron job `m2-ride-lifecycle`. `transition_verified_ride()` is executable only by `service_role`.
- Messaging mutations are RPC-only; lifecycle, membership, archive/leave, ownership, Storage metadata, bundle limits, and edit/read races are checked inside locked transactions.
- All four messaging tables are in the `supabase_realtime` publication.

### Indexes

- `vehicles_owner_id_idx`
- `vehicles_one_active_per_owner_idx`
- `vehicles_id_owner_id_key`
- `rides_host_created_at_idx`
- `rides_status_date_idx`
- `rides_vehicle_host_idx`
- `rides_status_departure_at_idx`
- `rides_host_status_departure_at_idx`
- `ride_requests_one_active_per_requester_idx`
- `ride_requests_ride_status_created_idx`
- `ride_requests_requester_created_idx`
- `ride_requests_pending_ride_idx`
- `ride_reviews_reviewee_created_idx`
- `ride_reviews_reviewer_created_idx`
- `conversations_one_direct_per_ride_user_idx`
- `conversations_one_group_per_ride_idx`
- `conversations_direct_user_id_idx`
- `conversation_members_user_active_idx`
- `messages_conversation_created_idx`
- `message_attachments_message_sort_idx`

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
- `013_m2_ride_requests_and_departure.sql` - authoritative departure instant, ride lifecycle metadata, multi-seat requests, RLS/grants, and atomic RPC mutations.
- `014_m2_lifecycle_cron.sql` - minute lifecycle processor and service-role-only verified ride transition.
- `015_m2_ride_reviews.sql` - mutual Completed-ride reviews and account-level average star rating updates.
- `016_m3_supabase_messaging.sql` - messaging schema, locked RPCs, RLS/grants, Accepted backfill, private media bucket, Realtime, and seven-day lifecycle.
- `017_m3_advisor_followup.sql` - covering index for the direct-user foreign key.
- `018_m3_versioned_media_paths.sql` - sender/conversation/message/version Storage paths and matching RPC/policy contract.
- `019_m1_add_vehicle_driver_license.sql` - pending deployment; adds `vehicles.driver_license_number` plus its column grants.
- `020_m2_add_route_locations.sql` - pending deployment; nullable Place ID/device-coordinate route references, public pickup instructions, constraints, and updated create/update RPCs.

## Rules for New Database Work

1. Plan the smallest required change.
2. Add the next numbered file under `database/sql/` using `NNN_mX_short_description.sql` (or `NNN_project_...`).
3. Never rewrite a deployed file; append a new migration.
4. Deploy through the shared migration tooling, not Dashboard-only edits.
5. Update this file after confirmed database changes.
6. Run security and performance advisors after DDL changes.
7. Never expose service-role/server secrets in frontend code or commit local environment files.
