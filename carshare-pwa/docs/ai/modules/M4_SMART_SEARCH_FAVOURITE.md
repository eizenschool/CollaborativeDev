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
  provides one. Applied filters are removable wrapping chips; the phone sheet
  uses the shared adaptive focus/return contract. Tailwind and Lucide are not
  required.
- Every Search result Driver row links to Module 1's safe public profile. The
  Ride card keeps minimum active-Driver identity for trust; optional profile
  fields are filtered by the Module 1 visibility projection.
- Favourite now uses the shared loading, empty, error, and action primitives
  while keeping refresh, removal, and alternative-search service behaviour.
- Saved rides refresh when Favourite opens. Unavailable rides remain removable
  and offer a prefilled alternative search. Deployed migration `067` now emits
  one deduplicated shared in-app/Web Push notification per user, ride, and
  availability transition, with the on-open warning retained as fallback.
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
  Any but do not match a specific choice. Migration `039` was deployed on
  2026-08-27. Its compatibility RPC, nullable columns, constraints, and owner
  update grants are live; the fallback remains for environments that have not
  applied the migration.
- When no suitable direct ride survives the applied criteria, Search now asks
  for a two-leg alternative. Both Published rides must have seats, stored ETAs,
  confirmed endpoints, and satisfy every selected filter. Transfers are limited
  to recommendable Module 6 cultural destinations or catalogue rest stops.
  Leg 2 must follow Leg 1's ETA; if either leg is Intercity, the transfer must be
  at least three hours. The card and keyboard-contained itinerary expose only
  safe route/Host/schedule data and open each real ride independently. Migration
  `068` is deployed; no paid Routes request is made for matching.

Business logic: `src/business-logic/SmartSearchService.js` and
`src/business-logic/FavouriteService.js`.

Search and Favourite hydrate destination Place IDs with Module 2's bounded
batch RPC, then share `DestinationRidePhoto` with the `/ride` workspace. Photos
load only near the viewport, retain all existing route/Host/status text over a
fixed contrast scrim, include Google/photographer attribution, and fall back to
the original white-green card when unavailable. Pickup meeting photos never
appear on cards.

Presentation: `src/presentation/components/search/` and
`src/presentation/styles/search.css`.

Database: `database/sql/034_m4_smart_search_favourites.sql` and
`database/sql/035_m4_destination_proximity_search.sql` (both deployed and
verified), plus deployed `039_m4_vehicle_language_filters.sql`,
`040_m4_favourites_advisor_followup.sql`,
`067_m4_favourite_unavailable_notifications.sql`, and
`068_m4_multi_leg_journey_search.sql`. Post-deployment advisors reported no new
Module 4 security finding. The new favourite/transfer indexes are initially
reported as unused, which is expected before normal production traffic.

## Open Questions
Remaining acceptance work is operational rather than another feature slice:
two-account notification/push verification, owner-edit verification, and a
live dataset containing a valid two-leg chain. Route-corridor matching remains
outside Module 4, and multi-leg matching deliberately uses stored schedules
rather than paid Routes/Distance Matrix calls.

Public live Supabase search uses the safe anonymous browsing policy in migration
`023`. Environments without those grants must surface the service error rather
than silently substituting mock results.

## Source Warning
The original Module 4 document contains copied Module 5 content before its actual Module 4 requirements. Do not treat that copied content as Module 4 ownership.
