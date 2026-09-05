# DECISIONS.md

## Path Convention

All paths are relative to the `carshare-pwa/` application root unless explicitly stated otherwise.

This file records important project decisions only.

Do not use it for trivial implementation choices.

---

## Status
- **Proposed** — under discussion.
- **Accepted** — current project direction.
- **Superseded** — replaced by a newer accepted decision.
- **Rejected** — explicitly considered but not selected.

## D001 — Mobile-First PWA
**Status:** Accepted
Let's Tumpang is developed as a Progressive Web Application.

## D002 — Supabase as the Real Backend Baseline
**Status:** Accepted
Supabase is the current backend/data platform direction. Mock/local data may support prototype/demo behaviour but is not the final shared multi-user backend.

## D003 — Google Maps Platform Replaces Earlier OSM Direction
**Status:** Accepted
Google Maps Platform is the current mapping direction. Earlier Leaflet/OpenStreetMap/OSRM assumptions are outdated unless independently re-accepted.

## D004 — Proposal/Module Docs Are Requirement References, Not Frozen Implementations
**Status:** Accepted
Academic intent must be preserved, but implementation details should be validated against current code and current decisions.

## D005 — Shared Core + Per-Module AI Context
**Status:** Accepted

Keep agent entry files at application root:

```text
AGENTS.md
CLAUDE.md
```

Keep shared AI context in:

```text
docs/ai/
```

Keep per-module context in:

```text
docs/ai/modules/
```

Agents should load only relevant context.


## D006 — Karpathy 4 Rules
**Status:** Accepted
Use Think Before Coding, Simplicity First, Surgical Changes, Goal-Driven Execution.

## D007 — Preserve Existing Top-Level Source Layering for Now
**Status:** Accepted
Keep `src/presentation/`, `src/business-logic/`, `src/data-access/`, and `src/context/` unless a concrete accepted need justifies a structural refactor.

## D008 — `Development` Is the Shared Integration Branch
**Status:** Accepted
Use `Development` for integration and `main` for stable/demo-ready code. Do not assume lowercase `development` or `dev` examples match the real repo.

## D009 — AI Context Paths Are Application-Root Relative
**Status:** Accepted

All paths written in AI context documents are interpreted relative to:

```text
carshare-pwa/
```

unless explicitly stated otherwise.

**Why**
This avoids fragile `../` and `../../` references when context files are moved within `docs/ai/`.

---

## D010 — Module 1 and Module 2 Initial Supabase Schema
**Status:** Accepted
`database/sql/001-015` is the deployed history for Module 1 and Module 2. The
original `001-007` drafts are kept as history; `008-012` harden the first slice,
and `013-015` add the accepted ride/request/lifecycle/review model.

## D011 — Supabase Scope and Authentication
**Status:** Superseded by D015 (Google OAuth only; the rest of this decision stands)
The shared project is `pnetstmovctfwqcumodx`. Frontend configuration uses
`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`; the old anon-key name
is compatibility-only. This slice uses email/password with email verification.
Phone OTP and account hard deletion are deferred. Google OAuth is accepted by
D015. Module 3 uses Supabase Database, Realtime, and private Storage under D016;
Modules 4-6 retain local adapters.

## D012 — Module 2 Lifecycle and Participation Contract
**Status:** Superseded by D025
`departure_at` is the authoritative UTC ride instant and the application displays
it in `Asia/Kuala_Lumpur`. A request can include its account holder plus named
companions; only the account holder participates in access and reviews. Pending
requests do not reserve seats, acceptance is all-or-nothing and transactional,
and new requests stop five hours before departure. Module 2 owns lifecycle state
through `Matched`; only a trusted service-role Module 6 pipeline may move a ride
to `In Transit` or `Completed`. Reviews are mutual between the Host and each
accepted account holder and update only the public average star rating.

## D013 — Quota-Controlled Google Maps Location Integration
**Status:** Accepted
Maps Embed API remains the route-preview boundary and keeps a dedicated key.
Publish Ride uses a second website-restricted key for Maps JavaScript API,
Places API (New), and Geocoding API only. New Ride endpoints must be selected
from Malaysia-only Autocomplete predictions. Publish Ride first verifies that
the Host has a registered vehicle; an empty vehicle list blocks the flow before
location permission is requested. Eligible Hosts receive one automatic browser
location request on entry to centre the Embed preview. That coordinate is not a
pickup until accuracy is at most 100 metres, reverse geocoding succeeds, and the
driver confirms it. Place IDs are the canonical Google references; device coordinates
are persisted only for confirmed current-location pickups. Autocomplete and
Geocoding each require a 250-request daily hard quota before production enablement,
plus quota and billing alerts. Alerts alone are not an accepted spending stop.
Routes, distance/time, and traffic remain outside this original phase. The
Module 2 live-tracking slice now enables one Dynamic Maps instance per
Trip Mode page, with a `VITE_GOOGLE_MAP_ID`, Advanced Markers, accuracy circles,
an application soft gate of 250 authenticated map permits per Malaysia day,
and location-card/Open-in-Google-Maps fallback when the permit or map fails.
The Embed route preview remains separate. Google Cloud billing alerts and
provider quotas remain mandatory operational controls.

## D014 — Shared Mobile-First UI Contract
**Status:** Accepted
`docs/ai/UI.md` is the shared cross-module UI/UX contract. Phone is the primary
design target; tablet and desktop use intentional responsive reflow rather than
stretched phone layouts. `src/presentation/styles/theme.css` remains the runtime
source of truth for exact implemented token values. Files under `docs/figma/`
are design references and do not silently override accepted decisions, this
contract, or verified current implementation.

## D015 — Google OAuth Added to the Login Workflow
**Status:** Accepted
`AuthPage.jsx` offers "Continue with Google" alongside email/password, for
both Sign Up and Login (one Supabase call covers both: `signInWithOAuth`
creates the `auth.users` row on first arrival and just signs the user in on
every visit after). No new SQL migration was needed: `handle_new_user()`
(`008_m1_secure_profiles_and_auth.sql`) already tolerates Google's
`raw_user_meta_data` shape (`full_name`/`name`/`avatar_url`/`picture`
fallbacks). Enabling this end-to-end still needs a one-time, code-independent
Dashboard step - a Google Cloud OAuth Client ID/Secret registered against the
Supabase provider and matching Redirect URLs - tracked in
`docs/SUPABASE-SETUP.md` and `docs/ai/TODO.md`.

## D016 — Module 3 Supabase Messaging and Retention Contract
**Status:** Accepted
Published rides allow any signed-in non-Host to create/reuse one ride-bound
direct chat without a ride request. The first Accepted request creates the one
ride group transactionally; every accepted account holder joins and companions
do not. A message is one atomic text/media/location bundle with up to ten mixed
photos/videos and one coordinate pair. Sender-only edits are allowed only before
another member reads the message; sender-only deletion always tombstones the
whole bundle. Archive, unarchive, delete-for-me, mute, and unmute are personal
controls available to both direct and group conversations only after the Ride is
Completed, Cancelled, or Expired. Archive is a reversible folder state; deletion
hides only the member's existing history, and muting suppresses message alerts
without suppressing delivery or unread state. A requester who cancels an Accepted
request immediately leaves the group but retains read-only access to messages sent
before cancellation for at most seven days. Manual group leave is removed.
Completed, Cancelled, and Expired conversation access ends permanently seven days after the terminal timestamp,
overriding UC3.8's older permanent archive wording. Translation/UC3.6 is an
explicit, on-demand four-language action for English, Simplified Chinese,
Bahasa Melayu, and Tamil. An authenticated Supabase Edge Function resolves the
message source server-side, uses Cloudflare Workers AI's free-plan models for
translation and voice transcription, and writes a shared source-versioned cache
that members can read only while the conversation remains visible. Cloudflare
secrets never enter the browser. Translated speech is optional and user-triggered
through the device's Web Speech voice; no generated audio is stored. When the
shared free allowance is exhausted, translation stops with a retry-after-reset
message and never selects a paid fallback. Message notifications are delivered
through the shared centre defined in D020.

## D017 — Public-First Browsing and Action-Time Authentication
**Status:** Accepted
The application opens on public `/home` instead of forcing authentication.
Guests may browse Home, Search results, and Published Ride Detail. `/search` is
the sole public ride-listing surface. Login is required when entering
account-specific services, including the `/ride` management workspace, Message,
Favourite, Profile, Publish Ride, ride requests, reviews, trips, and safety
flows. Protected navigation and Ride actions use the shared `/auth` page with a
safe internal return destination. Once its exact public payload is explicitly
approved and deployed, Supabase `anon` access is read-only and limited by RLS
and column grants to Published rides from active Hosts and the safe public Host
profile/impact data required to render them; private profile, vehicle, request,
review, and messaging data remains unavailable. Public Search and Ride Detail
reads exclude Place IDs, precise coordinates, and pickup instructions.

Destination Discovery (`/discover`, D018) is part of that public browsing
surface: a visitor who cannot yet name a destination is exactly who it serves,
and it scores an anonymous request with a neutral personal-affinity value rather
than requiring an account.

## D018 — Module 6 Becomes Destination Discovery, With a Google Places Catalogue
**Status:** Accepted
Module 6's Trust & Safety scope was redistributed with tutor approval: trip
verification and dispute settlement to Module 2, hazard reporting and the Panic
Button to Module 3, Trust Cases and appeals to Module 1, overdue monitoring to
Module 5. The existing prototype code stays in place under its new owners
(`docs/ai/modules/TRUST_SAFETY_HANDOVER.md`). Module 6 is now Destination
Discovery (`docs/ai/modules/M6_DESTINATION_DISCOVERY.md`).

The place catalogue is sourced from Google Places API rather than an open dataset,
which extends the D013 cost boundary. Newly in scope: Nearby/Text Search, Place
Details, and Place Photos, plus Street View metadata (unlimited and free) with
Static Street View only where metadata confirms coverage. Each carries a 1,000
per month free cap except Street View Static at 10,000; ingestion is bounded by
its own per-cycle request quota that halts and resumes rather than overrunning.
Photos are the only continuing cost because references rather than image bytes
are stored, so every view spends a request.

Ingestion is a server-side scheduled process, so it needs a key that is **not**
website-restricted and must never carry a `VITE_` prefix. The two existing D013
browser keys cannot be reused for it.

**Accepted risk:** the Maps Platform terms permit indefinite storage of place IDs
only, while this module caches rating, review count, description and photo
references because FR-6.11 forbids enrichment at request time and the scoring
formula consumes those fields on every pass. The team accepted this for an
academic prototype; it is recorded as a limitation rather than left unstated.
Weather integration also moves here from Module 5, which never carried a weather
requirement in the report.

## D019 — FR-6.35 Destination Prefill Contract
**Status:** Accepted; amended 2026-08-20

Module 6 produces shareable URL prefill links through
`DestinationDiscoveryService.buildPrefillUrl()`. Module 4 consumes
`/search?pickup&destination&date&destinationPlaceId&proximityKm=10`; Module 2 consumes
`/ride/publish?destination&date`. Query strings are intentional so the handoff
survives reloads and bookmarks. `destinationPlaceId` is an opaque Module 6
catalogue/source hint for private confirmed-destination correlation only: a
fixture key is never a confirmed Ride location and is never persisted to a Ride
by Search. Supported radii are 5/10/25 km; missing or invalid radii with a valid
hint default to 10 km, while manual destination edits return to exact text mode.
Module 2 remains responsible for confirmed-location validation. Legacy `/ride?from&to&date`
search links are translated to Module 4's canonical `/search` parameters. The
complete contract is `docs/ai/FR-6.35_PREFILL_CONTRACT.md`.

## D020 — Shared Notification Centre and Native Web Push
**Status:** Accepted

`user_notifications` is the application-wide recipient inbox. Every producer
uses the trusted database helper with a source module, event type, safe internal
path, payload, and stable dedupe key; only the shared notification provider owns
the unread count, Realtime subscription, read state, bell, and `/notifications`
route. Message is the first producer and creates one notification for each
other current conversation member. Text bodies are shown in the notification;
attachment-only messages use a type summary.

Device alerts use standard Web Push (VAPID) with the browser's service worker.
The browser obtains permission only from an explicit user action. Browser code
has the public application-server key only; the VAPID private key, service-role
credentials, and Database Webhook secret remain in Supabase Edge Function
secrets. Database webhook delivery is asynchronous and may be retried, so the
inbox is the source of truth and the push payload is a convenience alert. The
inbox retains 30 days and loads its newest 50 items by default.

## D021 — Module 4 Compatibility Classifications Are Optional and Public-Safe
**Status:** Accepted and deployed 2026-08-27

Vehicle category belongs to each Module 1 vehicle; spoken languages belong to
the Host profile and therefore apply to all that Host's rides. A traveller may
select at most one category and one preferred language. Existing rows are not
backfilled or guessed: unclassified rides remain in Any results but cannot
match a specific compatibility choice until their owner updates them.

The allowed values are stable, validated sets shared by owner-editing UI,
mock persistence, URL normalization, and migration `039`. Module 4's safe card
projection may expose only `vehicle_type` and `spoken_languages` in addition to
its existing public fields. Vehicle make, model, plate, Ride Place IDs,
coordinates, and private profile information remain excluded. The privileged
database implementation lives in the non-exposed `private` schema and a narrow
public invoker RPC is the only browser search entry point. Migration `039` is
deployed; unclassified legacy rows remain intentionally unchanged.

## D022 — Explicit Live Location Consent and Participant/Family Visibility
**Status:** Accepted

Live location sharing is an explicit per-session action by the Driver or an
Accepted passenger; it never starts automatically from check-in or trip start.
The Driver sees self plus opted-in passengers, a passenger sees self plus an
opted-in Driver, and passengers never see one another. A passenger may create
one revocable, ride-expiring secret family link. The link is fragment-only,
uses a high-entropy token hash, has no history or pickup-instruction access,
and returns generic responses for invalid, expired, and revoked tokens. The
foreground PWA is the supported contract; hidden/locked-screen tracking is
best effort and is labelled as such.

Latest points are kept separately from sampled history. History is available to
accepted participants after a terminal ride, while family links never receive
history. “Hide my route” hides only the owner’s playback and schedules the
owner track for the 180-day purge policy; other participants retain access.
There is no dispute-based retention hold. Unhidden history follows the academic
prototype's current long-term policy; both policies must be replaced by bounded
production retention before release under Malaysia PDPA.

## D023 — Narrow Module 2 Trust Admin and GPS Evidence Boundary
**Status:** Superseded by D024

Module 2 disputes use a private role/audit model with a bootstrap-only
`role_admin` and assigned `trust_admin` accounts. The role admin can manage
Trust Admin membership and case assignment but cannot read GPS evidence unless
also assigned as Trust Admin. Only the assigned Trust Admin can perform the
explicit, reason-required evidence action; every access, role change, case
reassignment, claim and resolution is audited. This is not a replacement for Module 1’s broader
enforcement or appeal system.

## D024 — Module 2 Live Tracking Without a Production Admin System
**Status:** Accepted

Module 2 keeps explicit participant live sharing, privacy-filtered Realtime,
revocable family links, Dynamic Map fallback and Module 5 sampled-history
replay. Viewing an opted-in Driver never requires a passenger to share their
own location. Family payloads use anonymous marker identifiers and never expose
account UUIDs, pickup instructions or history.

The Trust Admin, ride-dispute and GPS-evidence rollout is removed by the
append-only `055_m2_remove_trust_admin.sql` compensation migration. Deployed
`043-049` files remain immutable history. The original browser-local `/safety`
verification demo remains, but `/safety/admin`, project roles, dispute tables,
evidence holds and the two Admin Edge Functions are not part of the accepted
Module 2 assignment scope.

Deployment completed on 2026-08-24: migration `m2_remove_trust_admin` is live,
`m2-live-share` version 4 is active, and the two Admin Edge Functions are deleted.

## D025 — Authoritative Module 2 Departure Grace and Terminal History
**Status:** Accepted; implementation authored, migration pending deployment approval

The database is the sole Ride lifecycle authority. A Published Ride with no
Accepted request expires at departure. A Published Ride with an Accepted
request becomes Matched at departure and may Check in, resolve No-show, or
Start only until the exclusive `departure_at + 30 minutes` deadline. At that
deadline every unstarted Published/Matched Ride and its remaining Pending or
Accepted requests become `Expired`. Boarding/check-in facts are retained and
expiry does not imply No-show. A Matched Ride must always have at least one
Accepted request; cancelling the final Accepted request before departure
restores the Ride to Published without bypassing the one-hour request cutoff.

`ride_requests.accepted_at` is the stable proof of prior acceptance;
`processed_at` remains the most recent status-processing instant. Live
location, Check-in, family sharing, and in-progress operations continue to
require request status `Accepted`. Terminal history additionally permits only
an `Expired` Ride whose viewer has an `Expired` request with non-null
`accepted_at`. Expired participation never creates a review, Completed trip,
carbon saving, monthly impact, achievement, or leaderboard credit.

Trip Mode is the only UI execution surface for Check-in, No-show, Start, and
arrival confirmation. Ride Detail is a read-only lifecycle summary with an
Open Trip Mode entry; Manage Requests handles pre-departure Accept/Reject and
history only. Module 5 must render stored database states verbatim and may
never infer `In Transit` or `Completed` from the clock. Migration
`056_m2_lifecycle_expiry_and_validation.sql` implements this append-only
contract without changing an Edge Function RPC signature.

## D026 — Shared Semantic UI Runtime and Deterministic Accessibility Gate
**Status:** Accepted

`src/presentation/styles/theme.css` remains the only runtime design-token
authority. Cross-module presentation uses the small primitive set under
`src/presentation/components/ui/`; these components remain independent of
Supabase and business services. Existing green identity, Poppins/Inter type,
seven navigation destinations, URLs, English flows, and service contracts are
preserved. `AdaptiveDialog` standardizes phone sheets and wider dialogs with a
focus trap, Escape handling, and trigger-focus restoration.

`App.jsx` lazy-loads route pages behind one shared loading/error/focus boundary,
and Vite separates React and Supabase vendor code so no generated JavaScript
chunk exceeds 500 KB. UI acceptance uses the no-key `.env.fixture` mode with
Playwright at 375x812, 768x1024, 1024x768, and 1440x1024, stable Chromium
screenshots, horizontal-overflow/touch-target checks, and WCAG A/AA axe scans.
This automated gate does not replace Chrome PWA or physical-device permission,
rotation, keyboard, map, media, and safe-area acceptance.

## D027 — Narrow Public Ride Photo Context
**Status:** Accepted

This decision revises D017 and D021 only for two presentation-safe cases.
Anyone may read the pickup instructions and presence of a pickup photo for an
active Host's Published Ride through `get_public_ride_pickup_context`; the
private object path is never returned, and a five-minute signed URL is issued
only by `m2-ride-pickup-photo` after the same visibility check. A card list may
also obtain only the destination Google Place ID for a Published Ride, or for a
Ride accessible to its Host or Accepted participant, through the bounded batch
RPC `get_ride_destination_photo_place_ids`.

Pickup Place IDs, coordinates, waypoint data, route geometry, Storage paths,
and non-Published pickup context remain private. Google photo URIs are fetched
on demand, attributed, and never stored in the database.

## D028 — One-way Trusted Family and PWA SOS
**Status:** Accepted; backend deployed, client release gated

Trusted Family is an account-level, one-way relationship established by a
hashed, one-use 24-hour invitation. It grants no ordinary Ride or location
access. Every active trusted family recipient receives shared notification
centre/Web Push events while the owner has an active SOS; notification payloads
contain an event ID only, never coordinates.

SOS is limited to the Driver and Accepted passengers from one hour before
departure until the Ride reaches a terminal state. It remains a server event
when GPS, trusted recipients, or Web Push are unavailable, and the PWA reports
those degraded states. Active SOS prevents ordinary location Stop, retains the
last private point, marks signal loss after 120 seconds, and resolves only by
the actor's confirmed “I'm safe” or terminal Ride transition. Resolution
immediately removes coordinates and keeps only a coordinate-free 24-hour shell.

That same eligibility window controls one adaptive authenticated SOS launcher
on pages outside the current Ride's Trip Mode. Phones use a compact 56 px edge
dock, default right. After an 8 px threshold it tracks a primary pointer, then
snaps to the nearest edge and saves a clamped vertical ratio in a user-scoped
local preference. SOS dialogs retain non-drag side, up/down, and reset controls.
An active SOS never compacts. Tablets and desktops place a minimum-44 px SOS action before
Notifications in TopNav. A tap opens confirmation, multiple eligible Rides
require an explicit choice, and an active launcher exposes GPS state, recipient
counts, degraded warnings, and the existing typed `I am safe` resolution flow.
All triggers share one controller. It is given no Ride in the current Ride's
Trip Mode, so Trip Mode retains its two-second hold, five-second cancellation,
and sole watcher ownership. Candidate state refreshes every 15 seconds while
visible and on app return; a transient failure preserves the last known entry
with a warning marker while error detail and Retry stay inside the dialog.

This is a PWA best-effort foreground implementation. Page-hidden tracking may
continue and reconnect retries the latest in-memory point, but browser process
termination can stop GPS. Capacitor, native foreground services, FCM, SMS and
iOS-native work are explicitly outside this decision.

An unread `sos_activated` notification may use a global call-like foreground
alert and the shared Web Audio ringtone, but it is not a Module 3 voice call and
must not create call sessions, request microphone permission, or expose
coordinates in notification state. SOS sound takes priority over a ringing
call, ignores the general in-app sound preference, and leaves a persistent View
SOS bar after its 45-second server-timestamp window. Only activation Push
requests persistent/vibrating/renotified system treatment and a View SOS action.
All SOS events share a stable event notification tag so resolution can replace
activation, while signal changes and resolution remain ordinary notifications.
A visible/focused PWA silently refreshes unread notifications. After showing an
activation Push, the Service Worker additionally posts the event ID to all
existing PWA windows so a hidden but runnable client can refresh and attempt
the same foreground ringtone. Frozen or terminated clients, autoplay policy,
system silent mode, and locked-screen Push audio remain outside application
control.

## D029 — Terminal Ride republishing creates a separate Draft
**Status:** Accepted and deployed

Only the Driver may republish a Completed, Cancelled, or Expired Ride from
History. Republishing never reopens or mutates the terminal row: the server
creates a new Draft ID containing only editable Ride settings and then opens
the existing publisher for review. The old departure time may be copied into
the Draft, but publication still requires a valid future schedule and a fresh
server route quote.

Requests, lifecycle and route-quote state, ETA, live/history location,
conversations, reviews, impact/statistics, and pickup-photo objects remain
bound to the original Ride. Passengers and non-owners cannot republish it.
History cards open Ride Detail before either follow-up. On desktop,
`Publish again` sits in the right action rail; on phone it uses the bottom
action area. A Completed Ride shows its review action above `Publish again`,
and Review opens only after that explicit action is selected.

## D030 — Evidence-based Reputation and Privacy-filtered Public Profiles
**Status:** Accepted in application; migrations 065-066 authored and not deployed.
Its starting score and thresholds are superseded by D034; every other part of
this decision (event-driven changes, the +3 per-Ride cap, idempotent source
events, the three-Ride provisional window, and the public-profile projection)
still stands.

Reputation starts at 70/100 and remains provisional for the first three
evidence rides. Only verified Ride events may change it: completion +1,
on-time Check-in +1, 4/5-star reviews +1/+2, timing-weighted cancellation
−1/−3/−6, verified No-show −10, and confirmed conduct outcomes −8/−20. Positive
events are capped at +3 per user per Ride and source events are idempotent.
Ordinary login, profile completion, identity documents, and CO2 impact award no
reputation because they do not demonstrate Ride reliability. Rating,
Reputation, identity verification, and Module 5 Host Impact remain separate.

After three evidence rides, publishing requires 65/100 and requesting requires
50/100. New members may build evidence below either threshold; a confirmed
safety hold overrides score. The client checks eligibility for early feedback,
while migration 065 owns the authoritative publish/request triggers and event
ledger. Until that migration is deployed, live database behavior is unchanged.

Every active member has a safe public profile with a shortened display name,
rating/review total, Reputation standing, and membership date. Optional
switches control photo, spoken languages, completed-trip count, and CO2 impact.
Email, phone, emergency contact, precise Ride data, vehicle registration, and
companions are never included. An active Driver's minimum identity, rating and
standing remain visible on Published Ride cards. Migration 066 stores the
switches, exposes the filtered RPC, and narrows raw cross-profile visibility;
until deployed, the app uses non-persistent defaults and labels that state.

## D031 — Confirmed Friendships and Separate Permanent Direct Chats
**Status:** Accepted and deployed

A friendship is one normalized account pair and requires explicit acceptance.
It is not inferred from a Ride, request, message, contact list, or profile view.
Discovery is limited to privacy-filtered `/users/:userId` profiles and shared
profile links; this release has no global search, contact import, or blocking.

Each accepted pair owns at most one `friend`-scoped direct conversation. This
conversation is separate from every Ride direct/group conversation, has no Ride
or seven-day expiry, and reuses the existing text, media, location, voice
message, translation, and one-to-one call paths. Removing a friend immediately
blocks server-side message/media/call writes, ends an active call, and leaves the
conversation in Messages as read-only without automatically archiving or
deleting it. A later accepted request restores writes to the same conversation
and preserves its history and each member's delete boundary.

Friend requests notify only the recipient and open `/message/friends`;
acceptance notifies only the requester and opens the permanent chat. Decline,
cancel, and removal are silent. Request counts belong to the Friends entry and
shared notification centre, not the Message unread count. `079_m3` implements
the pair locks, RLS, RPCs, Realtime publication, safe profile relevance, and
friend-chat write gate while preserving all Ride-chat IDs and lifecycle rules.

A co-ride invitation is implemented as a structured friend-chat message storing
only `ride_id` and resolving live Ride state when displayed. It opens the
existing Ride Detail and `Request to join` flow; it does not auto-request,
reserve a seat, or bypass Driver approval. A sender may share a Ride they Host
or one on which their own request is Pending or Accepted, while the recipient
must still be currently eligible to request it.

## D032 — Module 4 Search Requires Confirmed Google Suggestions
**Status:** Accepted and deployed 2026-09-03

An entered Pickup or ordinary Destination on public Search must be selected
from the existing Malaysia-only Google Places combobox after its one-second
debounce. Blank route fields remain valid. Search URLs preserve the selected
input references as `pickupPlaceId` and `destinationSearchPlaceId`;
`destinationPlaceId` remains the separate Module 6 catalogue hint and is the
only input that enables the existing 5/10/25 km recommendation radius.

Migration `082` privately compares passenger-supplied IDs with confirmed Ride
endpoint IDs for direct and multi-leg matching. A legacy Ride whose endpoint ID
is null may fall back to the confirmed Google display text, but a Ride with a
different stored ID cannot. Public results never return Ride endpoint IDs,
coordinates, instructions, waypoints, or route geometry. An environment that
has not deployed `082` reports the dependency rather than silently reverting
to loose text matching. The client retains the complete Google label for display
and URL state but caps only the RPC's legacy fallback prefix at 120 characters,
matching the existing server guard while leaving Place IDs authoritative.

## D032 — Home merges with Destination Discovery; "Home" nav slot renamed Explore
**Status:** Accepted; implemented

The former '/home' landing page held five action-card shortcuts that all
duplicated an existing navigation destination (Publish a ride -> Ride, Find a
ride -> Search, My requests -> Ride, My impact -> Trips, My profile ->
Profile) plus a short destination rail with its own "See all" link into
Module 6's '/discover' hub. The two screens answered overlapping questions
("what can I do here" vs "where should I go") with duplicated content and an
extra click between them.

'/home' now renders Module 6's destination-discovery content directly (the
former DiscoverHub.jsx, moved into HomeScreen.jsx); the five action cards are
removed. '/discover' redirects to '/home' preserving its query string, so
existing bookmarks, shared links, and notification actions still resolve.
'/discover/:placeId' and '/discover/demand' are unchanged, standalone
routes. The shared navigation's first slot keeps its route, position, and
swipe-order role; only its label and icon changed (Home -> Explore, compass
icon) to match what it now opens directly. Trip and ride-request status for a
signed-in member (previously two of the five removed cards) is preserved as a
short, conditional status strip at the top of '/home' - populated from the
existing RideRequestService/RideService, rendered only when there is
something pending, so it never occupies space for a visitor with nothing
going on.

## D033 — Tumpang Guide: "Your travel brief" sidebar becomes a context bar
**Status:** Accepted; implemented

The Guide's trip-planning fields (starting point, dates, party size, category
preferences, trip-history consent) lived in a sidebar ('PlanSummary') open by
default beside the chat on every viewport. Below the shared 900px breakpoint
it stacked above the conversation instead of beside it, so a phone visitor
opening Tumpang Guide saw a full form before any chat - the reported "the
sidebar toggle only collapses itself" confusion traced to this: the toggle
button and the sidebar's own heading used the identical copy string
('Your travel brief'), so the button was named after what it hid rather than
what pressing it would do.

The sidebar is removed. The same fields now live behind a single summary row
('GuideContextBar.jsx') docked above the composer, built from the plan's
current values (e.g. "Kuala Lumpur · Sat 6 Sep · 2 people · Nature"); tapping
it opens the identical fields in the shared 'AdaptiveDialog' (a bottom sheet
on phone, a centred dialog on wider layouts) rather than a permanent column.
No plan-editing capability was removed - PlanSummary's state, handlers, and
normalizePlanState contract are unchanged; only where the fields render
moved. TumpangGuidePage.jsx (previously ~830 lines with the toolbar,
sidebar, transcript, and composer all inline) was split into
GuideToolbar.jsx, GuideContextBar.jsx, GuideComposer.jsx, and
GuideTranscript.jsx; the composer's speech-recognition language selector
gained a visible "Voice input" caption, since it was previously
indistinguishable from a reply-language control despite governing only
transcription.

## D034 — Reputation starts at the 100 ceiling; identity gates hardened without documents
**Status:** Accepted in application; migrations 087_m1 and 088_m1 authored and not deployed

Reputation now starts at 100/100 instead of 70 and is clamped to that ceiling
per event, so it is standing a member keeps rather than points they collect.
Positive Ride outcomes are unchanged (+1 completion, +1 on-time Check-in, +1/+2
for 4/5-star reviews, capped at +3 per user per Ride) but at 100 they are spent
rather than banked: credit earned while already at the ceiling cannot cushion a
later penalty. Negative events, the three-Ride provisional window and the
safety hold are unchanged.

Because nobody now starts below a threshold, the thresholds move to where
losses matter: publishing requires 90 (was 65) and requesting requires 75 (was
50). Tier boundaries are aligned to those capability boundaries rather than
chosen separately - Trusted 95+, Standard 90+ (may publish), Limited 75+ (may
request), Restricted 50+, and below 50 reads as a safety problem. Live scores
are rebased by +30 clamped at 100, which reproduces each member's existing
event history against the new origin.

Reputation still ignores login, profile completion, identity documents and CO2
impact. The reference model that prompted this change (a lost-and-found system
awarding points for posting and for helping, with no upper bound) was
deliberately not adopted: unbounded points reward volume rather than
reliability, and posting is not evidence that somebody carried another person
safely.

Module 5's Host Impact composite drops its reputation term as a direct
consequence. While reputation was additive at weight 0.8, a 100 base scored
every brand-new account at 80 - exactly the Silver threshold - so an account
with zero completed trips was shown a Silver badge and a reduced-fee perk.
Host Impact is now contribution only (`trips x 2.0 + co2 x 0.5`), with tiers
recalibrated to 0/50/120/200 to preserve the previous real spread, and
reputation acting as a ceiling: a confirmed safety hold, or a score below the
Driver publishing threshold, withholds every tier above Bronze. Reputation can
withhold a badge but never grant one. Search ranking uses the same contribution
formula; a member below the publish threshold cannot list a new Ride anyway, so
ranking does not penalise reputation a second time. The badge perks are also now non-monetary. The original
scaffold gave each tier a "platform fee (15%/12%/8%/5%)" ladder borrowed from
commercial ride-hailing, which contradicted the platform's own definition:
Let's Tumpang is non-monetary (PROJECT.md), a Ride's contribution is free text
such as "snacks & drinks", and no fee, fare, amount, currency or payment
provider exists anywhere in the codebase. Those four labels were the only
place the app claimed a commission, and they are replaced with listing
visibility, priority support, discovery placement and verified-badge perks.
A test asserts no perk can reintroduce monetary language.

Identity checks are strengthened without collecting document photos. The MyKad
sign-up gate now requires a real calendar birth date and an assigned birthplace
code instead of only a 12-digit shape; MyKad carries no check digit, so this
remains structural validation. The IC number is still never persisted or
transmitted - `088_m1` records only `profile_private.ic_checked_at`, written by
the account-creation trigger and not writable by any client. A vehicle's
driver's license gains a required expiry date, and a license that is present
and unexpired becomes a server-enforced condition of publishing a Ride, beside
the existing reputation gate. None of this is identity verification: it grants
no badge, no public signal and no reputation. Document photos, and the
reviewer surface they would require, remain out of scope and depend on the open
Trust & Safety console decision.

## Open Decisions
- database schemas/RLS for Module 5 (Module 4's `034`/`035`/`039`/`082` are deployed; Module 6's `024` schema is deployed);
- Routes API, traffic-aware computation, and map pin selection;
- production trip-verification pipeline integration (now Module 2's, per D018);
- whether the four inherited admin surfaces become one shared Trust & Safety console or four separate ones;
- Host Impact formula and badge perks;
- carbon model;
- complete offline behaviour;
- deployment workflow cleanup;
- long-lived module branches vs short-lived feature branches.
