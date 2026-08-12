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

Route and waypoint previews use the shared no-charge Maps Embed API directions
component. It accepts the existing text locations and falls back to the local
route illustration when the restricted key is absent or the app is offline.

Migration `016_m3_supabase_messaging.sql` preserves the public
`respond_to_ride_request(request_id, decision, reason)` interface and seat logic.
For an Accepted decision it also creates/reuses the ride group and adds the
accepted account holder in the same database transaction. Existing Accepted
requests were backfilled during deployment. Companion names remain request data
and are never conversation members. Published Ride Detail also exposes Module
3's independent `Message host` direct-chat entry for non-Hosts.

## Deferred
Places autocomplete, stored coordinates, traffic-aware routing, and
route-deviation automation; messaging notifications; production Module 1/6 driver
verification; wiring the trusted Module 6 pipeline to the service-role transition.
