# Module 5 — Trip Management & Eco Impact

## Owner
Tang Zheng Shian

## Purpose
Trip/history presentation, environmental impact calculations, reports, and leaderboard behaviour.

## Requirement Intent
Hosted/joined history, lifecycle filters, trip details, carbon calculation/display, eco aggregation, monthly reports, monthly Host Impact leaderboard.

## Existing Repository Areas
Presentation: `src/presentation/components/trip/` including `TripModule.jsx`, `TripDetail.jsx`, `RideHistory.jsx`, `ImpactDashboard.jsx`, `MonthlyReport.jsx`, `Leaderboard.jsx`, and the shared `tripStates.jsx` error/not-found surfaces.
Business logic: `src/business-logic/TripHistoryEngine.js`.
Tests: `src/business-logic/__tests__/TripHistoryEngine.test.js`.

## Depends On
Module 2 lifecycle/ride data; Module 1 Host Impact; Module 6 completion/trust outcomes where relevant.

## Current Status
Module 5 UI is in `Development` and its logic layer now reads Module 2's real data
through `RideService` / `RideRequestService`, so FR-5.1/5.2/5.3 (history,
lifecycle filtering, trip detail) work against Supabase as well as the mock.

Resolved:
- Authoritative trip source is Module 2, reached through its services rather
  than a data-access store. History merges hosted rides with rides the user has
  an **Accepted** `ride_request` on; the module's own
  `letstumpang_module5_joined_trips_v1` localStorage seed is gone.
  Note `RideService.listMyRides()` returns `joining: []` on its Supabase path,
  so joined trips must come from `RideRequestService.listMyRequests()`.
- Lifecycle state comes from `ride.status`. `Expired` is no longer mistaken for
  `Completed` (it used to earn carbon credit), and `Matched` is reachable.
- Reads `departure_at` via `departureParts()`, not the `date`/`time` columns
  dropped in `database/sql/013`.
- Monthly aggregation and the leaderboard period are computed on read from
  completed trips; no snapshot tables. Leaderboard eligibility is "completed at
  least one trip in that month", ranked by Module 1's Composite Host Impact
  Score (reused from `HostImpactEngine`, not reimplemented).
- Trip detail enforces UC5.3 C1: non-participants get the same "not found"
  answer as a missing trip.

## Open Questions
Carbon factor/model is still unratified — `AVG_DISTANCE_KM` and
`EMISSION_FACTOR_KG_PER_PASSENGER_KM` in `TripHistoryEngine.js` are a labelled
estimate, and no ride carries a real distance.

Module 5 has no tables of its own. The eco half (FR-5.4-5.11) is blocked on a
real `Completed` transition: `transition_verified_ride()` is `service_role`-only
with no caller in `src/`. Verified on 2026-08-13 against the connected project —
the database holds 4 rides (3 Published, 1 Draft), **zero Completed**, and every
`host_impact_stats` row still has `completed_trips = 0` and `co2_saved_kg = 0`.
So on Supabase the impact, report, and carbon surfaces correctly render their
empty states, and `getLeaderboard()` throws
`LEADERBOARD_NEEDS_COMPLETED_TRIPS` rather than feeding demo host ids into a
Supabase uuid column. Drop that guard and read live rides once completions exist.

`deriveDisplayStatus()` derives `In Transit`/`Completed` from a departed
`Matched` ride as an interim stand-in; delete that branch once Module 6's
verified-trip pipeline writes real transitions (D012).
