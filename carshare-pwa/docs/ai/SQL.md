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
 Deployed SQL history: 001-026
Repository SQL history: 001-027 (027 local / undeployed)
```

`001-010` were applied atomically as the initial schema on 2026-08-12.
`011-012` are deployed follow-ups for advisor findings and the confirmed
host-owned vehicle requirement. `013-015` were deployed on 2026-08-12 for the
confirmed Module 2 request, lifecycle, and review design. `016-018` were deployed
on 2026-08-13 for production Module 3 messaging, advisor follow-up, and versioned
media paths. `019_m1_add_vehicle_driver_license.sql` and
`020_m2_add_route_locations.sql` were deployed on 2026-08-13 for the vehicle
driver-licence field, confirmed route references, pickup instructions, and the
replacement Ride RPC signatures. `021_m3_stabilize_realtime_reads.sql` was
deployed on 2026-08-13 to make read-cursor advancement idempotent and stop
Realtime refresh loops. `022_m3_allow_member_media_signing.sql` was deployed
on 2026-08-13 to allow current conversation members to generate short-lived
URLs for private chat media.
`023_m1_m2_public_ride_browsing.sql` is live through the Dashboard SQL Editor;
its anonymous column-level policies and grants were deployed after the public
payload was approved. It is not present in the migration history returned by the
project, so this file remains the repository record of the applied SQL. The
payload excludes Place IDs, precise coordinates, pickup instructions, and
lifecycle timestamps from guest reads. Deployed history must not be rewritten;
the next new migration after local `027` starts at `028`.

`024_m6_destination_discovery.sql` is **deployed** as the Supabase migration
`m6_destination_discovery` - it adds the Module 6 place catalogue, recorded
interest, notification registrations, and stated travel preferences. The live
catalogue remains opt-in in the frontend; the fixture adapter is still the
default for offline demos and tests.

`025_m3_add_voice_messages.sql` was deployed on 2026-08-13. It adds standalone
1-180 second private voice messages, a 10 MB audio limit, Audio WebM/MP4/Ogg
validation, duration metadata, non-editability, Storage-object verification,
and the matching private bucket MIME allowlist.

`026_m3_add_wav_voice_fallback.sql` was deployed on 2026-08-14. It permits the
16 kHz mono PCM WAV fallback used when Chromium/Electron MediaRecorder output
cannot be decoded, while retaining the same standalone, duration, size, private
Storage, and signed-URL rules.

`027_m2_route_schedule_and_completion.sql` is **local and undeployed**. It adds
server-quoted ETA/schedule fields, private route verification anchors, an
internal 250-request Malaysia-day Routes guard, serialized Driver overlap
checks, one-hour publish/request/reopen rules, passenger check-in/No-show,
verified departure and arrival, and 24-hour Cron completion. Do not apply it
until live migration history has been rechecked and the user authorizes both
the migration and matching Edge Functions. The next new migration starts at
`028`; deployed `001-026` must not be rewritten.

It was drafted as `021` before Module 3's `021`/`022` were deployed, and was
renumbered on merge rather than kept: two files sharing a number would leave
nobody able to tell which one to run.

`docs/MODULE6-SCHEMA.md` is superseded: it describes the former Trust & Safety
module, whose scope moved to Modules 1/2/3/5. Module 6 is now Destination
Discovery - see `docs/ai/modules/M6_DESTINATION_DISCOVERY.md`.

## Current Database State

### Tables

- `profiles`: authenticated-visible safe fields only (`full_name`, photo, status).
- `profile_private`: owner-only phone and emergency contact. Email remains solely in Supabase Auth.
- `vehicles`: owner-only CRUD, an owner-managed `driver_license_number`, and at most one active vehicle per owner.
- `host_impact_stats`: authenticated read-only; Module 2 review inserts maintain the public `rating` average, while other impact fields remain unchanged.
- `rides`: authoritative `departure_at`, lifecycle metadata, nullable Place ID/device-coordinate route references, public pickup instructions, authenticated browsing, and RPC-only mutation.
- `ride_requests`: private to requester and ride Host; multi-seat request state and companion names; RPC-only mutation.
- `ride_reviews`: authenticated-readable mutual reviews for Completed rides; RPC-only insert.
- `conversations`: one ride/traveller direct chat and one ride group, lifecycle snapshot, last-message pointer, and terminal retention.
- `conversation_members`: role, join/leave, per-user archive, and trusted read cursor.
- `messages`: user/system message rows with edit/delete tombstone state.
- `message_attachments`: ordered image/video Storage metadata, one coordinate pair, or one standalone audio object with a 1-180 second duration.

Module 6 (in deployed `024`; the live catalogue remains opt-in in the frontend):

- `places`: shared read-only catalogue; lifecycle state, absence counter, and the pre-demotion state that makes restoration possible. Writes belong to the service-role ingestion pipeline only.
- `place_interest`: owner-only rows, unique per (user, place, travel date). Aggregated across users by `place_latent_demand()`, which returns counts and never identities.
- `ride_notify_registration`: owner-only; unique per (user, place, travel date) so a repeat request shows the existing registration.
- `user_travel_preferences`: owner-only stated categories and a dismissal flag.

### Security and Storage

- RLS is enabled on all eleven public tables.
- `anon` has no business-table privileges.
- `authenticated` has explicit least-privilege table/column grants plus owner policies with `USING` and `WITH CHECK`.
- `public.handle_new_user()` is `SECURITY DEFINER`, has an empty `search_path`, uses schema-qualified names, and is not executable by `anon` or `authenticated`.
- The public `avatars` bucket allows JPEG, PNG, and WebP up to 5 MB. Authenticated users can write only below their own UUID folder.
- The private `message-media` bucket accepts the approved image/video/audio MIME types up to 50 MB per object. Message RPCs further limit audio to 10 MB. Listing is blocked; only current conversation members can create a short-lived URL for committed media, and the signed download does not need a public bucket.
- Rides require a vehicle owned by the host, persist `waypoints` as a JSON array, and enforce `0 <= seats_available <= seats_total`.
- Pickup coordinates must be stored as a valid latitude/longitude pair, and pickup instructions are limited to 300 characters.
- Authenticated clients have only the safe public Ride columns directly; Hosts
  and accepted passengers obtain private Ride detail through
  `get_participant_ride_detail()`. Clients have no direct INSERT/UPDATE/DELETE
  on rides, requests, or reviews. Narrow `SECURITY DEFINER` RPCs enforce
  ownership and cross-row invariants with an empty `search_path`.
- `private.process_ride_lifecycle()` runs every minute through active Cron job `m2-ride-lifecycle`. `transition_verified_ride()` is executable only by `service_role`.
- Messaging mutations are RPC-only; lifecycle, membership, archive/leave, ownership, Storage metadata, bundle limits, and edit/read races are checked inside locked transactions.
- Messaging read cursors update only when a newer inbound message exists, preventing no-op `conversation_members` updates from feeding Realtime refresh loops.
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
- `019_m1_add_vehicle_driver_license.sql` - deployed; adds `vehicles.driver_license_number` plus its column grants.
- `020_m2_add_route_locations.sql` - deployed; nullable Place ID/device-coordinate route references, public pickup instructions, constraints, and updated create/update RPCs.
- `021_m3_stabilize_realtime_reads.sql` - deployed; idempotent read-cursor advancement that avoids no-op Realtime update loops.
- `022_m3_allow_member_media_signing.sql` - deployed; permits private Storage signing only for a current conversation member's committed media, while keeping object listing blocked.
- `023_m1_m2_public_ride_browsing.sql` - deployed through the Dashboard SQL Editor; anon read policies and minimum column grants for Published rides plus active Host safe profile/impact data; guest access excludes Place IDs, precise coordinates, and pickup instructions.
- `024_m6_destination_discovery.sql` - deployed as `m6_destination_discovery`; Module 6 catalogue, interest, notification registrations, preferences, RLS, aggregate demand RPC, and cross-module near-point RPC.
- `025_m3_add_voice_messages.sql` - deployed; standalone private voice attachments, duration/size/MIME constraints, RPC enforcement, edit rejection, and private bucket audio allowlist.
- `026_m3_add_wav_voice_fallback.sql` - deployed; adds Audio WAV to the voice attachment, send RPC, and private bucket allowlists for reliable Chromium/Electron playback.
- `027_m2_route_schedule_and_completion.sql` - local/undeployed; server route quotes and ETA, private route anchors, serialized Driver schedule conflicts, one-hour boundaries, GPS check-in/arrival, No-show, dual confirmation, and 24-hour auto-completion.

## Rules for New Database Work

1. Plan the smallest required change.
2. Add the next numbered file under `database/sql/` using `NNN_mX_short_description.sql` (or `NNN_project_...`).
3. Never rewrite a deployed file; append a new migration.
4. Deploy through the shared migration tooling, not Dashboard-only edits.
5. Update this file after confirmed database changes.
6. Run security and performance advisors after DDL changes.
7. Never expose service-role/server secrets in frontend code or commit local environment files.
