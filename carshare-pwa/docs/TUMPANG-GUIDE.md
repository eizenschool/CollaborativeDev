# Tumpang Guide — Module 6 controlled RAG

## Status

Implementation is present on `Module6_Trust_And_Safety` and is deliberately
rollout-gated. Migrations `079_m6_tumpang_guide.sql` and
`080_m6_tumpang_guide_stability.sql`, plus the Edge Function, must be reviewed
and deployed by the team before the live provider flag is enabled. Automated
tests and production/PWA builds are run at the second model-switch checkpoint
before integration.

The feature is public at `/assistant`; guests get an in-memory conversation and
five successful Gemini turns per browser session. Signed-in users get twenty
successful Gemini turns per Malaysia calendar day, private Past plans, deletion,
feedback and automatic 90-day expiry.

## Reused project capabilities

Tumpang Guide does not maintain a second destination or Ride system.

- Retrieval and fixture fallback call the existing
  `DestinationDiscoveryService`, weather gate, seasonal calendar, two-axis score,
  latent demand, preference and completed-trip adapters.
- Recommendation cards reuse `PlaceImage`, so live Places Photos and the local
  deterministic poster fallback behave exactly like Discover.
- `Why this` expands verified reasons inside the same card first. Its separate
  details action opens the existing `/discover/:placeId` carousel, reviews,
  description, Street View and Ride actions with a small session-scoped reason
  banner.
- `Find a ride` uses the accepted FR-6.35 Search prefill contract.
- Location is the existing one-shot browser geolocation preview. Coordinates are
  used only by server retrieval and are removed before Gemini receives the plan.
- Interest, Ride alerts, travel preferences and notification results use the
  existing Module 6 services and shared notification centre.
- Shared Button, IconButton, AdaptiveDialog, PageShell and AsyncState primitives
  are reused. No shared theme or navigation component was changed.

## Controlled RAG flow

1. The four-language parser merges date, starting point, party size, category and
   constraints into a maximum seven-day plan.
2. The Edge Function validates an optional user JWT and server-side quota.
3. Postgres supplies only recommendable `places`, current Published/Matched Ride
   seats, latent interest and `place_travel_attributes`.
4. Weather is fetched once in a batched Open-Meteo request; severe weather is a
   gate, not a Gemini judgement. Season, affinity, quality, visitation headroom,
   local-economy, seat headroom, distance and demand reuse the established Module
   6 scoring semantics.
5. Gemini receives the de-identified plan, at most six dialogue rounds, category
   counts from consented Trip History, and a candidate allowlist. It has no
   Google Search or Maps grounding tool.
6. The server rejects unknown Place IDs, duplicate roles, unverified reason
   codes, unknown actions and invalid JSON. Rejection, timeout, provider 429,
   disabled Gemini or offline state uses deterministic catalogue rules.
7. A signed-in turn is atomically stored with the shown Place IDs, evidence,
   model/prompt version and private trace. Guest message text is never stored.
8. Every recommendation response has an immutable `batchId`. Gemini retries,
   language changes, Why this expansion and detail-page return reuse that batch;
   they do not silently re-rank or consume another recommendation turn.

Fixed response fields:

```text
mode, assistantMessage, language, planState, quickReplies,
recommendations[{ placeId, role, verifiedReasonCodes, tradeoffCode }],
actions, remainingTurns, fallbackReason, traceId
```

The browser performs an additional Place ID/action/schema check before rendering.

## Safety and action boundary

- Emergency intent bypasses Gemini and stops recommendation. The response only
  exposes Call 999 and the existing Trusted Family/Profile route.
- Save interest, register Ride alert, save travel preferences and request a
  catalogue review always open Confirm/Cancel first.
- Publish, Request Seat, Cancel Ride, Profile mutation and real-person messaging
  never execute inside Guide; only their formal pages may perform them.
- An individual Ride Favourite is not offered until Search has selected a real
  Ride, so Guide hands off instead of guessing a Ride ID.

## Database migration

`database/sql/079_m6_tumpang_guide.sql` adds only Module 6 data:

- `ai_guide_sessions`, `ai_guide_messages`, `ai_guide_recommendations`,
  `ai_guide_feedback`
- `ai_help_sections` with `extensions.vector(768)`
- `place_travel_attributes`
- `place_catalogue_requests`
- private usage and trace tables

Every public table has RLS. Browser writes to AI sessions/messages,
recommendations, feedback, embeddings, usage and traces are revoked. The Edge
Function owns atomic writes. Owners may read/delete only their history. Account
deletion cascades through owner-linked rows. Cron removes expired conversations
and old private guest traces.

The same migration schedules at most five aggregated catalogue names each week.
`m6-ingest` reuses its Text Search and bounded Details enrichment, verifies a
Malaysia result and supported category, then accepts or rejects with a fixed
reason. Existing notification triggers inform each requester.

## External request inventory

No external call is made by automated tests.

| Caller | Endpoint | Purpose | Credential |
|---|---|---|---|
| Browser | `/functions/v1/m6-tumpang-guide` | Guide turn/feedback | publishable key + optional user JWT |
| Guide Edge | Gemini `models/{model}:generateContent` | friendly comparison over allowlisted candidates | `GEMINI_API_KEY` Edge secret |
| Guide Edge | Gemini `models/gemini-embedding-2:embedContent` | 768-dimensional Help query/document vectors | `GEMINI_API_KEY` Edge secret |
| Guide Edge | `api.open-meteo.com/v1/forecast` | batched weather gate | no credential |
| `m6-ingest` | Google Places `places:searchText` | weekly top-five catalogue request validation | existing `GOOGLE_PLACES_SERVER_KEY` |
| `m6-ingest` | Google Places `/places/{id}` | same-call catalogue and travel-attribute enrichment | existing server key |

The Details field mask now includes price level, opening hours, children/groups,
restroom, parking, wheelchair entrance and outdoor seating in the same bounded
enrichment response. Recommendation requests never call Places Details.

## Environment and secrets

Browser build flags:

```text
VITE_TUMPANG_GUIDE_ENABLED=true
VITE_TUMPANG_GUIDE_MODE=gemini
VITE_DISCOVERY_DATA_SOURCE=supabase
```

When browser Supabase values are present, the Guide now selects the live
`m6-tumpang-guide` Edge Function automatically. Set
`VITE_TUMPANG_GUIDE_MODE=fixture` only for deliberate offline/demo use; the
fixture build and automated tests remain isolated from live services.

For a production build, `VITE_TUMPANG_GUIDE_ENABLED=true` is accepted only
when the browser Supabase URL and publishable key are also present. If the live
configuration is missing, `/assistant` stays disabled instead of exposing the
fixture catalogue to production users.

Edge secrets/settings:

```text
GEMINI_API_KEY=<server only>
M6_TUMPANG_GUIDE_GEMINI_ENABLED=true
M6_GUIDE_GEMINI_MODEL=gemini-3.5-flash-lite
M6_GUIDE_EMBEDDING_MODEL=gemini-embedding-2
M6_GUIDE_ALLOWED_ORIGINS=https://<app-host>
M6_GUIDE_VISITOR_PEPPER=<random server value>
M6_GUIDE_GLOBAL_DAILY_CAP=1000
M6_GUIDE_ACTOR_BURST_CAP=4
M6_GUIDE_GLOBAL_BURST_CAP=40
M6_GUIDE_QA_USER_IDS=<comma-separated approved production QA user IDs>
```

`GEMINI_API_KEY` must never use a `VITE_` prefix. The project URL, publishable
key and user JWT are the only browser-side Supabase values.

After migration deployment, call the service-key-only operation
`refresh_help_embeddings` once to populate currently null Help vectors. Until
then the same verified Help rows use deterministic keyword fallback.

## Rollout order

1. Review and apply `079_m6_tumpang_guide.sql`, then `080_m6_tumpang_guide_stability.sql`, after confirming the shared
   migration ledger. Do not rename the existing Module 3 `075` file from this
   module branch.
2. Redeploy `m6-ingest`, then deploy `m6-tumpang-guide` with the server flag off.
3. Populate Help vectors and verify RLS with two accounts.
4. Run the written Vitest, SQL-contract, Edge-pure, Playwright, production and
   PWA build checks without live API traffic.
5. Enable the browser and server flags in QA, then test accounts, signed-in users
   and finally guests.

## Files and ownership

The implementation lives under Module 6-owned `guide/`, `discover/`,
`m6-tumpang-guide`, `m6-ingest`, this document and migrations `079`/`080`. The only
shared integration edits are the lazy `/assistant/*` route and its Edge Function
config entry. Home, Search, Module 2/3/4/5 business logic, shared navigation,
shared CSS tokens and the former `/safety` prototype are unchanged.
