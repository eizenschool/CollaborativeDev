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
**Status:** Accepted
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
Routes, Dynamic Maps, distance/time, and traffic remain outside this phase.

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
whole bundle. Completed private chats can be archived per user, Completed group
travellers can leave, and Hosts cannot leave. Completed, Cancelled, and Expired
conversation access ends permanently seven days after the terminal timestamp,
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
**Status:** Accepted; implementation authored, migration pending review

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
public invoker RPC is the only browser search entry point. Migration `039`
remains undeployed until its separate review.

## Open Decisions
- database schemas/RLS for Module 5 (Module 4's `034`/`035` are deployed and `039` awaits review; Module 6's `024` schema is deployed);
- Routes API, traffic-aware computation, and map pin selection;
- production trip-verification pipeline integration (now Module 2's, per D018);
- whether the four inherited admin surfaces become one shared Trust & Safety console or four separate ones;
- reputation and Host Impact formulas;
- carbon model;
- complete offline behaviour;
- deployment workflow cleanup;
- long-lived module branches vs short-lived feature branches.
