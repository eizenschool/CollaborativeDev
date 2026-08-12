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
Module 1 eligibility/profile/vehicle; Google Maps; Module 6 lifecycle verification; Module 3 conversation creation after acceptance.

## Provides
Ride data, accepted participation context, lifecycle state, searchable rides.

## Current Status
Module 2 ride CRUD/search is connected to the shared Supabase project through
`RideService.js`. The deployed schema is `006-007` plus hardening in `010` and
`012`: authenticated browsing, host-only management, persisted waypoints,
seat constraints, indexed search/ownership, and a mandatory vehicle owned by
the host. Drafts use the current Review-step save semantics and therefore need
the same route, date, time, seats, and vehicle fields as published rides.
Ride requests, reviews, and accepted-passenger persistence remain local/future.

## Open Questions
Ride/trip model; shared lifecycle; multi-passenger behaviour; route-deviation threshold; auto-expiry interpretation; identity/license verification ownership; matched-ride discoverability.
