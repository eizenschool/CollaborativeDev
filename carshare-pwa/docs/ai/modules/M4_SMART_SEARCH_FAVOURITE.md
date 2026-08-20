# Module 4 — Smart Search & Favourite

## Owner
Eizen Lim Hoe Yuen

## Purpose
Advanced search, filters, favourites, alternative/multi-leg suggestions, and route-related discovery.

## Requirement Intent
Advanced search, event/cultural/culinary proximity, filters, journey-scale filtering, favourites, alternative routes, Host Impact sorting, unavailable notifications, multi-leg suggestions.

## Existing Repository Areas
Presentation: `src/presentation/components/search/` including `SearchModule.jsx`, `SearchForm.jsx`, `RideCards.jsx`.
The public `/search` route is the application's sole ride-listing surface.

## Depends On
Module 2 ride data; Module 1 reputation/Host Impact; Google Maps/Places/Routes.

For FR-6.35, Module 4 consumes the URL parameters defined in
`docs/ai/FR-6.35_PREFILL_CONTRACT.md`. It pre-fills the current text-based
search fields and keeps the normal defaults when no parameters are passed.

## Current Status
The core vertical slice is implemented in `Development` and the Module 4 branch:

- `/search` is public and uses the Module 2 ride contract through
  `SmartSearchService`. URL-backed criteria cover route/date/time, journey
  scale, seats, tags, contribution, Host rating, and Host Impact sorting.
- `/favourite` is authenticated and uses `FavouriteService`. The mock adapter
  persists per-user favourites. Migration `034` defines Supabase persistence,
  owner RLS, safe RPCs, and unavailable-ride cards, but is not deployed yet.
- The old `search/` mock was rebuilt with repository-native icons and tokens,
  accessible states, a phone filter sheet, desktop filter panel, and real ride
  detail navigation. Result cards include an estimated arrival when Module 2
  provides one. Tailwind and Lucide are not required.
- Saved rides refresh when Favourite opens. Unavailable rides remain removable
  and offer a prefilled alternative search; background notifications are
  deferred.
- `/ride` is now the authenticated Module 2 management workspace. Its redundant
  basic search was retired while `SmartSearchService` continues to retrieve
  candidates through Module 2's `RideService.searchRides()` contract.
- Module 6's `buildPrefillUrl('search')` handoff targets `/search` with canonical
  pickup, destination, date, and opaque destination catalogue parameters.
  Legacy `/ride?from&to&date` links redirect without losing their values.

Business logic: `src/business-logic/SmartSearchService.js` and
`src/business-logic/FavouriteService.js`.

Presentation: `src/presentation/components/search/` and
`src/presentation/styles/search.css`.

Database: `database/sql/034_m4_smart_search_favourites.sql` (undeployed).

## Open Questions
Deferred beyond the core slice: vehicle-type and spoken-language contracts;
landmark/event proximity; multi-leg matching and transfer rules; Routes/Distance
Matrix quota and cost; realtime or push notification delivery.

Public live Supabase search uses the safe anonymous browsing policy in migration
`023`. Environments without those grants must surface the service error rather
than silently substituting mock results.

## Source Warning
The original Module 4 document contains copied Module 5 content before its actual Module 4 requirements. Do not treat that copied content as Module 4 ownership.
