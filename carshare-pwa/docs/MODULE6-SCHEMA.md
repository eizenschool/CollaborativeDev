# Module 6 — Trip Verification, Exchange Settlement & Safety

Owner: Brayden Toh Zhi Kang (QA Lead). Covers **UC6.1–UC6.10 + UC6.22** (PIN pickup
verification, GPS cross-check, independent trip/exchange confirmation, dispute
confidence scoring and admin resolution). UC6.11–UC6.21 (overdue monitoring, Panic
Button, Safety Report, hazard reporting, credibility weighting) are documented in
the proposal but not implemented in this pass.

This file is Module 6's own schema/interface document, kept separate from
[`docs/SUPABASE-SETUP.md`](./SUPABASE-SETUP.md) (Daniel's Module 1 doc) so the two
modules never need to edit the same file.

## Why this module has no real Supabase table yet

Module 6 currently runs entirely against its own mock store
(`src/data-access/module6Store.js`, localStorage key `letstumpang_module6_v1`),
mirroring the same `isSupabaseConfigured` fallback pattern the rest of the app
uses. It does not yet read `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` because a
real `trip_verification` table depends on Module 2's `rides` table carrying a
`Matched` status and a join/request flow that assigns a `client_id` — neither
exists yet (see `TripContractAdapter.js`). The schema below is written so that,
once Module 2's lifecycle lands, only the mock store's calls need to be swapped
for Supabase calls — the shape does not change.

## Proposed schema (for when a real backend is wired up)

```sql
create table trip_verification (
  ride_id             uuid primary key references rides(id),
  host_id             uuid not null references profiles(id),
  client_id           uuid not null references profiles(id),
  pin                 text not null,
  pin_generated_at    timestamptz not null,

  pickup_confirmed_at timestamptz,
  gps_check           text check (gps_check in ('Pass', 'GPS mismatch', 'Unavailable')),
  gps_distance_m      integer,

  no_show_party       text check (no_show_party in ('host', 'client')),
  no_show_recorded_at timestamptz,

  start_confirmed_host      timestamptz,
  start_confirmed_client    timestamptz,
  complete_confirmed_host   timestamptz,
  complete_confirmed_client timestamptz,

  exchange_host           text check (exchange_host in ('Fulfilled', 'Not Fulfilled')),
  exchange_host_at        timestamptz,
  exchange_host_defaulted boolean default false,
  exchange_client           text check (exchange_client in ('Fulfilled', 'Not Fulfilled')),
  exchange_client_at        timestamptz,
  exchange_client_defaulted boolean default false,

  dispute_status           text check (dispute_status in
                              ('None', 'Disputed', 'Auto-Resolved', 'Pending Review', 'Resolved')),
  dispute_confidence_score numeric(3,2),
  dispute_signals          jsonb,
  dispute_outcome          text check (dispute_outcome in ('Fulfilled', 'Not Fulfilled', 'Inconclusive')),
  dispute_resolved_by      text,
  dispute_resolved_at      timestamptz,

  verification_status text not null check (verification_status in ('Matched', 'In Transit', 'Completed'))
);

create table dispute_history (
  user_id         uuid primary key references profiles(id),
  prior_disputes  integer not null default 0
);

create table verification_events (
  id            uuid primary key default gen_random_uuid(),
  type          text not null check (type in ('NO_SHOW', 'DISPUTE_RESOLVED')),
  user_id       uuid not null references profiles(id),
  ride_id       uuid not null references rides(id),
  payload       jsonb not null,
  created_at    timestamptz not null,
  consumed      boolean not null default false
);
```

### RLS intent (not yet applied — no live table to apply it to)

- `trip_verification`: readable by `host_id` and `client_id` only; PIN column
  should never be selectable by anyone except those two. Writes to
  `dispute_resolved_by = 'admin'` restricted to an admin role once one exists.
- `verification_events`: insert-only for the authenticated user who is `host_id`
  or `client_id` on the referenced ride; **no module other than Module 1's
  reputation job should ever be granted `select`** — this is the enforcement of
  the "Module 1 pulls, Module 6 never pushes" contract below.

## Outbound interface contract — what Module 1 will consume (FR-1.5)

`VerificationEventFeed.js` is Module 6's only outbound API. It appends to
`verification_events` and exposes:

| Method | Returns |
|---|---|
| `listUnconsumed()` | Every event not yet marked `consumed` |
| `listForUser(userId)` | Every event for one user, consumed or not |
| `markConsumed(eventId)` | Marks one event processed |

Module 6 never calls into Module 1's code. When Module 1's reputation
recalculation (UC1.5) is built, it should poll `listUnconsumed()`, apply each
event to its own scoring, then call `markConsumed()`. This keeps the dependency
pointed in one direction only.

## Inbound contract — what Module 6 reads from other modules

All routed through `TripContractAdapter.js`, the only file in Module 6 that
imports another module's code:

| Source | What's read | Current gap |
|---|---|---|
| Module 2 `RideService` | pickup, destination, date, time, journey scale, host | No `getRideById`; adapter filters `searchRides()`. No `Matched`/`In Transit` states yet — see below |
| Module 2 (future) | `etaTimestamp` | Not exposed yet (`FR-2.17`, out of current Module 2 scope); adapter returns `null` |
| Module 1 `HostImpactEngine` | `reputationScore` | Fully available today — this is a read Daniel's own file comment sanctions |

## Known gap this module is downstream of

Module 2's `rides.status` currently only reaches `Draft`/`Published`. Every UC in
this module assumes a trip can reach `Matched`. Until Module 2 ships a join/accept
flow, Module 6's screens work entirely against its own seeded demo data
(`module6Store.js`) rather than live rides — this is documented, not hidden,
and is the reason `TripContractAdapter.requestStatusTransition()` writes to
Module 6's own shadow `verification_status` field instead of `rides.status`.
