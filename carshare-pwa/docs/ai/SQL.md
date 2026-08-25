# SQL.md

## Purpose

This is the AI navigation guide for the Let's Tumpang database. Actual SQL
history lives in `database/sql/`; do not duplicate full migrations here.

## Current Status

```text
Supabase connected: Yes
Project ref: pnetstmovctfwqcumodx
Project URL: https://pnetstmovctfwqcumodx.supabase.co
Adopted live scope: Module 1 + Module 2 + Module 3 messaging + Module 4 favourites/proximity
Deployed SQL history: 001-026, 028, 033, 034, and 036_m3 as tracked Supabase
  migrations, plus tracked 035_m4 and 023, 027, 029, 030, 031, 032, and
  037_m2 applied through
  the Dashboard SQL Editor (see below)
Repository SQL history: 001-052
  (031 and 032 applied through the Dashboard SQL Editor on 2026-08-16;
  033 deployed as project_notifications on 2026-08-20; 034 and 035_m4 are
  deployed; 036_m3 is deployed as m3_message_translation; 037_m2 was applied
  through the Dashboard SQL Editor; 038, 041, 042, and 043 are deployed
  through shared migration tooling; 039 and 040 remain undeployed; 044 is the
  deployed advisor follow-up, 045 the dispute-resolution notification
  follow-up, 046 the role-admin reassignment follow-up, 047 its audit indexes,
  048 the history user-FK index, 049 applied through the Dashboard but absent
  from migration history, 050 the deployed Admin-removal compensation, and
  051 the authored but undeployed lifecycle-expiry compensation, and 052 the
  authored but undeployed Family Link crypto-schema correction)
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

`034_m4_smart_search_favourites.sql` was deployed through the shared Supabase
migration tooling and live-verified on 2026-08-20. Privileged favourite logic
lives in the non-exposed `private` schema; same-name `public` RPCs are narrow
`SECURITY INVOKER` wrappers granted only to `authenticated`. The table uses
owner RLS, add/remove is idempotent, and the safe list projection continues
showing unavailable saved rides without private Ride fields.

`035_m4_destination_proximity_search.sql` was deployed through the shared
Supabase migration tooling and anonymously live-verified on 2026-08-20. Its
public `SECURITY INVOKER` RPC resolves a public Module 6 destination hint through
a non-exposed privileged helper, privately correlates nearby catalogue source
IDs with `rides.destination_place_id`, and returns only card fields plus
computed distance. It accepts only 5/10/25 km, filters active Hosts, Published
rides, remaining seats, pickup, and Kuala Lumpur departure bounds, and exposes
no Ride Place ID, coordinate, pickup instruction, waypoint, or route geometry.

`036_m3_message_translation.sql` is deployed as `m3_message_translation`. It
adds a source-versioned shared cache keyed by message and target language for
English, Simplified Chinese, Bahasa Melayu, and Tamil text/voice translations.
Current conversation members receive SELECT only through RLS; browser roles
receive no write grant. The authenticated `m3-message-translation` Edge
Function performs separate membership, tombstone, and expiry checks before its
server client writes a Cloudflare-generated result.

`037_m2_early_start_and_eta_refresh.sql` was applied through the Dashboard SQL
Editor and is not present in the tracked migration list. It removes
authenticated execution of the legacy direct `start_ride` path, adds the actual
`rides.started_at`, and exposes two service-role-only helpers to the
`m2-route-quote` Edge Function. Before the scheduled departure, every Accepted
passenger must be Checked In; after departure, at least one must be Checked In
and remaining unresolved passengers may be marked No-show. The matching
`m2-route-quote` Edge Function is deployed as active version 11.

`038_m2_ride_usability_notifications.sql` is deployed as
`m2_ride_usability_notifications` after `033_project_notifications.sql`. It reuses
`private.create_user_notification(...)` for Module 2 request, cancellation,
arrangement, boarding, arrival, and completion events. Its private minute-Cron
producer adds deduplicated 24-hour, final-hour, and departure-due reminders;
departure catch-up is limited to 30 minutes. It creates no public table or
client RPC and does not change Push subscriptions, Edge Functions, VAPID,
service workers, or webhooks.

`039_m4_vehicle_language_filters.sql` is **written but not deployed** pending a
separate review. It adds nullable, validated vehicle categories and validated
Host language sets without guessing classifications for existing rows. Its
safe public search RPC preserves exact/proximity filtering and may return only
the category and language set alongside existing card fields. Privileged logic
remains in `private`; the `public` entry point is an invoker wrapper. Existing
Search contracts remain available before deployment, while explicitly selecting
a compatibility filter reports the missing migration honestly.

The post-deployment advisors reported no Module 4 security findings. Performance
reported the expected unused-index notice for the new favourites table and one
missing covering index on `ride_favourites.ride_id`. The latter is addressed by
`040_m4_favourites_advisor_followup.sql`, authored but not deployed so the
deployed `034` remains immutable. M2 migrations `041`-`043` are now deployed.

`041_m2_adaptive_checkin.sql` is deployed as `m2_adaptive_checkin`. Passenger
check-in accepts accuracy up to 150 m and distance up to
`least(200 + accuracy, 350)` m; Driver arrival remains 100 m/200 m. Raw
submitted coordinates are not stored.

`042_m2_live_location_tracking.sql` is deployed as `m2_live_location_tracking`.
It adds private consent sessions, latest points, sampled history, expiring
family-share hashes, map permits, evidence holds, filtered RPCs, and Realtime
broadcast policies. Browser roles have no direct table write access.

`043_project_trust_admin_ride_disputes.sql` is deployed as
`project_trust_admin_ride_disputes`. It adds the project role/audit boundary,
Module 2 dispute lifecycle, assigned Trust Admin evidence access, and retention
holds without creating a general enforcement system.

`044_m2_tracking_advisor_followup.sql` is deployed as
`m2_tracking_advisor_followup`. It adds covering indexes for the new private
foreign keys and rewrites the two Realtime read policies to evaluate the
authenticated user once per statement.

`045_m2_dispute_resolution_notifications.sql` is deployed as
`m2_dispute_resolution_notifications`. It keeps the assigned Trust Admin
resolution transition atomic, extends the evidence hold for 90 days, and sends
the opener a case-result notification without GPS data.

`046_m2_admin_dispute_reassignment.sql` is deployed as
`m2_admin_dispute_reassignment`. It gives Role Admin a non-GPS open-case queue,
audited reassignment to an active Trust Admin, and no direct browser table
access.

`047_m2_admin_audit_indexes.sql` is deployed as `m2_admin_audit_indexes` and
covers the audit table's actor and subject foreign keys.

`048_m2_history_user_index.sql` is deployed as `m2_history_user_index` and
covers the history table's user foreign key without changing its ride-first
playback ordering index.

`049_m2_tracking_correctness_fixes.sql` was applied through the Dashboard SQL
Editor and is absent from migration history. Its nullable historical Check-in
accuracy correction is live. Its temporary Role Admin actor-forwarding change
is removed by `050` together with the superseded Admin system.

`050_m2_remove_trust_admin.sql` is deployed as `m2_remove_trust_admin`. It removes the
project-role, ride-dispute and GPS-evidence tables/RPCs/notifications while
preserving live/latest/history, family shares, map permits and Module 5 replay.
It also separates valid scheduled/waiting family snapshots from invalid links,
keeps link expiry aligned to rescheduled departures, invalidates links on a
terminal Ride, and removes unavailable live coordinates after two minutes.
`m2-live-share` active version 4 consumes the UUID-free snapshot RPC; remote
`project-admin` and `ride-dispute-evidence` Edge Functions were deleted.

`051_m2_lifecycle_expiry_and_validation.sql` is authored locally and is **not
deployed**. It adds stable nullable `ride_requests.accepted_at`, a partial
participant-history index, the exact 30-minute unstarted-Ride expiry boundary,
Matched/Accepted invariants, terminal former-participant history access, and
safe expiry notifications. It replaces existing RPC bodies without changing
their signatures and leaves active Realtime/family access restricted to
current Accepted participants. Deployment must be separately approved; after
deployment, verify the existing overdue Matched Ride and requests, Cron,
notifications, and security/performance advisors.

`052_m2_fix_family_link_crypto_schema.sql` is authored locally and is **not
deployed**. It replaces only `create_m2_family_location_share(uuid)` so its
empty-search-path body calls `extensions.gen_random_bytes` and
`extensions.digest` explicitly. This fixes token creation on the shared
Supabase project without changing participation checks, expiry, token hashing,
the RPC signature, or its authenticated-only execute grant.

`docs/MODULE6-SCHEMA.md` is superseded: it describes the former Trust & Safety
module, whose scope moved to Modules 1/2/3/5. Module 6 is now Destination
Discovery - see `docs/ai/modules/M6_DESTINATION_DISCOVERY.md`.

## Current Database State

### Tables

- `profiles`: authenticated-visible safe fields only (`full_name`, photo, status); `spoken_languages` is authored in undeployed `039`.
- `profile_private`: owner-only phone and emergency contact. Email remains solely in Supabase Auth.
- `vehicles`: owner-only CRUD, an owner-managed `driver_license_number`, and at most one active vehicle per owner; nullable `vehicle_type` is authored in undeployed `039`.
- `host_impact_stats`: authenticated read-only; Module 2 review inserts maintain the public `rating` average, while other impact fields remain unchanged.
- `rides`: authoritative `departure_at`, lifecycle metadata, nullable Place ID/device-coordinate route references, public pickup instructions, authenticated browsing, and RPC-only mutation.
- `ride_requests`: private to requester and ride Host; multi-seat request state and companion names; RPC-only mutation. Authored migration `051` adds stable nullable `accepted_at` but it is not live until separately deployed.
- `ride_reviews`: authenticated-readable mutual reviews for Completed rides; RPC-only insert.
- `conversations`: one ride/traveller direct chat and one ride group, lifecycle snapshot, last-message pointer, and terminal retention.
- `conversation_members`: role, join/leave, per-user archive, and trusted read cursor.
- `messages`: user/system message rows with edit/delete tombstone state.
- `message_attachments`: ordered image/video Storage metadata, one coordinate pair, or one standalone audio object with a 1-180 second duration.
- `message_translations` (in deployed `036`): one source-versioned shared translation per message and target language; current visible members read it and only the translation Edge Function writes it.

Module 6 (in deployed `024`; the live catalogue remains opt-in in the frontend):

- `places`: shared read-only catalogue; lifecycle state, absence counter, and the pre-demotion state that makes restoration possible. Writes belong to the service-role ingestion pipeline only. `anon` reads a column-restricted, lifecycle-filtered subset (`029`, `030`); `authenticated` reads every column and every lifecycle state, trusting the JS layer to hide Retired/Pending-Enrichment rows.
- `place_interest`: owner-only rows, unique per (user, place, travel date). Aggregated across users by `place_latent_demand()`, which returns counts and never identities.
- `ride_notify_registration`: owner-only; unique per (user, place, travel date) so a repeat request shows the existing registration.
- `user_travel_preferences`: owner-only stated categories and a dismissal flag.

Module 4 (deployed `034`; deployed `035` adds no table; `039` changes the two
classification columns above but is not deployed):

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
- Translation-cache browser access is SELECT-only and follows the same visible-conversation/tombstone boundary; the authenticated Edge Function rechecks access before using its server credential to cache a result.
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
- `ride_favourites_user_created_idx` (in deployed `034`)

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
- `034_m4_smart_search_favourites.sql` - deployed and live-verified on 2026-08-20; Module 4 owner-scoped favourites, RLS, private privileged helpers, authenticated invoker wrappers, and safe unavailable-ride listing.
- `035_m4_destination_proximity_search.sql` - deployed and anonymously live-verified on 2026-08-20; public invoker safe-card proximity RPC over recommendable Module 6 destinations and private confirmed Ride destination IDs, with 5/10/25 km validation and no private Ride-location return fields.
- `036_m3_message_translation.sql` - deployed; four-language source-versioned text/voice translation cache, member-only SELECT RLS, and no browser write grant.
- `037_m2_early_start_and_eta_refresh.sql` - applied through the Dashboard SQL Editor; all-checked-in early Start, departure-time No-show handling, actual start timestamp, and guarded traffic-aware ETA refresh.
- `038_m2_ride_usability_notifications.sql` - deployed as
  `m2_ride_usability_notifications`; private Module 2 notification triggers
  and deduplicated minute-Cron reminders only.
- `039_m4_vehicle_language_filters.sql` - not deployed pending separate review; nullable validated vehicle categories, validated Host language sets, owner updates, and a safe exact/proximity compatibility-search RPC.
- `040_m4_favourites_advisor_followup.sql` - not deployed; adds the covering `ride_favourites(ride_id)` index requested by the post-034 performance advisor without rewriting deployed migration history.
- `041_m2_adaptive_checkin.sql` - deployed; accuracy-aware passenger check-in
  tolerance and nullable recorded accuracy.
- `042_m2_live_location_tracking.sql` - deployed; private live/latest/history,
  family-share, retention, map-permit, RPC, trigger, and Realtime contracts.
- `043_project_trust_admin_ride_disputes.sql` - deployed; role audit, ride
  dispute lifecycle, evidence access, and evidence holds.
- `044_m2_tracking_advisor_followup.sql` - deployed; private foreign-key
  covering indexes and optimized Realtime auth policies.
- `045_m2_dispute_resolution_notifications.sql` - deployed; safe resolution
  notification and post-closure evidence-hold extension.
- `046_m2_admin_dispute_reassignment.sql` - deployed; Role Admin queue,
  audited Trust Admin reassignment, and service-role-only admin RPCs.
- `047_m2_admin_audit_indexes.sql` - deployed; covering indexes for the
  reassignment audit foreign keys.
- `048_m2_history_user_index.sql` - deployed; user-first location-history
  foreign-key coverage.
- `049_m2_tracking_correctness_fixes.sql` - applied through Dashboard SQL
  Editor but absent from migration history; legacy nullable Check-in accuracy
  compatibility and temporary Role Admin actor forwarding.
- `050_m2_remove_trust_admin.sql` - deployed as `m2_remove_trust_admin`;
  compensating removal
  of the Trust Admin/dispute/evidence rollout while preserving and tightening
  participant/family live tracking and sampled history.
- `051_m2_lifecycle_expiry_and_validation.sql` - authored, not deployed;
  stable acceptance history, exact departure-grace expiry, Matched/request
  invariants, terminal former-participant access, validation alignment, and
  deduplicated expiry notifications.
- `052_m2_fix_family_link_crypto_schema.sql` - authored, not deployed;
  schema-qualifies the pgcrypto token generator and digest inside the existing
  authenticated Family Link creation RPC.
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
- `038_m2_ride_usability_notifications.sql` - deployed as
  `m2_ride_usability_notifications`; private Module 2 notification triggers
  and deduplicated minute-Cron reminders only.
- `037_m2_early_start_and_eta_refresh.sql` - applied through the Dashboard SQL
  Editor and recorded here because it is absent from migration history;
  all-checked-in early Start, departure-time No-show handling, actual start
  timestamp, and guarded traffic-aware ETA refresh. The matching
  `m2-route-quote` Function is active as version 11 after adding host-only
  recommendation route anchors and route-only quote fingerprinting.

## Rules for New Database Work

1. Plan the smallest required change.
2. Add the next numbered file under `database/sql/` using `NNN_mX_short_description.sql` (or `NNN_project_...`).
3. Never rewrite a deployed file; append a new migration.
4. Deploy through the shared migration tooling, not Dashboard-only edits.
5. Update this file after confirmed database changes.
6. Run security and performance advisors after DDL changes.
7. Never expose service-role/server secrets in frontend code or commit local environment files.
