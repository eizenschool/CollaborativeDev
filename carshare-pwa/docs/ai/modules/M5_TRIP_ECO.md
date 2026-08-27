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
Module 2 authoritative lifecycle/ride data; Module 1 Host Impact.

## Current Status
Module 5 UI is in `Development` and its logic layer now reads Module 2's real data
through `RideService` / `RideRequestService`, so FR-5.1/5.2/5.3 (history,
lifecycle filtering, trip detail) work against Supabase as well as the mock.
Trip detail now reflows from a single column to a purposeful wider grid and
uses shared route loading and status presentation. History, carbon, impact,
route-replay fallback, and participant-access rules remain unchanged.

Resolved:
- Authoritative trip source is Module 2, reached through its services rather
  than a data-access store. History merges hosted rides with rides the user has
  an active **Accepted** `ride_request` on, plus an Expired request with a
  non-null `acceptedAt` on an Expired Ride; the module's own
  `letstumpang_module5_joined_trips_v1` localStorage seed is gone.
  Note `RideService.listMyRides()` returns `joining: []` on its Supabase path,
  so joined trips must come from `RideRequestService.listMyRequests()`.
- Lifecycle state comes only from `ride.status`. `deriveDisplayStatus()` is a
  pass-through: a past Matched Ride is never fabricated as In Transit or
  Completed. Expired former participants appear in Passenger history but
  receive no distance, carbon, review, monthly impact, achievement, or
  leaderboard credit.
- Reads `departure_at` via `departureParts()`, not the `date`/`time` columns
  dropped in `database/sql/013`.
- Monthly aggregation and the leaderboard period are computed on read from
  completed trips; no snapshot tables. Leaderboard eligibility is "completed at
  least one trip in that month", ranked by Module 1's Composite Host Impact
  Score (reused from `HostImpactEngine`, not reimplemented).
- Trip detail enforces UC5.3 C1: non-participants get the same "not found"
  answer as a missing trip.

## Open Questions
Distance is no longer guessed wherever Module 2 has routed one. Publishing
requires a fresh route quote and stores its distance on the ride
(`route_distance_meters` / `routeDistanceMeters`), so `tripDistanceKm()` reads
that first and only falls back to the `AVG_DISTANCE_KM` table for rides that
predate quotes. It reports which source it used, and the history card marks a
table figure with a leading "~".

`EMISSION_FACTOR_KG_PER_PASSENGER_KM` (0.12) is still an unratified estimate,
and the fallback table still applies to older rides — so a carbon total can mix
measured and estimated legs.

Module 5 has no tables of its own. The eco half (FR-5.4-5.11) is blocked on a
real `Completed` transition: `transition_verified_ride()` is `service_role`-only
with no caller in `src/`. Verified on 2026-08-13 against the connected project —
the database holds 4 rides (3 Published, 1 Draft), **zero Completed**, and every
`host_impact_stats` row still has `completed_trips = 0` and `co2_saved_kg = 0`.
So on Supabase the impact, report, and carbon surfaces correctly render their
empty states, and `getLeaderboard()` throws
`LEADERBOARD_NEEDS_COMPLETED_TRIPS` rather than feeding demo host ids into a
Supabase uuid column. Drop that guard and read live rides once completions exist.

The Module 2 lifecycle processor owns real `In Transit`/`Completed` writes and
the 30-minute unstarted-Ride expiry contract (D025). Module 5 never repairs or
predicts those states from departure time.

## Location History Replay (Module 2 integration)

Completed, Cancelled, and Expired participant trips may render `TripRouteReplay`. It
loads cursor-paginated, sampled participant history from Module 2's private
RPC, splits gaps longer than two minutes, shows participant/accuracy/stale
state, and never grants family-link viewers history. A participant's “Hide my
route” action hides only that owner's playback and schedules the owner track
for the Module 2 retention policy; other accepted participants retain their
view. This integration does not change Module 5's carbon calculation contract.
