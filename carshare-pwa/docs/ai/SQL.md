# SQL.md

## Purpose

This is the AI navigation guide for the Let's Tumpang database. Actual SQL
history lives in `database/sql/`; do not duplicate full migrations here.

## Current Status

```text
Supabase connected: Yes
Project ref: pnetstmovctfwqcumodx
Project URL: https://pnetstmovctfwqcumodx.supabase.co
Adopted live scope: Module 1 + Module 2 + Module 3 messaging + Module 4 search/favourites and favourite availability alerts
Deployed SQL history: 001-026, 028, 033-035, 036_m3, 038_m2-040_m4,
  045_m3, 057_m2, 060_m2-062_m2, 064_m2, 065_m3, 066_m2, 067_m4, 068_m4,
  069_project, 070_project, 072_m1, 073_m1, 074_m1, 082_m4, 099_m1, 113_m1,
  114_m2, 115_m2, and 116_m2 as tracked Supabase
  migrations, plus tracked 023, 027, 029, 030, 031, 032, and 037_m2
  applied through the Dashboard SQL Editor (see below)
Repository SQL history: 001-116 (`078_m1`, `087_m1`, `098_m1`, `104_m1`,
  `105_m1`, `106_m1`, `107_m1`, `108_m1`, `109_m1`, and `110_m1` are all
  confirmed live via a direct query against the linked database on
  2026-09-16 - see each entry below for what was checked; `088_m1` was not
  deployed as one unit (`profile_private.ic_checked_at` is absent), but its
  retired vehicle-licence trigger was found live on 2026-09-17; `093_m1`-
  `097_m1` are live without tracked migration entries; `099_m1` is deployed
  as a tracked migration; `113_m1` repaired that trigger drift as tracked
  migration `20260917063318_m1_remove_legacy_vehicle_license_gate`)
  (031 and 032 applied through the Dashboard SQL Editor on 2026-08-16;
  033 deployed as project_notifications on 2026-08-20; 034 and 035_m4 are
  deployed; 036_m3 is deployed as m3_message_translation; 037_m2 was applied
  through the Dashboard SQL Editor; 038_m2 is deployed as
  m2_ride_usability_notifications; 039, 040, 067_m4, and 068_m4 are deployed;
  065_m3 and 066_m2 are also deployed; the
  Module 6's `041_m6`-`042_m6` and Module 3's `043_m3`-`045_m3` retain their
  deployed numbering; Module 2's `041_m2`-`052_m2` sequence was renumbered to
  `046_m2`-`057_m2` during this merge to keep the shared history unambiguous.
  `056_m2`-`058_m2` remain authored locally and undeployed. The `059_m2`
  schema is live without a tracked migration entry; tracked `060_m2` adds the
  missing owner-scoped Storage SELECT policy required by upload RETURNING.
  `061_m2`, `062_m2`, and `064_m2` are deployed as tracked migrations;
  `063_m2` remains authored locally and undeployed; `065_m3` is deployed as
  `m3_terminal_chat_and_call_history`; `066_m2` is deployed as
`m2_fix_pickup_photo_storage_path_policy`; `077_m3`, `078_m1`, and `079_m3`
are authored locally and pending deployment. Module 1 migrations `072_m1`
and `073_m1` are deployed through the Dashboard SQL Editor (verified
2026-08-27: `reputation_events`, `profile_visibility`,
`get_reputation_summary`, and `get_public_profile` all exist live), but
`072_m1` reset the shared `private` schema's ACL without re-granting
`usage` afterward (unlike `016_m3`/`034_m4`/`035_m4`/`039_m4`, which all
do), breaking anon/authenticated access to every private-schema object -
Module 3 messaging and Module 4 search/favourites included, not just
Module 1. `069_project_restore_private_schema_grants.sql` restores that
grant plus the matching `private.profile_is_relevant_to_viewer` execute
grant `073_m1` revoked, but re-running `073_m1` re-revokes it every time
(073_m1 must never be re-run - it is a one-way regression against 069;
069 needs re-running again any time 073_m1 accidentally is).
`070_project_reassert_profile_visibility_table_grants.sql` is deployed
through the Dashboard SQL Editor (verified live via
`information_schema.role_column_grants`) and re-applies
`profile_visibility`'s column-restricted table grants in isolation so
that gap can be closed without touching 073_m1 again, but Postgres
rejects that column-restricted `update` grant for the
`INSERT ... ON CONFLICT DO UPDATE` supabase-js's `.upsert()` generates -
confirmed live via the exact `42501 permission denied for table
`profile_visibility` PostgREST error, whose own hint asks for a plain
table-level grant. `071_project_grant_table_level_profile_visibility_update.sql`
is authored locally, not yet deployed, and grants that. `082_m4` and `099_m1`
are deployed; the next unused repository sequence is `118`.)
```

### Driver document rollout (2026-09-06)

- `103_m1_passenger_identity_documents.sql` is deployed with user approval as
  `20260906134759_m1_passenger_identity_documents` (2026-09-06).
  Requires 100/101; does not activate pending 102. Adds `document_type`
  (legacy/default `mykad`) and private `passport_number`, plus authenticated
  SECURITY INVOKER `submit_identity_documents_v2`. Passenger IC uses 12 digits;
  Passport uses 5–20 ASCII letters/digits and one existing owner-scoped image.
  A changed type/number requires a replacement image. Driver checks remain
  strict, passenger updates preserve licence fields, and review resets to pending.
  The RPC also has column-level grants to clear review metadata on resubmission;
  owner RLS still requires pending status (no self-approval).
  Live preflight found the older status-only publish guard (not 094's IC
  check). 103 adds a separate Passport-only publish trigger; it does not
  replace the existing guard or activate 102. Published rides are unchanged.
  Passport also clears `ic_number`. RLS, private
  bucket image/5 MB restrictions, and reviewer access are unchanged.
  The connected local frontend can now use the deployed v2 contract.
  Legacy driver RPC/read fallback remains available before 103. No silent
  passenger fallback to the MyKad-only RPC. After Passport use, prefer frontend
  rollback with columns/data retained; do not drop stored Passport records.
  Post-deploy checks confirm SECURITY INVOKER, authenticated-only execution,
  RLS/private bucket, required column grants, unchanged legacy publish function,
  and all 3 existing identity rows retained. No real Passport upload yet.
  Authenticated-role transactional acceptance could not run: the MCP query
  role cannot SET ROLE authenticated. No submission changes were performed.
  Real owner upload/readback and rejection cases remain browser acceptance gates.
  Advisors report existing identity admin SECURITY DEFINER RPC notices and
  overlapping owner/admin SELECT policies; none name the new v2 RPC or trigger.
  These notices were not changed as part of 103.

- `100_m1_driver_document_submission.sql` is deployed as
  `20260906072749_m1_driver_document_submission`; adds nullable
  `license_document_path` and the authenticated SECURITY INVOKER RPC
  `submit_identity_documents(text,text,date,text,boolean)`. It verifies owner
  Storage paths/objects, preserves driver fields during passenger submissions,
  and resets submission/review timestamps and status to pending.
- `101_m1_validate_driver_document_birth_date.sql` is deployed as
  `20260906073043_m1_validate_driver_document_birth_date`; replaces the RPC's
  date validation with inferred-century `make_date`, including leap birthdays,
  and rejects underage driver submissions. Apply 100 then 101.
- `102_m1_require_driver_documents_to_publish.sql` - deployed, confirmed live
  2026-09-17: a direct query of `private.enforce_ride_identity_verification`'s
  live function body matches this file exactly (requires
  `license_document_path`, checks its storage object exists, enforces
  `license_expiry`), not the earlier, looser identity-status-only rule this
  file's header says to keep running until activation. It checks both stored
  owner photos, number, expiry and age on transitions into Published only.
  Existing published rides remain untouched.
- `113_m1_remove_legacy_vehicle_license_gate.sql` - deployed with user approval
  as tracked migration `20260917063318_m1_remove_legacy_vehicle_license_gate`.
  A 2026-09-17 live inspection found the retired
  `enforce_ride_driver_license_before_publish` trigger still attached to
  `public.rides` alongside the current account-level identity trigger. It is
  the exact source of the obsolete "Add your driver's license number to this
  vehicle" publish failure. The repair first proves that
  `enforce_ride_identity_before_publish` still calls
  `private.enforce_ride_identity_verification`, then drops only the legacy
  trigger. It leaves the current identity and Passport guards, both functions,
  all vehicle columns and all existing data unchanged. Post-deployment
  inspection confirmed the legacy trigger absent and both the account-level
  identity trigger and Passport driver-type guard still present. Pre/post
  advisors reported no finding caused by this trigger-only change.
- Live checks confirm private bucket, RLS, authenticated column grants,
  no anonymous read/RPC execution and SECURITY INVOKER submission. Transactional
  negative checks cover missing session, other-owner photo paths and underage
  submissions without retaining test data. Real signed-in upload acceptance
  and frontend deployment still need the target Netlify site.

The repository has one documented historical numbering collision at `075`
(`075_m3_conversation_lifecycle_redesign.sql` and the deployed
`075_m6_place_lifecycle_notification.sql`). Neither file is renamed or
overwritten; new work continues at the next unused number, which is why the
friendship migration is `079`.

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

`039_m4_vehicle_language_filters.sql` was deployed on 2026-08-27 as
`m4_vehicle_language_filters`. It adds nullable, validated vehicle categories and validated
Host language sets without guessing classifications for existing rows. Its
safe public search RPC preserves exact/proximity filtering and may return only
the category and language set alongside existing card fields. Privileged logic
remains in `private`; the `public` entry point is an invoker wrapper. Existing
Search contracts retain an honest compatibility-deployment error for other
environments that have not applied it.

`040_m4_favourites_advisor_followup.sql` was deployed on 2026-08-27 as
`m4_favourites_advisor_followup`. It adds the `ride_favourites(ride_id)` covering
index without rewriting deployed migration `034`; the missing-foreign-key-index
advisor notice cleared. An unused-index notice is expected until normal traffic
exercises the new lookup.

`067_m4_favourite_unavailable_notifications.sql` was deployed on 2026-08-27 as
`m4_favourite_unavailable_notifications`. Its private trigger detects only an
available-to-unavailable transition and calls the shared notification producer.
The transition timestamp forms part of the dedupe key, so a reopened ride can
produce one later alert without duplicate updates. The action path is an encoded
public Search URL and the payload contains no private location data.

`068_m4_multi_leg_journey_search.sql` was deployed on 2026-08-27 as
`m4_multi_leg_journey_search`. Its public invoker RPC wraps private matching of
confirmed endpoints through recommendable cultural destinations or catalogue
rest stops. Both legs must remain Published, have seats and stored ETAs, and
satisfy every selected filter. Urban transfers require chronological ordering;
an Intercity leg raises the minimum transfer to three hours. Only safe JSON ride
cards, the transfer display name/category, wait, and final ETA are returned.

These two Module 4 source files were renumbered from the original repository
slots `065`/`066` to `067`/`068` after deployment because newer Development
work had already claimed `065_m3` and `066_m2`. This repository-only rename
does not require either deployed migration to be executed again.

`082_m4_confirmed_location_search.sql` was deployed on 2026-09-03 as
`m4_confirmed_location_search`. It adds narrow anonymous/authenticated invoker
RPCs for direct and two-leg searches
whose entered Pickup/Destination came from Google Places autocomplete. Private
helpers compare passenger-supplied Place IDs against confirmed Ride endpoint
IDs and preserve the legacy text fallback only when a Ride has no stored ID.
The safe result shapes still exclude Ride Place IDs, coordinates, pickup
instructions, waypoints, and route geometry. Two partial endpoint indexes
support Published rides with remaining seats. Both RPCs were smoke-tested under
the `anon` role after deployment. The post-deployment advisors reported no new
Module 4 security finding; the destination index was initially reported as
unused, which is expected before normal confirmed-location traffic.

`041_m6_ride_available_notification.sql` is **deployed and live-verified,
2026-08-24**
and must follow `033_project_notifications.sql`. FR-6.33/UC6.12: a trigger on
`public.rides` that reuses `private.create_user_notification(...)` to notify
every active `ride_notify_registration` matching a newly Published/Matched
ride's destination and date, then flips the registration to `fulfilled`. A
daily Cron job expires stale `active` registrations whose travel date has
passed. It creates no public table or client RPC and does not change
`user_notifications`, Push subscriptions, Edge Functions, VAPID, service
workers, or webhooks.

`042_m6_scheduled_ingestion.sql` is **deployed and live-verified, 2026-08-24**:
`pg_net` enabled, both Vault secrets stored, and `cron.job` confirmed
`m6-catalogue-sweep` registered and active on schedule. Adds `pg_net` and a
weekly pg_cron job that calls `m6-ingest` with `maxDetails: 0` (Nearby Search
only, never Place Details). This is the first use of pg_net anywhere in this
project; every earlier cron job (`014`, `033`, `038`) calls a Postgres
function directly.

**Caught during the same verification pass, before any real damage:**
`m6-ingest`'s FR-6.3/6.4/6.5 auto-decay step (added alongside this migration)
used "not returned by this sweep's Nearby Search" as its absence signal, which
is untrustworthy for two independent reasons - the API hard-caps at 20 results
per call with no pagination while some swept states hold far more catalogued
places, and the sweep only searches a narrow default type list that several
catalogued categories (mosque, beach, zoo, water park, hawker stall) fall
outside of entirely. Both failures are systematically biased against quieter,
less-reviewed places, not against genuinely closed ones. Confirmed live that
no place had actually been mis-demoted (`absence_counter` was 0 everywhere)
before the cron job was unscheduled and the decay call removed from
`supabase/functions/m6-ingest/index.ts` - `lifecycleDecay.ts` and its tests
are untouched, kept for a future caller with a trustworthy per-place signal.
The Edge Function needs redeploying with this fix, then the schedule
re-enabled by re-running `042_m6`'s closing `cron.schedule(...)` block - this SQL
migration itself needed no changes. `docs/MODULE6-HANDOVER.md` §5/§8 has the
 full account. The next new migration starts at `046` because Module 3's
 `045_m3_reliable_voice_call_delivery.sql` now occupies that shared number.

`033_project_notifications.sql` and `041_m6_ride_available_notification.sql`
required deployment to this environment specifically during this same session
- `033` had never been applied here despite being recorded as deployed on the
shared team project, discovered when `041_m6` failed with `schema "private" does
not exist`. Both are now confirmed deployed and live-verified end to end
(registration → ride publish → notification received → registration
fulfilled).

`043_m3_add_voice_calls.sql` was applied outside tracked migration history on
2026-08-24. It adds participant-readable direct-call invitations, RPC-only call
state transitions, simultaneous-call serialization, and private Realtime
Broadcast authorization for WebRTC descriptions and ICE candidates. No call
audio is stored or relayed through the database.

`044_m3_turn_guard.sql` was applied outside tracked migration history on
2026-08-24. It adds server-only TURN monthly-usage state, short-lived credential
issuance metadata, an atomic 10-credentials-per-user hourly guard, and service-
role-only cleanup for calls that exceed 60 minutes. Browser roles receive no
grant or RLS policy on either TURN table.

`045_m3_reliable_voice_call_delivery.sql` is deployed as the tracked migration
`m3_reliable_voice_call_delivery`. Its private invoker trigger creates one
deduplicated, Push-only incoming-call notification for the callee when a ringing
call row is inserted. The notification action opens the direct conversation;
the call row and participant RLS remain authoritative. The matching deployed
`notification-push` version 11 keeps call alerts at a 45-second TTL and adds
one-hour urgent SOS delivery. The next new
migration starts at `046`.
M2 migrations `041`-`043` are now deployed.

`046_m2_adaptive_checkin.sql` is deployed as `m2_adaptive_checkin`. Passenger
check-in accepts accuracy up to 150 m and distance up to
`least(200 + accuracy, 350)` m; Driver arrival remains 100 m/200 m. Raw
submitted coordinates are not stored.

`047_m2_live_location_tracking.sql` is deployed as `m2_live_location_tracking`.
It adds private consent sessions, latest points, sampled history, expiring
family-share hashes, map permits, evidence holds, filtered RPCs, and Realtime
broadcast policies. Browser roles have no direct table write access.

`048_project_trust_admin_ride_disputes.sql` is deployed as
`project_trust_admin_ride_disputes`. It adds the project role/audit boundary,
Module 2 dispute lifecycle, assigned Trust Admin evidence access, and retention
holds without creating a general enforcement system.

`049_m2_tracking_advisor_followup.sql` is deployed as
`m2_tracking_advisor_followup`. It adds covering indexes for the new private
foreign keys and rewrites the two Realtime read policies to evaluate the
authenticated user once per statement.

`050_m2_dispute_resolution_notifications.sql` is deployed as
`m2_dispute_resolution_notifications`. It keeps the assigned Trust Admin
resolution transition atomic, extends the evidence hold for 90 days, and sends
the opener a case-result notification without GPS data.

`051_m2_admin_dispute_reassignment.sql` is deployed as
`m2_admin_dispute_reassignment`. It gives Role Admin a non-GPS open-case queue,
audited reassignment to an active Trust Admin, and no direct browser table
access.

`052_m2_admin_audit_indexes.sql` is deployed as `m2_admin_audit_indexes` and
covers the audit table's actor and subject foreign keys.

`053_m2_history_user_index.sql` is deployed as `m2_history_user_index` and
covers the history table's user foreign key without changing its ride-first
playback ordering index.

`054_m2_tracking_correctness_fixes.sql` was applied through the Dashboard SQL
Editor and is absent from migration history. Its nullable historical Check-in
accuracy correction is live. Its temporary Role Admin actor-forwarding change
is removed by `050` together with the superseded Admin system.

`055_m2_remove_trust_admin.sql` is deployed as `m2_remove_trust_admin`. It removes the
project-role, ride-dispute and GPS-evidence tables/RPCs/notifications while
preserving live/latest/history, family shares, map permits and Module 5 replay.
It also separates valid scheduled/waiting family snapshots from invalid links,
keeps link expiry aligned to rescheduled departures, invalidates links on a
terminal Ride, and removes unavailable live coordinates after two minutes.
`m2-live-share` active version 4 consumes the UUID-free snapshot RPC; remote
`project-admin` and `ride-dispute-evidence` Edge Functions were deleted.

`056_m2_lifecycle_expiry_and_validation.sql` is authored locally and is **not
deployed**. It adds stable nullable `ride_requests.accepted_at`, a partial
participant-history index, the exact 30-minute unstarted-Ride expiry boundary,
Matched/Accepted invariants, terminal former-participant history access, and
safe expiry notifications. It replaces existing RPC bodies without changing
their signatures and leaves active Realtime/family access restricted to
current Accepted participants. Deployment must be separately approved; after
deployment, verify the existing overdue Matched Ride and requests, Cron,
notifications, and security/performance advisors.

`057_m2_fix_family_link_crypto_schema.sql` is now recorded as tracked migration
`m2_fix_family_link_crypto_schema`. It replaced only
`create_m2_family_location_share(uuid)` so its
empty-search-path body calls `extensions.gen_random_bytes` and
`extensions.digest` explicitly. This fixes token creation on the shared
Supabase project without changing participation checks, expiry, token hashing,
the RPC signature, or its authenticated-only execute grant.

`061_m2_sos_trusted_family.sql` is deployed as `m2_sos_trusted_family`.
It adds hashed, one-use 24-hour trusted-family invites, one-way account
relationships, and one active SOS per Ride participant. Private tables have
RLS enabled and no browser table grants; authenticated `SECURITY DEFINER` RPCs
perform `auth.uid()`, current Driver/Accepted-passenger, one-hour window, and
active relationship checks. SOS notifications reuse
`private.create_user_notification(...)` and carry only an event ID. A minute
Cron marks a missing signal after 120 seconds, active SOS retains the last
private point, recovery is deduplicated, and resolution immediately removes
the coordinate while retaining a coordinate-free event shell for 24 hours.
Tracked `057` was reconciled first and `notification-push` version 11 is active.
The post-deployment advisor's three new foreign-key notices are covered by
tracked `062_m2_sos_advisor_followup.sql`; its private/no-policy INFO and
authenticated `SECURITY DEFINER` warnings are intentional because tables have
no browser grants and every narrow RPC performs explicit authorization.
Two-account/two-device acceptance is still required before
`VITE_M2_SOS_ENABLED` is enabled.

`058_m2_widen_checkin_tolerance.sql` is authored locally and is **not
deployed**. It widens passenger Check-in distance from
`least(200 + accuracy, 350)` m to `least(250 + accuracy, 400)` m while retaining
the 150 m accuracy ceiling, nullable accuracy for historical Checked In rows,
coordinate non-persistence, and the Driver arrival policy. It replaces the
existing RPC body without changing its signature or execute grant.

`docs/MODULE6-SCHEMA.md` is superseded: it describes the former Trust & Safety
module, whose scope moved to Modules 1/2/3/5. Module 6 is now Destination
Discovery - see `docs/ai/modules/M6_DESTINATION_DISCOVERY.md`.

## Current Database State

### Tables

- `profiles`: authenticated-visible safe fields plus deployed owner-managed `spoken_languages` from `039`; `profile_visibility` (deployed `073_m1`) narrows raw cross-profile rows and adds a privacy-filtered public RPC; private profile fields remain separate.
- `profile_private`: owner-only phone and emergency contact. Email remains solely in Supabase Auth.
- `profile_visibility` (deployed `073_m1`): owner-managed switches for public photo, languages, completed-trip count, and CO2 impact.
- `vehicles`: owner-only CRUD, an owner-managed `driver_license_number`, at most one active vehicle per owner, and deployed nullable `vehicle_type` from `039`.
- `host_impact_stats`: authenticated read-only; Module 2 review inserts maintain the public `rating` average, while other impact fields remain unchanged. Deployed `072_m1` adds a 70-point default, safety hold, and reputation update timestamp; authored `087_m1` moves that default to 100 and rebases existing scores by +30 clamped at 100.
- `reputation_events` (deployed `072_m1`): owner-readable, trigger-written, idempotent verified-Ride reputation ledger with a +3 positive cap per Ride.
- `safety_reports` (deployed `107_m1`): reporter- and admin-readable member-raised Trust & Safety queue entries (reason, optional Ride ID, open/resolved/dismissed status); RPC-only mutation, one open report per reporter/reported pair. `admin_list_safety_reports`'s ORDER BY bug is fixed by authored, undeployed `108_m1`.
- `rides`: authoritative `departure_at`, lifecycle metadata, nullable Place ID/device-coordinate route references, pickup instructions, one nullable private pickup-photo path after undeployed `059`, authenticated browsing, and RPC-only mutation.
- `ride_requests`: private to requester and ride Host; multi-seat request state and companion names; RPC-only mutation. Authored migration `051` adds stable nullable `accepted_at` but it is not live until separately deployed.
- `ride_reviews`: authenticated-readable mutual reviews for Completed rides; RPC-only insert.
- `friendships` (in authored `079`): one canonical account pair with a
  versioned pending/accepted/declined/removed state. Participants have SELECT
  only; every transition is an authenticated RPC.
- `conversations`: one ride/traveller direct chat, one ride group, and (after
  `079`) at most one separate non-expiring direct chat per friendship.
- `conversation_members`: ride/friend role, join/retained-leave, personal
  archive/delete/mute state, access expiry, and trusted read cursor.
- `messages`: user/system message rows with edit/delete tombstone state.
- `message_attachments`: ordered image/video Storage metadata, one coordinate pair, or one standalone audio object with a 1-180 second duration.
- `message_ride_invitations` (deployed `20260905093400`): one `ride_id`
  reference per Friend-chat message. Visible members have SELECT only; current
  Ride fields and recipient request eligibility come from an authenticated RPC
  instead of being copied into message history.
- `message_translations` (in deployed `036`): one source-versioned shared translation per message and target language; current visible members read it and only the translation Edge Function writes it.
- `call_sessions` (in live `043`, extended by deployed `080`): direct/group call lifecycle rows; participants receive SELECT only and mutate through authenticated RPCs. Deployed `065_m3` requires current conversation visibility, the live `077` schema adds device-bound heartbeats and orphan recovery, and deployed `080` adds independent per-member state.
- `call_participants` (in deployed `080`): one caller/invitee row per call member with ringing, accepted, declined, missed, left, or failed state; browser roles receive RLS-filtered SELECT only.
- `turn_usage_guard` and `turn_credential_issues` (in live `044`): service-only relay cutoff state and revocable temporary-username metadata; no TURN password or long-lived provider token is stored.

Module 6 (in deployed `024`; the live catalogue remains opt-in in the frontend):

- `places`: shared read-only catalogue; lifecycle state, absence counter, and the pre-demotion state that makes restoration possible. Writes belong to the service-role ingestion pipeline only. `anon` reads a column-restricted, lifecycle-filtered subset (`029`, `030`); `authenticated` reads every column and every lifecycle state, trusting the JS layer to hide Retired/Pending-Enrichment rows.
- `place_interest`: owner-only rows, unique per (user, place, travel date). Aggregated across users by `place_latent_demand()`, which returns counts and never identities.
- `ride_notify_registration`: owner-only; unique per (user, place, travel date) so a repeat request shows the existing registration. Read (in deployed `041_m6`) by a `public.rides` trigger that dispatches through `private.create_user_notification(...)` and flips matched rows to `fulfilled`; a daily Cron job expires past-date rows still `active`.
- `user_travel_preferences`: owner-only stated categories and a dismissal flag.

Module 4 (deployed `034`; deployed `035`, `040`, `067`, `068`, and `079` add no
public table; deployed `039` changes the two classification columns above):

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
- Deployed `072_m1` makes reputation authoritative in database triggers: three evidence Rides are provisional, then publishing requires 65 and requesting 50; a safety hold overrides score. Browser clients receive SELECT-only ledger access and cannot manufacture events. Authored `087_m1` moves that origin to 100 and those gates to 90/75 (D034) without changing the ledger, the +3 per-Ride cap or the provisional window.
- Deployed `073_m1` exposes only the privacy-filtered `get_public_profile(uuid)` projection to `anon`/`authenticated`; owner-private contact data is never selected.
- Messaging mutations are RPC-only; lifecycle, membership, terminal-only personal controls, ownership, Storage metadata, bundle limits, and edit/read races are checked inside locked transactions.
- Authored `079` serializes friendship-pair transitions, rejects self/duplicate/
  unauthorized/inactive-account requests, and lets friend-chat message/media/
  call writes pass only while the relationship is accepted and both profiles
  are active. Removed-friend history remains participant-readable.
- Translation-cache browser access is SELECT-only and follows the same visible-conversation/tombstone boundary; the authenticated Edge Function rechecks access before using its server credential to cache a result.
- Messaging read cursors update only when a newer inbound message exists, preventing no-op `conversation_members` updates from feeding Realtime refresh loops.
- All four messaging tables and `call_sessions` are in the `supabase_realtime` publication. Private call-signal Broadcast topics authorize only the active row's caller and callee.

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
- `reputation_events_user_created_idx` (in deployed `072_m1`)
- `reputation_events_ride_user_idx` (in deployed `072_m1`)
- `conversations_one_direct_per_ride_user_idx`
- `conversations_one_group_per_ride_idx`
- `conversations_one_friend_per_friendship_idx` (in authored `079`)
- `friendships_unique_pair` (in authored `079`)
- `friendships_member_high_status_idx` (in authored `079`)
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
- `039_m4_vehicle_language_filters.sql` - deployed 2026-08-27; nullable validated vehicle categories, validated Host language sets, owner updates, and a safe exact/proximity compatibility-search RPC.
- `040_m4_favourites_advisor_followup.sql` - deployed 2026-08-27; adds the covering `ride_favourites(ride_id)` index requested by the post-034 performance advisor without rewriting deployed migration history.
- `067_m4_favourite_unavailable_notifications.sql` - deployed 2026-08-27; shared in-app/Web Push producer for deduplicated unavailable-favourite transitions and safe similar-search links.
- `068_m4_multi_leg_journey_search.sql` - deployed 2026-08-27; public-safe two-leg fallback over confirmed endpoints, approved catalogue transfers, stored schedules, and existing Module 4 filters.
- `082_m4_confirmed_location_search.sql` - deployed 2026-09-03 as `m4_confirmed_location_search`; anonymously smoke-tested private exact/legacy-null endpoint matching behind safe public direct and multi-leg invoker RPCs, plus Published endpoint indexes.
- `041_m6_ride_available_notification.sql` - deployed and live-verified 2026-08-24; FR-6.33/UC6.12 `public.rides` trigger dispatching through `private.create_user_notification(...)` to matching `ride_notify_registration` rows, plus a daily Cron job expiring past-date active registrations.
- `042_m6_scheduled_ingestion.sql` - deployed and live-verified 2026-08-24; weekly pg_cron + pg_net sweep calling `m6-ingest` with `maxDetails: 0`. Its FR-6.3/6.4/6.5 auto-decay counterpart in the Edge Function was found unsafe and removed the same day - see this file's `042_m6` entry above.
- `043_m3_add_voice_calls.sql` - applied outside tracked migration history on 2026-08-24; one-to-one call-session rows, locked participant RPCs, busy-call serialization, Realtime publication, and caller/callee-only private Broadcast signalling policies. WebRTC audio remains peer-to-peer.
- `044_m3_turn_guard.sql` - applied outside tracked migration history on 2026-08-24; server-only 900 GB usage guard, temporary TURN username audit, atomic hourly issuance limit, and service cleanup for calls over 60 minutes.
- `045_m3_reliable_voice_call_delivery.sql` - deployed as `m3_reliable_voice_call_delivery`; creates one private-triggered, deduplicated, Push-only incoming-call notification per ringing call without widening browser grants.
- `046_m2_adaptive_checkin.sql` - deployed; accuracy-aware passenger check-in
  tolerance and nullable recorded accuracy.
- `047_m2_live_location_tracking.sql` - deployed; private live/latest/history,
  family-share, retention, map-permit, RPC, trigger, and Realtime contracts.
- `048_project_trust_admin_ride_disputes.sql` - deployed; role audit, ride
  dispute lifecycle, evidence access, and evidence holds.
- `049_m2_tracking_advisor_followup.sql` - deployed; private foreign-key
  covering indexes and optimized Realtime auth policies.
- `050_m2_dispute_resolution_notifications.sql` - deployed; safe resolution
  notification and post-closure evidence-hold extension.
- `051_m2_admin_dispute_reassignment.sql` - deployed; Role Admin queue,
  audited Trust Admin reassignment, and service-role-only admin RPCs.
- `052_m2_admin_audit_indexes.sql` - deployed; covering indexes for the
  reassignment audit foreign keys.
- `053_m2_history_user_index.sql` - deployed; user-first location-history
  foreign-key coverage.
- `054_m2_tracking_correctness_fixes.sql` - applied through Dashboard SQL
  Editor but absent from migration history; legacy nullable Check-in accuracy
  compatibility and temporary Role Admin actor forwarding.
- `055_m2_remove_trust_admin.sql` - deployed as `m2_remove_trust_admin`;
  compensating removal
  of the Trust Admin/dispute/evidence rollout while preserving and tightening
  participant/family live tracking and sampled history.
- `056_m2_lifecycle_expiry_and_validation.sql` - authored, not deployed;
  stable acceptance history, exact departure-grace expiry, Matched/request
  invariants, terminal former-participant access, validation alignment, and
  deduplicated expiry notifications.
- `057_m2_fix_family_link_crypto_schema.sql` - deployed as tracked migration;
  schema-qualifies the pgcrypto token generator and digest inside the existing
  authenticated Family Link creation RPC.
- `058_m2_widen_checkin_tolerance.sql` - authored, not deployed; slightly
  widens passenger-only adaptive Check-in distance while retaining the GPS
  accuracy, privacy, historical compatibility, and RPC authorization boundary.
- `059_m2_ride_pickup_destination_photos.sql` - live without a tracked
  migration-history entry; one
  private Host-owned pickup photo per Ride, controlled bind/remove RPC, narrow
  Published pickup context, and a maximum-100 Ride destination Place ID batch
  RPC for attributed on-demand card photography.
- `060_m2_allow_pickup_photo_upload_return.sql` - deployed as tracked migration
  `m2_allow_pickup_photo_upload_return` on 2026-08-26; adds the missing
  owner/path/Ride-scoped `SELECT` policy used when Storage returns metadata for
  a successful Host upload.
- `061_m2_sos_trusted_family.sql` - deployed; private one-time
  trusted-family invitations, one-way relationships, participant/time-guarded
  SOS RPCs, retained-last-point signal monitoring, shared notifications, and
  24-hour coordinate-free resolved-event cleanup.
- `062_m2_sos_advisor_followup.sql` - deployed; covers the invite owner,
  claimed recipient, and SOS actor foreign keys reported after `061`.
- `063_m2_expired_passenger_destination_photos.sql` - authored, not deployed;
  extends the destination-photo Place ID batch RPC to the same Expired,
  previously accepted passenger boundary used by terminal Ride Detail.
- `064_m2_republish_terminal_ride_as_draft.sql` - deployed as tracked migration;
  lets only the authenticated Host copy a Completed, Cancelled, or Expired
  Ride's editable settings into a new Draft ID without copying requests,
  lifecycle/route-quote state, live data, conversations, reviews, or photos.
- `065_m3_terminal_chat_and_call_history.sql` - deployed as
  `m3_terminal_chat_and_call_history`;
  expands per-user direct archive and traveller-only group leave to Completed,
  Cancelled, and Expired rides, preserves the Host group restriction and one
  Realtime system message, and tightens call-history SELECT with current
  conversation visibility.
- `075_m3_conversation_lifecycle_redesign.sql` - authored, not deployed;
  keeps conversations Ride-bound, adds terminal-only archive/unarchive,
  delete-for-me, mute/unmute for direct and group conversations, suppresses only
  muted message notifications, removes manual group leave, retains a requester
  who cancels an Accepted request as a read-only former member for seven days,
  and applies the earliest personal or Ride-terminal expiry through RLS.
- `077_m3_voice_call_presence_recovery.sql` - authored, not deployed; adds
  caller-device ownership, participant heartbeat timestamps, 90-second orphan
  expiry, same-device refresh recovery, and compatible one-/two-argument call
  start RPCs without granting browser roles direct call-session mutations.
- `078_m1_conduct_outcome_and_hold_reversal.sql` - deployed, confirmed live
  2026-09-16 (`private.clear_reputation_hold` exists; `apply_conduct_outcome`
  itself now carries `104_m1`'s superseding body - see that entry);
  adds `private.apply_conduct_outcome` and `private.clear_reputation_hold`,
  service-role-only functions (no grant to `anon`/`authenticated`) that make
  `confirmed_minor_conduct`/`confirmed_serious_conduct` events and
  `reputation_hold` reachable for the first time since `072_m1` defined them,
  without a client-facing admin surface.
- `104_m1_graduated_conduct_severity.sql` - deployed, confirmed live
  2026-09-16 (`private.apply_conduct_outcome`'s live body carries the full
  four-tier escalation logic below, not `078_m1`'s original two-tier
  version); widens
  `reputation_events_event_type_check` with two new tiers
  (`confirmed_moderate_conduct` -14, `confirmed_severe_conduct` -30) between
  and above `078_m1`'s original two, and replaces (`create or replace`, same
  signature) `private.apply_conduct_outcome` so it escalates a repeat
  offender itself: 3rd confirmed Minor in 90 days -> Moderate; 2nd confirmed
  Moderate in 180 days -> Major; 2nd confirmed Major ever -> Severe. Major and
  Severe always set `reputation_hold`; the escalated (not requested) type is
  what gets written to the ledger, with the original request kept in
  `metadata.requestedType`. `078_m1`'s file and grants are untouched.
  `ReputationPolicy.js`'s `CONDUCT_SEVERITY_TIERS`/`resolveConductSeverity`
  mirror this for client-side preview only; the SQL function is authoritative.
- `105_m1_identity_overdue_penalty.sql` - deployed, confirmed live
  2026-09-16 (`public.admin_apply_identity_overdue_penalty` exists); the one
  deliberate, manual exception to "identity documents do not affect
  reputation" (`072_m1`, `087_m1`). Widens
  `reputation_events_event_type_check` with `identity_verification_overdue`
  (-5, no hold) and adds two admin-gated functions:
  `public.admin_list_unverified_members()` (every active member with zero
  `identity_verifications` row at all - a pending/rejected row already
  belongs on the existing admin tabs and is excluded - oldest signup first)
  and `public.admin_apply_identity_overdue_penalty(p_user_id, p_reason)`
  (day-scoped `source_event_id` so a double click cannot double the
  deduction). No cron/worker involved - this stays a manual reviewer action,
  same allowlist as `097_m1`. `AdminIdentityReview.jsx`'s "Not verified" tab
  and `IdentityVerificationService.adminListUnverifiedMembers`/
  `adminApplyOverduePenalty` are the client side; now that this is deployed,
  the `isUndeployedIdentityContract` empty-list fallback in those methods is
  dead code for this RPC specifically (it still applies to any other
  genuinely undeployed identity contract) rather than a currently-exercised
  path.
- `106_m1_admin_conduct_review.sql` - deployed by the user outside this
  repo's own migration tooling (exact deployment mechanism/date not recorded
  here); the reviewer surface `104_m1`'s header flagged as missing. Same
  admin allowlist as `097_m1`/`104_m1`/`105_m1`. Adds
  `public.admin_get_reputation_summary` (Safety-sourced conduct history only,
  not the full ride ledger), `public.admin_apply_conduct_outcome` (requires a
  non-empty reason, generates its own per-call `source_event_id` so same-day
  confirmations never collapse), and `public.admin_clear_reputation_hold` -
  all narrow wrappers around `078_m1`/`104_m1`'s existing service-role-only
  functions, none of which are widened. `private.apply_conduct_outcome`/
  `private.clear_reputation_hold` (`078_m1`, superseded by `104_m1`) are
  confirmed live, so Confirm a Trust Case / Clear hold both have a real
  function to call.
  `AdminConductReview.jsx` (`/admin/conduct`) is the client side: see a
  member's score/standing/prior confirmed-conduct history and confirm a
  graduated Trust Case. Originally had no Safety Report intake or case
  queue - `107_m1` below adds that, and by user decision (2026-09-14) the
  page's manual "paste a user ID" lookup was then removed entirely, since a
  raw Supabase UUID has no easy source for a reviewer to copy from; the case
  queue is now the only way into this page.
- `107_m1_safety_report_queue.sql` - deployed by the user (2026-09-14)
  outside this repo's own migration tooling; adds the self-service slice of
  the case queue `106_m1` explicitly left out, by user decision (not the
  full cross-module M2/M3/M5 evidence intake the Conduct Severity Rulebook's
  scoping note describes - that remains separate, larger work). New table
  `public.safety_reports` (reporter/reported member, reason, optional Ride
  ID, open/resolved/dismissed status, resolution metadata); owner and admin
  RLS SELECT policies, no other browser table grant. Adds
  `public.submit_safety_report` (any signed-in member, self-report and empty
  reason rejected, one open report per reporter/reported pair via a partial
  unique index), and admin-gated `public.admin_list_safety_reports` (`open`
  sorts oldest first, queue order; other filters sort newest first) and
  `public.admin_resolve_safety_report` (marks a still-open report resolved or
  dismissed; never edits the report's own contents). Resolving a report is
  intentionally decoupled from confirming a Trust Case - a report can be
  dismissed with no conduct outcome, and one confirmed case might close
  several open reports about the same member at once. Client side:
  `PublicProfile.jsx` gets a "Report this member" action (any signed-in
  viewer, not the profile owner); `AdminConductReview.jsx` gets a Case queue
  card whose Review button loads that member directly. **Live bug found
  immediately after this file was deployed** - `admin_list_safety_reports`'s
  ORDER BY referenced the pre-alias column name (`r.created_at` instead of
  `r."createdAt"`), erroring `column r.created_at does not exist` every time
  the queue loaded. Fixed by `108_m1` below; `107_m1` itself is not rewritten
  since it is already deployed history.
- `108_m1_fix_safety_report_queue_order_by.sql` - deployed, confirmed live
  2026-09-16 (`admin_list_safety_reports`'s live body orders by
  `r."createdAt"`, the post-alias fix, not the original bug); supersedes only
  `admin_list_safety_reports`'s body (same
  signature, same admin gate, same status-filter validation) to fix the bug
  above. `submit_safety_report` and `admin_resolve_safety_report` have no
  equivalent alias mismatch and are untouched.
- `094_m1_identity_holds_the_licence.sql` - partially reflected live without a
  tracked migration entry; adds
  `ic_number` and `license_expiry` to `identity_verifications` so the MyKad is
  entered once instead of on every vehicle and folds the expiry
  check into `private.enforce_ride_identity_verification`. A submission with no
  expiry recorded is treated as valid, not lapsed.
  `vehicles.driver_license_number`/`driver_license_expiry` are deliberately
  left in place and unused. Although this file also drops the `088_m1`
  `enforce_ride_driver_license_before_publish` trigger, a 2026-09-17 live check
  found that trigger attached again; `113_m1` records the narrow repair.
- `095_m1_grant_table_level_identity_verifications_update.sql` - live without a
  tracked migration entry; `094_m1` only granted a column-restricted UPDATE, which Postgres
  refuses for the `INSERT ... ON CONFLICT DO UPDATE` supabase-js's `.upsert()`
  emits (`42501 permission denied`) - the same trap `071_project` hit on
  `profile_visibility`. Grants the plain table-level UPDATE that shape needs;
  RLS still does the real gatekeeping.
- `096_m1_unique_ic_number.sql` - live without a tracked migration entry; a partial unique
  index on `identity_verifications.ic_number` (`where ic_number is not null`)
  so a rejected or reputation-damaged member cannot sign up again under a new
  email and resubmit the same MyKad. Partial rather than a bare constraint so
  legacy rows with no stored number (pre-`094_m1`) never collide on null. A
  member's own resubmission keeps their existing row via `093_m1`'s
  `onConflict: 'user_id'` upsert, so this only ever blocks a second account.
- `097_m1_admin_identity_review.sql` - live without a tracked migration entry; adds a single
  email-allowlisted admin path for the review surface `093_m1` deliberately
  left service-role-only. `private.is_identity_review_admin()` checks
  `auth.email()` against a hardcoded array (currently seven team emails) -
  deliberately not a roles table, given
  `055_m2_remove_trust_admin` already removed one general admin-role system.
  Adds permissive RLS SELECT policies on `identity_verifications` and the
  `identity-documents` bucket's storage objects for that allowlist (additive to
  the existing owner-only policies), and
  `public.admin_review_identity_verification(uuid, text, text)`, an
  authenticated-grantable wrapper that re-checks the allowlist before calling
  `private.review_identity_verification`, which itself keeps zero grants to
  `anon`/`authenticated`. Depends on `093_m1` (table/bucket) being deployed
  first.
- `099_m1_restore_identity_insert_privileges.sql` - deployed and live-verified
  on 2026-09-06 as tracked migration `m1_restore_identity_insert_privileges`
  (`20260906065405`). The live ACL had drifted back to `093_m1`'s original
  three-column INSERT grant, so the submission upsert was rejected before RLS
  when it included `ic_number` and `license_expiry`. `099_m1` restores only
  those two column privileges. Live verification confirms both are granted,
  broad table INSERT remains false for `authenticated` and `anon`, RLS remains
  enabled, and the owner INSERT/UPDATE policies remain present.
- `098_m1_badge_tier_change_notification.sql` - deployed, confirmed live
  2026-09-16 (`host_impact_stats.last_badge_tier` column, the
  `notify_badge_tier_change` trigger, and `private.badge_tier_rank()` all
  exist); this file previously had no entry in this document at all (gap
  found 2026-09-16 while auditing the Host Impact badge system). Adds
  `last_badge_tier` to `host_impact_stats` and a `before insert or update`
  trigger (`notify_badge_tier_change`) that recomputes a host's badge tier via
  `private.badge_tier_for_stats()` on every write and notifies on an actual
  tier transition. Its own header says the function mirrors
  `HostImpactEngine.js`'s formula and `REPUTATION_POLICY.hostMinimum` exactly,
  but hard-coded the withholding threshold at 65 - stale even at authoring
  time, since `087_m1` (an earlier migration number, already in force) had
  already raised `hostMinimum` to 90. Not rewritten itself (prior history);
  `110_m1` below supersedes only the threshold, and its corrected `< 90`
  comparison is confirmed present in `badge_tier_for_stats`'s live body - the
  drift this entry originally flagged was a real live bug until `110_m1`
  shipped, not a dormant one.
- `109_m1_host_impact_trip_completion.sql` - deployed, confirmed live
  2026-09-16 (`private.ride_carbon_saved_kg()` exists); fixes the
  main gap found in that same audit. `host_impact_stats.completed_trips` and
  `co2_saved_kg` were never written by any ride-completion code path -
  `private.record_reputation_event` (072_m1) only ever touches
  `reputation_score`, and `074_m1`'s `private.reputation_from_ride_status`
  (the trigger that fires when a ride reaches Completed) records a
  `ride_completed` reputation event and stops there. Every account's
  `HostImpactEngine.js` composite score was therefore permanently 0 (Bronze),
  and the Module 5 leaderboard (which filters `completed_trips > 0`) was
  permanently empty, independent of the "no Completed rides yet" data-gap
  already noted in `docs/ai/DECISIONS.md`. Adds
  `private.ride_carbon_saved_kg()` - mirroring
  `src/business-logic/m5-trips/TripHistoryEngine.js`'s `estimateCarbonSavedKg()`
  exactly (same 18/340 km `AVG_DISTANCE_KM` fallback, same 0.12 kg/passenger-km
  factor, itself still an unratified estimate per `docs/ai/modules/
  M5_TRIP_ECO.md`) rather than a new formula - and supersedes
  `private.reputation_from_ride_status()` (same trigger, not a second one) to
  increment both counters for the host and each checked-in traveller,
  guarded on `record_reputation_event`'s own return value so a ride's
  `Completed` transition can never double-count.
- `110_m1_fix_badge_notification_threshold_drift.sql` - deployed, confirmed
  live 2026-09-16 (`badge_tier_for_stats`'s live body compares against 90,
  not 65); supersedes only `private.badge_tier_for_stats()`'s body (same
  signature, same grant) to replace the stale `< 65` with `< 90`, matching
  `087_m1`'s current `REPUTATION_POLICY.hostMinimum`. `098_m1` itself is left
  as authored history.
- `093_m1_identity_document_verification.sql` - live without a tracked migration
  entry;
  moves identity verification from sign-up to the point of use (D035). Adds the
  PRIVATE `identity-documents` bucket with owner-folder Storage policies and no
  anon policy, `public.identity_verifications` (owner may only ever insert or
  return its own row to `pending`), the
  `enforce_ride_identity_before_publish` trigger requiring a non-rejected
  submission before a Ride reaches `Published`, and service-role-only
  `private.review_identity_verification`. It also restores
  `handle_new_user()` to a body that does not write `ic_checked_at` and then
  drops that column, retiring the `088_m1` sign-up flag - the restore must stay
  ahead of the drop or account creation breaks.
- `087_m1_reputation_starts_at_ceiling.sql` - deployed, confirmed live
  2026-09-16 (`host_impact_stats.reputation_score`'s column default is 100,
  not 70); moves the reputation origin from 70 to 100, rebases live scores by +30
  clamped at 100 (guarded by the current column default, so re-running is a
  no-op), and raises the publish/request gates to 90/75 in
  `private.enforce_ride_reputation_eligibility`,
  `private.enforce_request_reputation_eligibility`,
  `public.get_reputation_summary` and `public.get_ride_eligibility`. It
  replaces constants only: the `072_m1` ledger, per-event clamp, +3 per-Ride
  positive cap, event deltas and three-Ride provisional window are untouched.
- `088_m1_identity_gate_hardening.sql` - not deployed as one tracked migration;
  its `profile_private.ic_checked_at` column is absent live, but a 2026-09-17
  inspection found its legacy `enforce_ride_driver_license_before_publish`
  trigger attached to `public.rides`. The file adds
  `profile_private.ic_checked_at` (written only by `handle_new_user()` from
  the sign-up payload, with no insert/update grant to browser roles, and never
  storing the IC number itself) and `vehicles.driver_license_expiry`, plus the
  `enforce_ride_driver_license_before_publish` trigger that requires a present
  and unexpired licence on the selected vehicle before a Ride reaches
  `Published`. A vehicle registered before this file has a null expiry, which
  is treated as unknown rather than expired so no existing Host is locked out.
  Deliberately no document photos, no Storage bucket, and no verified badge.
- `079_m3_friendships_and_persistent_chat.sql` - deployed;
  adds mutually confirmed account-pair friendships, authenticated RPC-only
  transitions, one separate permanent direct conversation per friendship,
  friend-member profile relevance, accepted/active-account message and call
  gates, read-only retained history after removal, Realtime publication, and
  deduplicated request/acceptance notifications. It depends on authored `075`
  and `077` and does not alter existing Ride chat identities or seven-day rules.
- `20260905093400_m3_friend_ride_invitations` - deployed 2026-09-05;
  adds Friend-chat Ride cards, Host or Pending/Accepted passenger sharing,
  recipient eligibility rechecks, live Ride-state reads, deletion cleanup, and
  deduplicated invitation notifications without changing seat/request state.
- `080_m3_group_voice_calls.sql` - deployed 2026-09-03 as tracked migration
  `m3_group_voice_calls`; adds direct/group
  call types, per-member invitations and lifecycle state, independent
  answer/reject/leave behavior, max-eight peer-mesh rooms, per-invitee push
  notifications, participant-scoped TURN authorization, and participant-table
  Realtime publication. It depends on authored `075`, `077`, and `079`.
- `081_m3_selective_group_voice_calls.sql` - deployed 2026-09-03 as tracked
  migration `m3_selective_group_voice_calls`; adds a separately named RPC that
  validates and rings only the active group members selected by the caller,
  while preserving the existing direct-call RPC.
- `066_m2_fix_pickup_photo_storage_path_policy.sql` - deployed as tracked
  migration `m2_fix_pickup_photo_storage_path_policy`; corrects the pickup
  photo Storage policies to treat `user-id/ride-id/filename` as two folders,
  matching `storage.foldername(name)` and the client upload path.
- `072_m1_reputation_events_and_eligibility.sql` - deployed through the
  Dashboard SQL Editor; verified-event Reputation ledger, balanced deltas,
  per-Ride positive cap, provisional access, safety hold, owner summary RPC,
  and authoritative Driver-publish/Traveller-request thresholds.
- `074_m1_fix_ride_reputation_status_trigger.sql` - deployed as tracked
  migration `m1_fix_ride_reputation_status_trigger`; repairs the Ride-status
  Reputation trigger to use `rides.recruitment_closed_at` and removes invalid
  references to the request-only `cancelled_at`/`cancelled_by` fields, restoring
  recruitment close and other Ride status transitions.
- `073_m1_public_profile_visibility.sql` - deployed through the Dashboard
  SQL Editor; owner visibility switches, safe shortened-name public-profile
  RPC, raw profile-row narrowing, and explicit exclusion of private contact
  and Ride data. **Do not re-run this file**: it revokes execute on
  `private.profile_is_relevant_to_viewer` from `anon, authenticated`, which
  undoes `069`'s fix every time and breaks every `profiles` read (Google
  login included) until `069` is run again. Use `070` for a
  `profile_visibility` table-grant gap instead.
- `069_project_restore_private_schema_grants.sql` - deployed through the
  Dashboard SQL Editor; restores `usage on schema private` to
  `anon, authenticated` after `072_m1` reset it without re-granting, and
  restores `execute` on `private.profile_is_relevant_to_viewer` that
  `073_m1` revoked from the same roles its own `profiles` RLS policies call
  it for. Must be re-run any time `073_m1` is (accidentally) re-run.
- `070_project_reassert_profile_visibility_table_grants.sql` - deployed
  through the Dashboard SQL Editor; re-applies `profile_visibility`'s
  table-level `select`/`insert`/`update` grants in isolation from `073_m1`,
  so a grant gap on that table can be fixed without re-running `073_m1` and
  re-breaking `069_project`'s fix. Safe to run in any order relative to
  `069`. Its column-restricted `update` grant is not accepted by
  `.upsert()`'s `ON CONFLICT DO UPDATE`; see `071_project`.
- `071_project_grant_table_level_profile_visibility_update.sql` - authored,
  not deployed; grants a plain, unrestricted `update` on
  `public.profile_visibility` to `authenticated`, which the exact PostgREST
  `42501` error and its own hint confirmed is what `.upsert()`'s
  `ON CONFLICT DO UPDATE` actually requires, not the column-restricted
  grant `073_m1`/`070_project` applied.
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

## Individual chat deletion (2026-09-05)

- Deployed `089_m3_personal_message_deletion.sql` (`m3_personal_message_deletion`): owner-readable, RPC-written `chat_item_deletions`, account-local message visibility, Realtime refreshes, and the security-invoker `chat_call_history` view. Call signalling continues to read `call_sessions`.
- Deployed `090_m3_delete_all_message_types.sql` (`m3_delete_all_message_types`): shared deletion accepts text, media, location, voice and Ride invitations; requires the sender, writable/visible conversation, and no other member read cursor at or beyond the message. Member locks serialize the read check. Shared media/invitation payloads are removed atomically; messages retain tombstones.
- `database/tests/m3_personal_deletion.sql` verifies real authenticated-role isolation and deletion gates inside a fully rolled-back transaction on a seeded database.

## Ride invitation label rollback (2026-09-05)

- Deployed `091_m3_ride_invitation_viewer_role.sql`, then immediately superseded it with deployed `092_m3_restore_ride_invitation_card_contract.sql` at the user's request. The live `get_friend_ride_invitation_cards` response contract and client label behaviour are restored to their pre-091 state; both files remain in history because deployed migrations are immutable.

## Message reports — deployed 2026-09-16

`109_m3_message_reports.sql` is live as `20260916041406_m3_message_reports`; `110_m3_message_report_cleanup_indexes.sql` is live as `20260916042030_m3_message_report_cleanup_indexes`. This extends the existing `safety_reports` queue with versioned message evidence, private media copies, atomic admin decisions/removal and existing reputation outcomes. Profile reports retain their existing path. The private `message-report-evidence` bucket and `m3-message-reports` Edge Function are live; the hourly Vault-authenticated cleanup successfully returned HTTP 200. Closed evidence expires after 90 days; open evidence is retained. Frontend release and signed-in live media acceptance remain outstanding. See `docs/M3-MESSAGE-REPORTS.md`.

Deployed `111_m3_fix_message_report_admin_queue.sql` (`20260916113610_fix_message_report_admin_queue`) restores the queue's `messageEvidenceId` projection after the live legacy M1 function omitted it, which had made message cases render as profile reports and trigger the evidence-resolution guard. The business layer also accepts the raw `message_evidence_id` name defensively. Post-deployment inspection confirmed both remaining open message reports now project non-null evidence IDs.

Deployed `112_project_safety_report_notifications.sql` as `20260916120535_safety_report_notifications`. It connects profile and message safety decisions to the existing project notification inbox. Reporters receive a privacy-safe action-taken or no-violation result; reported members are notified only for warnings or confirmed conduct, including the applied reputation deduction. Dismissed reports never notify the reported member, and dedupe keys prevent repeat admin requests from creating duplicate notices.


## Module 2 moderation (deployed 2026-09-17)

- `114_m2_content_moderation.sql`: deployed as
  `20260917091148_m2_content_moderation_v4`; service-only content receipts and immutable
  approved-photo metadata, browser Storage write restrictions, deferred final-row
  approval guard, atomic `persist_moderated_ride` wrapper, Draft photo binding,
  per-Host hourly quota and abandoned-photo cleanup claims. Preserves existing
  route persister and lifecycle-only transitions. No historical bulk scan.
- `115_m2_content_cleanup_schedule.sql`: deployed as
  `20260917101615_m2_content_cleanup_schedule`. Its active `m2-content-cleanup`
  Cron job runs at minute 15 of every hour and reads the function URL and
  dedicated bearer secret from Vault. A post-deployment invocation returned
  HTTP 200 with no timeout or error and removed zero stale photos.
- `116_m2_raise_content_check_hourly_limit.sql`: deployed as
  `20260917102438_m2_raise_content_check_hourly_limit`. It raises the existing
  per-Host hourly moderation request limit from 20 to 40 because one complete
  attempt can consume separate photo and combined-text checks. The service-only
  execution grants and fail-closed error remain unchanged.
- The v4 120-case Cloudflare evaluation passed. The matching content/route Edge
  Functions and Netlify frontend are live and text/photo moderation is enabled.
  Post-deployment privilege checks confirmed the receipt tables and moderated
  persister remain service-only. See `docs/ai/M2_CONTENT_MODERATION_RELEASE.md`.

## Module 4 confirmed-destination radius search (deployed 2026-09-18)

- `117_m4_confirmed_destination_radius_search.sql` makes the existing 5/10/25 km
  controls available for an ordinary Google-confirmed destination as well as a
  catalogue recommendation. It compares the transient passenger-selected centre
  with `private.m2_ride_verification` destination anchors inside private
  security-definer helpers and exposes only narrow security-invoker wrappers.
- The public direct and multi-leg projections return the existing safe fields
  plus rounded distance. Coordinates, Ride endpoint IDs, pickup instructions,
  waypoints, and route geometry do not cross the RPC boundary.
- The migration is deployed as
  `20260917161659_m4_confirmed_destination_radius_search`. Anonymous REST smoke
  tests returned HTTP 200 for both direct radius search and multi-leg fallback;
  the direct check returned matching rides while the deliberately unmatched
  multi-leg route returned a safe empty result. Security and performance
  advisors reported no new Module 4 finding.
