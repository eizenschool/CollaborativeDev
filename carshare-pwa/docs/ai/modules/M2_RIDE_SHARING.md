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
`RideRequestService.js`, and `RideReviewService.js`. Deployed SQL `006-015`
covers ride publishing, authoritative `departure_at`, waypoints, multi-seat
requests, atomic acceptance/cancellation, manual recruitment close/reopen,
automatic departure-time lifecycle processing, and mutual Completed-ride
reviews. The same interfaces and state rules exist in the offline mock adapter;
its automatic lifecycle processing is deterministic and lazy.

Published rides must be at least five hours away. New requests close at that
boundary, while existing Pending requests may still be accepted or rejected
until departure. Pending requests do not reserve seats. A Host accepting a
request locks and checks the ride before deducting the whole request, so partial
acceptance and overselling are not allowed. Companion names are visible only to
the requester and Host and do not become account participants.

Module 2 owns `Draft -> Published`, `Published <-> Matched`, cancellation and
expiry. `Matched -> In Transit -> Completed` is exposed only through the
service-role `transition_verified_ride()` contract for a future trusted Module 6
pipeline; no browser adapter can perform that production transition.

New Publish Ride drafts require at least one registered Host vehicle and
confirmed Malaysia-only Google location suggestions for pickup and destination.
The entry gate checks vehicles before requesting location permission. Eligible
Hosts receive one automatic device-location request to centre the Embed preview;
it is neither persisted nor treated as pickup. Pickup may use that location only
when GPS accuracy is 100 metres or better, reverse geocoding succeeds, and the
Host confirms the result. Place IDs are stored for Google selections;
device coordinates are stored only for a confirmed current-location pickup.
Editing the displayed text invalidates the reference immediately. Optional
public pickup instructions are limited to 300 characters and follow the same
accepted-request/status edit lock as the Ride.

`database/sql/020_m2_add_route_locations.sql` contains the required nullable
columns, constraints, and replacement create/update RPC signatures. It is
prepared locally but not yet deployed to the shared project.

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
Responsive verification targets are 375px, 768px, 1024px, and 1440px.

## Deferred
Routes API, route distance/time, traffic-aware routing, map-pin selection, and
route-deviation automation; messaging notifications; production Module 1/6 driver
verification; wiring the trusted Module 6 pipeline to the service-role transition.
