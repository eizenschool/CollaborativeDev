# Module 2 — Ride Sharing Management

## Owner
Yee Zu Yao

## Purpose
Core ride publishing, ride requests, host request management, and lifecycle behaviour.

## Requirement Intent
Publish ride, pickup/destination/date/time/seats/vehicle, non-monetary contribution/restrictions, request to join, details/status, accept/reject, edit/cancel, lifecycle, review, route/waypoints.

## Existing Repository Areas
Presentation: `src/presentation/components/ride/` including `RideHub.jsx`, `PublishRide.jsx`, `RideCard.jsx`, `RideDetail.jsx`, `ManageRequests.jsx`, `MyRequests.jsx`, `EditRide.jsx`, `RateReview.jsx`.
Business logic: `src/business-logic/RideService.js`.

## Owns
Ride entity behaviour, publishing/request flows, host decisions, ride lifecycle contract.

## Depends On
Module 1 eligibility/profile/vehicle; Google Maps; Module 6 lifecycle verification; Module 3 group membership after acceptance.

## Provides
Ride data, accepted participation context, lifecycle state, searchable rides.

## Current Status
Module 2 is connected to the shared Supabase project through `RideService.js`,
`RideRequestService.js`, and `RideReviewService.js`. Deployed SQL `006-015`,
`020`, and `023` covers ride publishing, authoritative `departure_at`, multi-seat
requests, atomic acceptance/cancellation, manual recruitment close/reopen,
automatic departure-time lifecycle processing, and mutual Completed-ride
reviews. The same interfaces and state rules exist in the offline mock adapter;
its automatic lifecycle processing is deterministic and lazy.

Deployed migration `027_m2_route_schedule_and_completion.sql` and the deployed
`m2-route-quote` / `m2-route-backfill` Edge Functions upgrade the schedule
and completion contract. Published rides, request submission, and recruitment
reopening use one shared one-hour boundary. Existing Pending requests may still
be accepted or rejected
until departure. Pending requests do not reserve seats. A Host accepting a
request locks and checks the ride before deducting the whole request, so partial
acceptance and overselling are not allowed. Companion names are visible only to
the requester and Host and do not become account participants.

Published creation and Published edits use a five-minute encrypted, HMAC-signed
server quote bound to the Driver, vehicle, full confirmed route, ordered
waypoints, stop minutes, and departure time. Google Routes calculates the
traffic-aware driving duration at Review time; stop minutes are added to the
ETA, and the occupied half-open interval ends 30 minutes after ETA. A per-Driver
profile-row lock serializes publication. Overlaps, equal departure times, a
second concurrent publication, an existing active Ride with no ETA, and any
existing `In Transit` Ride are rejected in the database transaction. Browser
clients can create/update Drafts but cannot call the old direct publish RPC.

Waypoints now require a confirmed Google Place ID, order, and `stopMinutes`
(0-180). Legacy waypoint JSON stays readable and is marked for reconfirmation;
no Place ID is fabricated. Any route, waypoint, stop, vehicle, or departure
change invalidates the prior quote and ETA.

The verified lifecycle is now narrow-RPC based. Accepted passengers may check
in during the final hour only with GPS accuracy at most 100 m and within 200 m
of the private pickup route anchor. Only the result, distance, and timestamp are
stored; submitted GPS coordinates are not persisted. At departure the Driver
must mark unresolved accepted passengers No-show, and at least one accepted
passenger must be checked in before `In Transit`. At the destination, the
Driver confirms GPS within the same accuracy/distance limits and every checked-in
passenger confirms arrival. No-show passengers are excluded. The existing
minute Cron completes immediately after all confirmations or after the Driver's
24-hour confirmation deadline.

New Publish Ride drafts require at least one registered Host vehicle and
confirmed Malaysia-only Google location suggestions for pickup and destination.
The entry gate checks vehicles before requesting location permission. Eligible
Hosts receive one automatic device-location request that shows a current-position
pin in the Embed preview; it is neither persisted nor treated as pickup. Once a
complete route is selected, Directions Embed automatically fits the viewport to
the journey distance. Pickup may use the device location only
when GPS accuracy is 100 metres or better, reverse geocoding succeeds, and the
Host confirms the result. Place IDs are stored for Google selections;
device coordinates are stored only for a confirmed current-location pickup.
Editing the displayed text invalidates the reference immediately. Optional
public pickup instructions are limited to 300 characters and follow the same
accepted-request/status edit lock as the Ride.

`database/sql/020_m2_add_route_locations.sql` contains the required nullable
columns, constraints, and replacement create/update RPC signatures. It was
deployed to the shared project on 2026-08-13.

Route and waypoint previews continue to use Maps Embed API directions mode.
The builder sends Place ID or coordinate references when available and falls
back to saved text for legacy Rides. Legacy rows without canonical references
remain readable and may edit non-route fields without fabricated location data.

Migration `016_m3_supabase_messaging.sql` preserves the public
`respond_to_ride_request(request_id, decision, reason)` interface and seat logic.
For an Accepted decision it also creates/reuses the ride group and adds the
accepted account holder in the same database transaction. Existing Accepted
requests were backfilled during deployment. Companion names remain request data
and are never conversation members. Published Ride Detail also exposes Module
3's independent `Message host` direct-chat entry for non-Hosts.

The Module 2 presentation follows the shared `docs/ai/UI.md` phone-first
contract across the ride hub, publishing, detail, request management, editing,
and review flows. Primary mobile actions sit above the shared bottom navigation
and safe area, interactive controls use visible labels and at least 44px touch
targets, sheets become centred dialogs on wider screens, and ride listings and
details reflow into tablet/desktop grids without changing the service contract.
Publish Ride unlocks its Route, Schedule, Vehicle, Trip Details, and Review
steps sequentially. The desktop step rail links only to the current or already
unlocked steps, and invalidating an earlier required step blocks forward jumps
until it is complete again. Review exposes an explicit Back action on phone and
desktop. Edit Ride loads the Host vehicle list, shows the selected vehicle, and
retains the pre-027 Host-only full-row fallback for environments that have not
yet applied migration 027.
Responsive verification targets are 375px, 768px, 1024px, and 1440px.

Ride search and Published Ride Detail are public browsing surfaces. Guests are
sent to the shared auth page only when they select Publish/My rides, Request to
join, Message host, or another account-specific Ride action. Migration
`023_m1_m2_public_ride_browsing.sql` is deployed with column-scoped anon reads
for only Published rides from active Hosts plus the safe profile and impact
fields used by public ride cards. Migration `027` adds only
`estimated_arrival_at` to that anonymous column grant. Place IDs, precise
coordinates, pickup instructions, check-in distance, quote metadata, and
lifecycle confirmations stay out of the guest/list payload. Route anchors are
held under the private schema and the short-lived client quote is encrypted as
well as signed.
Requests, vehicles, reviews, and messaging remain authenticated/private.

For FR-6.35, Module 2 consumes the versioned `discoveryPrefill` navigation
state defined in `docs/ai/FR-6.35_PREFILL_CONTRACT.md`. It may display incoming
labels, but it must not treat a fixture catalogue key as a confirmed Google
location.

## Deployment Gate / Deferred

Migration `027` and both Edge Functions were deployed to project
`pnetstmovctfwqcumodx` on 2026-08-14. `M2_ROUTE_QUOTE_SECRET` and
`M2_ROUTE_BACKFILL_SECRET`, and the dedicated Routes-only server key are
configured. The one-time ETA backfill completed for the two eligible future
rides. Google Cloud reports its Routes daily quota as unlimited and
non-adjustable, so it cannot provide the requested 250/day platform ceiling;
the dedicated key is available only to these Edge Functions and the database
enforces the fail-closed 250-request Malaysia-day cap before Google is called.
Cloud usage alerts remain an operational follow-up. Failed/legacy rows must ask
the Driver to reconfirm; no fixed-duration ETA fallback is allowed.
Route-deviation automation, map-pin selection, and messaging notifications
remain deferred.
