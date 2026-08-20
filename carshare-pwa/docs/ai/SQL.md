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
Deployed SQL history: 001-026, 028, 033, and 034 as tracked Supabase
  migrations, plus 023, 027, 029, 030, 031, and 032 applied through the
  Dashboard SQL Editor (see below)
Repository SQL history: 001-036
  (031 and 032 applied through the Dashboard SQL Editor on 2026-08-16;
  033 deployed as project_notifications on 2026-08-20; 034 is deployed; 035
  remains local; 036 was applied through the Dashboard SQL Editor)
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
the next new migration starts at `031`.

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

`028_m2_route_schedule_and_completion.sql` was deployed on 2026-08-14 as the
Supabase migration `m2_route_schedule_and_completion` (live version
`20260814114744`). It adds
server-quoted ETA/schedule fields, private route verification anchors, an
internal 250-request Malaysia-day Routes guard, serialized Driver overlap
checks, one-hour publish/request/reopen rules, passenger check-in/No-show,
verified departure and arrival, and 24-hour Cron completion. The matching
`m2-route-quote` and `m2-route-backfill` Edge Functions are deployed, while the
Google Routes server key is stored only as an Edge secret. The bounded ETA
backfill completed successfully for the two eligible future rides on 2026-08-14.
Google Cloud displays the Routes daily quota as unlimited and non-adjustable;
the dedicated Routes-only key is held only by the Edge Functions and the
database's fail-closed 250-request Malaysia-day guard is the enforced cap.
Deployed `001-028` must not be rewritten.

It was drafted as `021` before Module 3's `021`/`022` were deployed, and was
renumbered on merge rather than kept: two files sharing a number would leave
nobody able to tell which one to run.

`029_m6_anon_place_browsing.sql` is deployed through the Dashboard SQL Editor,
the same route as `023` and `027`. It grants `anon` read access on `places`
(column-restricted, originally excluding `source_place_id`,
`state_before_demotion`, and `absence_counter` - see `030` below for why that
list was wrong) and execute on `place_latent_demand(date)`, deploying D017's
"public-first browsing" decision to Destination Discovery - the one piece of
D017 the module's handover document had flagged as deliberately undeployed.
Unlike the existing `authenticated` policy (`using (true)`), this one filters
rows to `lifecycle_state in ('Active', 'Provisional', 'Stale')`: anonymous
traffic gets no equivalent to the JS-layer trust the authenticated policy
relies on to keep Retired and Pending-Enrichment rows out of view, so the
filter lives in the policy instead.

It was drafted as `028` before Module 2's `028_m2_route_schedule_and_completion.sql`
was deployed as a tracked migration, and was renumbered on merge rather than
kept, for the same reason as `024` above.

`030_m6_anon_source_place_id.sql` is deployed through the Dashboard SQL Editor,
fixing what `029` broke live: `discoverySupabaseRepository.js` selects one
fixed column list for every caller, authenticated or anon, and Postgres denies
a query for the *whole* table the moment any one requested column lacks a
grant for the current role - not just that column. Excluding
`source_place_id` from the anon grant did not quietly omit it from the
response, it made every anonymous `/discover` and Home-rail read fail with
`permission denied for table places`, confirmed the moment `029` was applied.
`source_place_id` also turned out not to be merely internal: it is
`destinationPlaceId` in the FR-6.35 prefill payload and the `sourcePlaceId`
`PlaceQueryService.js` exposes to Modules 2 and 4, so a signed-out visitor
needs it captured before the auth redirect. `state_before_demotion` and
`absence_counter` stayed excluded - confirmed genuinely unused by any
frontend caller - and were removed from `PLACE_SELECT` instead of granted, so
the query only asks for what is actually read. The next new migration starts
at `031`.

`031_m6_place_types.sql` and `032_m6_reclassify_ingested_places.sql` are
**deployed through the Dashboard SQL Editor** on 2026-08-16, and both belong to
the same problem. Verified live afterwards: 74 recommendable rows, the six
retired places absent from the `anon` view, the four recategorised ones correct,
and `anon` still refused `types`/`primary_type` as designed. The
Penang / Melaka / Selangor ingestion on 2026-08-16 grew the catalogue from 20
rows to 80 and misclassified ten of them, including four hotels and a shopping
mall filed as `event` destinations. `031` adds `types` and `primary_type` so the
inputs classification is derived from survive ingestion - without them a
classification bug can only be repaired by re-running the Enterprise +
Atmosphere enrichment request, which is what made the equivalent Kuala Lumpur
repair a manual REST PATCH with no record in this directory. `032` is that
record for this round: it retires the six rows that are not destinations and
recategorises four that are. Neither file changes any grant, and `032` is
idempotent. Deploy `031` before `032`.

`033_project_notifications.sql` is deployed as `project_notifications`. It
introduces the cross-module `user_notifications` inbox, device subscription
records, narrow read-state RPCs, a private producer helper, Realtime
publication, 30-day retention, and Message as the first producer by extending
`send_message`. The Edge Functions are deployed; the project owner still must
configure their VAPID secrets and Database Webhook as described in
`docs/SUPABASE-SETUP.md`. Future producers must call
`private.create_user_notification(...)`; they must not create their own bell,
unread counter, or browser-push implementation.

`027_m6_place_reviews.sql` is **deployed through the Dashboard SQL Editor**, the
same route as `023`: it is not present in the migration history returned by the
project, so this file remains the repository record of the applied SQL. It adds
`places.reviews` (jsonb, default `[]`, checked to be an array). The enrichment
pass already requests review text from Place Details - that request is what
prices enrichment at the Enterprise + Atmosphere tier - but nothing stored it:
the first review's text was written into `description` verbatim and
unattributed, and the rest were discarded. Reviews are now stored with their
author attribution and shown as reviews, and `description` returns to the
generated sentence FR-6.8 specifies. The compliance note in `024` extends to
this column and is restated in the file header.

It was drafted as `025` before Module 3's `025`/`026` were deployed, and was
renumbered on merge rather than kept: two files sharing a number would leave
nobody able to tell which one to run.

`034_m4_smart_search_favourites.sql` is **deployed** as
`m4_smart_search_favourites` - it
adds owner-scoped ride favourites and authenticated RPCs for idempotent
add/remove plus a safe card projection that continues showing unavailable saved
rides. The live migration list was rechecked on 2026-08-21.

`035_m2_ride_usability_notifications.sql` is **written but not yet deployed**
and must follow `033_project_notifications.sql`. It reuses
`private.create_user_notification(...)` for Module 2 request, cancellation,
arrangement, boarding, arrival, and completion events. Its private minute-Cron
producer adds deduplicated 24-hour, final-hour, and departure-due reminders;
departure catch-up is limited to 30 minutes. It creates no public table or
client RPC and does not change Push subscriptions, Edge Functions, VAPID,
service workers, or webhooks. Shared migration `033` is already deployed; `035`
still requires its own deployment and verification.

`036_m2_early_start_and_eta_refresh.sql` was applied through the Dashboard SQL
Editor and is not present in the tracked migration list. It removes
authenticated execution of the legacy direct `start_ride` path, adds the actual
`rides.started_at`, and exposes two service-role-only helpers to the
`m2-route-quote` Edge Function. Before the scheduled departure, every Accepted
passenger must be Checked In; after departure, at least one must be Checked In
and remaining unresolved passengers may be marked No-show. The matching
`m2-route-quote` Edge Function is deployed as active version 9. It requests a
fresh traffic-aware Google route, moves the Ride to In Transit, and persists the
recalculated ETA.

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

- `places`: shared read-only catalogue; lifecycle state, absence counter, and the pre-demotion state that makes restoration possible. Writes belong to the service-role ingestion pipeline only. `anon` reads a column-restricted, lifecycle-filtered subset (`029`, `030`); `authenticated` reads every column and every lifecycle state, trusting the JS layer to hide Retired/Pending-Enrichment rows.
- `place_interest`: owner-only rows, unique per (user, place, travel date). Aggregated across users by `place_latent_demand()`, which returns counts and never identities.
- `ride_notify_registration`: owner-only; unique per (user, place, travel date) so a repeat request shows the existing registration.
- `user_travel_preferences`: owner-only stated categories and a dismissal flag.

Module 4 (in `034`, not yet deployed):

- `ride_favourites`: one owner-scoped saved reference per user and ride. The
  reference survives ride lifecycle changes and is deleted with either parent.

### Security and Storage

- RLS is enabled on all eleven public tables.
- `anon` has narrow, explicit, column-restricted read grants only: Published rides and active-Host safe profile/impact data (`023`), and the recommendable subset of `places` plus `place_latent_demand()` (`029`, `030`). No other business table grants anything to `anon`.
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
- `ride_favourites_user_created_idx` (in undeployed `034`)

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
- `034_m4_smart_search_favourites.sql` - deployed; Module 4 owner-scoped favourites, RLS, authenticated mutations, and safe unavailable-ride listing.
- `023_m1_m2_public_ride_browsing.sql` - deployed through the Dashboard SQL Editor; anon read policies and minimum column grants for Published rides plus active Host safe profile/impact data; guest access excludes Place IDs, precise coordinates, and pickup instructions.
- `024_m6_destination_discovery.sql` - deployed as `m6_destination_discovery`; Module 6 catalogue, interest, notification registrations, preferences, RLS, aggregate demand RPC, and cross-module near-point RPC.
- `025_m3_add_voice_messages.sql` - deployed; standalone private voice attachments, duration/size/MIME constraints, RPC enforcement, edit rejection, and private bucket audio allowlist.
- `026_m3_add_wav_voice_fallback.sql` - deployed; adds Audio WAV to the voice attachment, send RPC, and private bucket allowlists for reliable Chromium/Electron playback.
- `027_m6_place_reviews.sql` - deployed through the Dashboard SQL Editor; adds `places.reviews` (jsonb, array-checked) so enrichment's Place Details review text is stored with author attribution instead of being written unattributed into `description`.
- `028_m2_route_schedule_and_completion.sql` - deployed as `m2_route_schedule_and_completion`; server route quotes and ETA, private route anchors, serialized Driver schedule conflicts, one-hour boundaries, GPS check-in/arrival, No-show, dual confirmation, and 24-hour auto-completion.
- `029_m6_anon_place_browsing.sql` - deployed through the Dashboard SQL Editor; grants `anon` a filtered, column-restricted read on `places` plus execute on `place_latent_demand`, deploying D017's public-first browsing to Destination Discovery.
- `030_m6_anon_source_place_id.sql` - deployed through the Dashboard SQL Editor; grants `anon` read on `source_place_id`, which `029` had wrongly excluded and which broke every anonymous discovery read until fixed.
- `031_m6_place_types.sql` - deployed through the Dashboard SQL Editor; adds `places.types` and `places.primary_type` so a classification fix can be re-applied without buying enrichment again. No grants: `authenticated` inherits them from `024`'s table-level grant, and `anon` is deliberately left without them because `PLACE_SELECT` does not name them.
- `032_m6_reclassify_ingested_places.sql` - deployed through the Dashboard SQL Editor; retires four hotels, a shopping mall and a columbarium that the Penang/Melaka/Selangor sweep filed as destinations, and corrects the category of four real destinations. Idempotent.
- `033_project_notifications.sql` - deployed as `project_notifications` on
  2026-08-20; shared recipient-owned notification inbox, protected device
  subscriptions, narrow read RPCs, 30-day retention, Realtime, and Message
  producer integration.
- `035_m2_ride_usability_notifications.sql` - written locally and pending
  deployment after `033`; private Module 2 notification triggers and
  deduplicated minute-Cron reminders only.
- `036_m2_early_start_and_eta_refresh.sql` - applied through the Dashboard SQL
  Editor and recorded here because it is absent from migration history;
  all-checked-in early Start, departure-time No-show handling, actual start
  timestamp, and guarded traffic-aware ETA refresh. The matching
  `m2-route-quote` Function is active as version 9.

## Rules for New Database Work

1. Plan the smallest required change.
2. Add the next numbered file under `database/sql/` using `NNN_mX_short_description.sql` (or `NNN_project_...`).
3. Never rewrite a deployed file; append a new migration.
4. Deploy through the shared migration tooling, not Dashboard-only edits.
5. Update this file after confirmed database changes.
6. Run security and performance advisors after DDL changes.
7. Never expose service-role/server secrets in frontend code or commit local environment files.
