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
`docs/ai/FR-6.35_PREFILL_CONTRACT.md`. A Module 6 destination hint enables a
10 km confirmed-destination search by default; ordinary text links and direct
visits keep the normal exact-search defaults.

## Current Status
The core vertical slice is implemented in `Development` and the Module 4 branch:

- `/search` is public and uses the Module 2 ride contract through
  `SmartSearchService`. URL-backed criteria cover route/date/time, journey
  scale, seats, tags, contribution, Host rating, vehicle category, preferred
  Host language, and Host Impact sorting. Vehicle and language criteria are
  optional exact compatibility filters and remain URL-backed as `vehicleType`
  and `language`.
- `/favourite` is authenticated and uses `FavouriteService`. The mock adapter
  persists per-user favourites. Migration `034` defines Supabase persistence,
  owner RLS, safe RPCs, and unavailable-ride cards. Its hardened private-helper
  and public-invoker contract was deployed and live-verified on 2026-08-20.
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
  pickup, destination, date, opaque destination catalogue, and 10 km proximity
  parameters.
  Legacy `/ride?from&to&date` links redirect without losing their values.
- Search can lazily open a keyboard-contained Destination Discovery picker,
  filter its ranked results by name or heritage/culinary/nature/event category,
  and match Published rides whose confirmed destination is within 5, 10, or
  25 km. Manual destination edits leave exact text mode. Safe cards expose only
  the computed distance, never a Ride Place ID, coordinate, pickup instruction,
  waypoint, or route geometry.
- Mock proximity uses Module 6's narrow public place-query contract and fixture
  destination IDs. Configured Supabase environments call the hardened public
  invoker RPC from migration `035`, deployed and anonymously live-verified on
  2026-08-20.
- FR-4.5 vehicle and language compatibility is implemented across Search,
  owner vehicle management, Host profile editing, favourites, mock persistence,
  and safe card display. Existing rows remain unclassified: they appear under
  Any but do not match a specific choice. Migration `039` is deliberately not
  deployed pending its separate review. Until then ordinary exact/proximity
  search still falls back safely, while selecting either compatibility filter
  reports the missing deployment honestly. Saving a vehicle also falls back:
  it retries without `vehicle_type` and reports the unstored category, because
  blocking the write would take Module 1 vehicle registration - and with it
  Module 2 hosting, which requires a host vehicle - down with the filter.

Business logic: `src/business-logic/SmartSearchService.js` and
`src/business-logic/FavouriteService.js`.

Presentation: `src/presentation/components/search/` and
`src/presentation/styles/search.css`.

Database: `database/sql/034_m4_smart_search_favourites.sql` and
`database/sql/035_m4_destination_proximity_search.sql` (both deployed and
verified), plus `database/sql/039_m4_vehicle_language_filters.sql` (authored,
review pending, not deployed). Post-deployment advisors reported no Module 4
security finding; their favourite foreign-key index follow-up is authored as
`040_m4_favourites_advisor_followup.sql` and remains undeployed for review.

## Open Questions
Deferred beyond this slice: route-corridor and multi-leg matching and transfer
rules; Routes/Distance Matrix quota and cost; realtime or push notification
delivery.

Public live Supabase search uses the safe anonymous browsing policy in migration
`023`. Environments without those grants must surface the service error rather
than silently substituting mock results.

## Source Warning
The original Module 4 document contains copied Module 5 content before its actual Module 4 requirements. Do not treat that copied content as Module 4 ownership.
