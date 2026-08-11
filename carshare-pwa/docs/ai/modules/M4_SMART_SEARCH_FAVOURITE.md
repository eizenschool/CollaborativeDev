# Module 4 — Smart Search & Favourite

## Owner
Eizen Lim Hoe Yuen

## Purpose
Advanced search, filters, favourites, alternative/multi-leg suggestions, and route-related discovery.

## Requirement Intent
Advanced search, event/cultural/culinary proximity, filters, journey-scale filtering, favourites, alternative routes, Host Impact sorting, unavailable notifications, multi-leg suggestions.

## Existing Repository Areas
Presentation: `src/presentation/components/search/` including `SearchModule.jsx`, `SearchForm.jsx`, `RideCards.jsx`.
Routing must be checked because search components may not yet be wired to active `/search`.

## Depends On
Module 2 ride data; Module 1 reputation/Host Impact; Google Maps/Places/Routes.

## Current Status
Search UI code exists in `Development`. Do not conclude the module is unimplemented based only on placeholder routing.

## Open Questions
Exact Google APIs; multi-leg algorithm; transfer points; transfer rules; route-matrix quota/cost; favourite persistence; matched-ride discoverability.

## Source Warning
The original Module 4 document contains copied Module 5 content before its actual Module 4 requirements. Do not treat that copied content as Module 4 ownership.
