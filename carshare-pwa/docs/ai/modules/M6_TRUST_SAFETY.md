# Module 6 — Trust & Safety

## Owner
Brayden Toh Zhi Kang

## Purpose
Pickup/trip verification, exchange settlement, disputes, hazard/safety reporting, trust records, enforcement, and appeals.

## Requirement Intent
One-time PIN, GPS verification, independent confirmations, no-show, exchange confirmations, disputes/confidence scoring, overdue, panic/safety reporting, hazard reports/votes/expiry, trust records, enforcement/appeals.

## Existing Repository Areas
Presentation: `src/presentation/components/safety/` including `SafetyRoutes.jsx`, `TripVerificationPanel.jsx`, `VerificationDemoConsole.jsx`, `AdminDisputeConsole.jsx`, `DisputeEvidenceCard.jsx`.
Business logic: `src/business-logic/verification/`.
Data prototype: `src/data-access/module6Store.js`.
Schema note: `docs/MODULE6-SCHEMA.md`.

## Depends On
Module 2 ride/participation/lifecycle; Module 1 reputation; Module 3 hazard advisory communication; geolocation; production database/RLS.

## Current Status
Module 6 has a substantial prototype on `Development`, including tests for several verification engines. Do not restart from its old standalone branch without comparing to `Development`.

## Important Existing Formula
```text
C = 0.35 * GPS + 0.30 * Timeliness + 0.20 * History + 0.15 * Completeness
```
Do not change scoring constants casually.

## Open Questions
Lifecycle sync with Module 2; production persistence/RLS; panic email provider; emergency-contact email mismatch; participation model for multiple clients; admin authorization.
