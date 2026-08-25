# Trust & Safety — Handover Record

Formerly Module 6. That scope was redistributed with tutor approval; Module 6 is
now Destination Discovery (`M6_DESTINATION_DISCOVERY.md`).

This file exists so the prototype code already on `Development` is not orphaned.
It records what exists and who now owns it. It is **not** a module context file —
each receiving owner should fold the relevant parts into their own
`Mx_*.md` when they pick the work up.

## Who owns what now

| Owner | Former FRs | Subject | Code status |
|---|---|---|---|
| Module 2 — Yee Zu Yao | FR-6.1–6.10, 6.22, 6.32 | PIN, pickup verification, GPS cross-check, independent confirmations, no-show, exchange settlement, dispute scoring and adjudication | **Implemented and tested** |
| Module 3 — Chong Zheng Zhe | FR-6.13, 6.15–6.21, 6.25 | Panic Button, hazard reporting, confidence, expiry, credibility weighting | Not implemented |
| Module 1 — Daniel Lim | FR-6.14, 6.24, 6.26–6.31 | Safety Report, Trust Case, enforcement, appeals and reversal | Not implemented |
| Module 5 — Tang Zheng Shian | FR-6.11, 6.12, 6.23 | Trip overdue detection, status check, escalated review | Not implemented |

## Existing code (Module 2's, in practice)

```text
src/business-logic/verification/       PinService, GeoVerification,
                                       TripConfirmationService,
                                       ExchangeSettlementService,
                                       DisputeConfidenceEngine,
                                       DisputeResolutionService,
                                       TripContractAdapter,
                                       VerificationEventFeed, DemoClockService
src/presentation/components/safety/    SafetyRoutes, TripVerificationPanel,
                                       DisputeEvidenceCard, VerificationDemoConsole
src/data-access/module6Store.js        browser-local prototype store
src/App.jsx                            the /safety route
docs/MODULE6-SCHEMA.md                 draft schema for this scope
```

D024 keeps this browser-local verification demo but removes the later production
Trust Admin/ride-dispute/GPS-evidence experiment. `/safety/admin` and its Admin
Edge Functions are not part of the accepted Module 2 scope; any future shared
Trust & Safety administration requires a new team decision.

Unit tests live in `src/business-logic/verification/__tests__/` and cover the
numeric thresholds by Boundary Value Analysis (100 m GPS tolerance, 0.75
auto-resolve, 15-minute no-show, 48-hour default confirmation, PIN exact match).
They make no API calls.

## Dispute confidence formula

```text
C = 0.35*GPS + 0.30*Reputation + 0.20*Timeliness + 0.15*DisputeHistory
```

GPS carries the most weight because it is the only physically objective signal in
the set. An unavailable GPS reading scores 0.5, not 0 — a phone with location
services off is not evidence of fraud. A confirmation defaulted in at the
48-hour mark scores 0 on the timeliness axis, because silence is not evidence.
Auto-resolution above 0.75 adopts the higher-reputation party's claim; equal
reputation yields Inconclusive rather than an arbitrary pick.

Do not change these constants casually — the BVA tests assert the boundaries.

## Carried-over constraints

- The browser-local adapter is non-production and cannot write `rides.status`.
  Module 2 exposes `transition_verified_ride(ride_id, next_status)` to
  `service_role` only, for a future trusted pipeline to drive
  `Matched -> In Transit -> Completed`.
- `TripContractAdapter.js` is the only file in that code that imports another
  module's code. It already consumes Module 2's authoritative `departureAt`.
- `VerificationEventFeed.js` publishes no-show and dispute outcomes for Module 1's
  FR-1.5 reputation recalculation to poll. Module 1 pulls; the pipeline never
  pushes into Module 1.

## Open questions inherited with the work

Production persistence and RLS for verification state; admin authorisation, and
whether the four inherited admin surfaces become one shared Trust & Safety console
or four separate ones (flagged for a whole-team decision); panic notification
provider; participation model where a ride has multiple clients.
