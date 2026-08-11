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
`Development` already contains substantial Module 2 UI and `RideService.js`.

## Open Questions
Ride/trip model; shared lifecycle; multi-passenger behaviour; route-deviation threshold; auto-expiry interpretation; identity/license verification ownership; matched-ride discoverability.
