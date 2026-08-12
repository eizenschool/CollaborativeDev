# Module 5 — Trip Management & Eco Impact

## Owner
Tang Zheng Shian

## Purpose
Trip/history presentation, environmental impact calculations, reports, and leaderboard behaviour.

## Requirement Intent
Hosted/joined history, lifecycle filters, trip details, carbon calculation/display, eco aggregation, monthly reports, monthly Host Impact leaderboard.

## Existing Repository Areas
Presentation: `src/presentation/components/trip/` including `TripModule.jsx`, `TripDetail.jsx`, `RideHistory.jsx`, `ImpactDashboard.jsx`, `MonthlyReport.jsx`, `Leaderboard.jsx`.
Business logic: `src/business-logic/TripHistoryEngine.js`.

## Depends On
Module 2 lifecycle/ride data; Module 1 Host Impact; Module 6 completion/trust outcomes where relevant.

## Current Status
Substantial Module 5 UI and history logic already exist in `Development`.

## Open Questions
Carbon factor/model; authoritative ride/trip source; monthly aggregation strategy; leaderboard schedule; relationship to Module 1 Host Impact calculation.
