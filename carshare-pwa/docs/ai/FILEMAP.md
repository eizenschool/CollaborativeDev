# FILEMAP.md

Shared / cross-module navigation only. Detailed module files belong in `docs/ai/modules/Mx_*.md`.

## Application Entry / Routing
- `src/main.jsx` — React entry.
- `src/presentation/shared/app/App.jsx` — shared routing and cross-module integration point.

## Shared Authentication Context
- `src/presentation/shared/context/AuthContext.jsx` — shared authenticated-user state.
- `src/presentation/shared/context/NotificationContext.jsx` — shared recipient inbox, unread state,
  and per-device push permission/subscription state.
- `src/presentation/m3-messaging/context/` — Module 3 messaging and active-call session state.

## Shared Presentation
- `docs/ai/UI.md` — shared mobile-first UI/UX, responsive, component, and accessibility contract.
- `src/presentation/shared/components/nav/` — shared navigation.
- `src/presentation/shared/components/ui/` — presentation-only buttons, page/card/
  field/status/async primitives, adaptive dialog, and route state boundaries.
- `src/presentation/shared/components/icons.jsx` — shared icons.
- `src/presentation/shared/styles/theme.css` — shared tokens, app shell, navigation, and common layout.
- `src/presentation/m1-profile/` through `src/presentation/m6-discovery/` — module-owned JSX, hooks, and styles.
- `playwright.config.js`, `.env.fixture`, and `tests/e2e/` — deterministic
  no-key UI acceptance at the four required viewports, including axe and
  stable screenshot checks.

## Shared Integration Contracts
- `docs/ai/FR-6.35_PREFILL_CONTRACT.md` — accepted URL-based Module 6 destination handoff consumed by Modules 2 and 4.

## Business Logic
- `src/business-logic/shared/` — genuinely cross-module services such as mapping, notifications, sounds, and place photos.
- `src/business-logic/m1-profile/` through `src/business-logic/m6-discovery/` — module-owned policies and services.
- `src/business-logic/m6-discovery/discovery/` — Module 6 place scoring, lifecycle, seasonal calendar, and chain detection.
- `supabase/functions/m6-ingest/` — server-side Module 6 Nearby Search sweep, Place Details enrichment, and catalogue upsert; reads `GOOGLE_PLACES_SERVER_KEY` only from Supabase secrets.
- `src/business-logic/m6-discovery/discovery/PlaceQueryService.js` — public source-hint lookup plus radius and route-corridor place queries served to Modules 2 and 4.
- `src/business-logic/m2-rides/verification/` — trip verification logic from the former Trust & Safety scope; see `docs/ai/modules/TRUST_SAFETY_HANDOVER.md`.
- `src/business-logic/shared/GoogleMapsEmbedService.js`, `GooglePlacesService.js`, and `PlacePhotoService.js` — shared mapping/place boundaries.
- `src/business-logic/m2-rides/RidePickupPhotoService.js` — validates and orchestrates the single private Ride pickup photo.
- `src/business-logic/m1-profile/CompatibilityOptions.js`, `ReputationPolicy.js`, `ReputationService.js`, and `PublicProfilePolicy.js` — Module 1 profile and trust rules.
- `src/presentation/m1-profile/PublicProfile.jsx` — `/users/:userId` public trust profile linked by Modules 2-4.
- `src/business-logic/m4-search/` — Module 4 criteria, multi-leg, recommendation, and favourite rules.
- `src/business-logic/shared/NotificationService.js` — shared notification mapping,
  safe action paths, unread count, and Web Push subscription orchestration.

## Shared Mapping
- `src/presentation/shared/components/maps/` — shared confirmed-location and route-map presentation.
- `src/presentation/m2-rides/components/ride/DestinationRidePhoto.jsx` — shared-consumer lazy destination photo owned by Module 2.
- `src/presentation/m2-rides/components/ride/PickupPhotoField.jsx` and `src/presentation/shared/hooks/usePhotoCapture.js` — meeting-point field and shared capture lifecycle.
- `docs/GOOGLE-MAPS-SETUP.md` — Cloud project, restricted-key, environment, and cost-safety setup.

## Data Access / Backend Adapters
- `src/data-access/shared/supabase/supabaseClient.js` — shared Supabase client/configuration; module services do not import it directly.
- `src/data-access/shared/fixture/legacyMockDataStore.js` — atomic cross-module offline fixture foundation. Module services use their module-owned mock facades.
- `src/data-access/m1-profile/` through `src/data-access/m6-discovery/` — module-owned Supabase, repository, mock, fixture, and persistence adapters.
- `src/data-access/m2-rides/verificationFixtureStore.js` — Module 2 trip-verification prototype store (former Trust & Safety scope).
- `src/data-access/m2-rides/familyLocationShareAdapter.js` — Module 2 Family Live Share Edge Function transport.
- `src/data-access/m6-discovery/weatherForecastAdapter.js` and
  `streetViewCoverageAdapter.js` — Module 6 external HTTP transports; fixture/test builds stay offline unless a test injects a transport.
- `src/data-access/m3-messaging/legacy/` — unused messaging prototype data retained for history.
- `src/data-access/shared/notifications/supabaseNotificationRepository.js` — shared notification
  inbox, read-state RPC, Realtime, and device-subscription Edge Function adapter.
- `supabase/functions/notification-subscriptions/` and
  `supabase/functions/notification-push/` — authenticated device registration
  and webhook-authenticated VAPID delivery; secrets remain server-only.
- `supabase/functions/m2-ride-pickup-photo/` — visibility-checked five-minute
  signed URL for the private `ride-pickup-photos` bucket.
- `database/sql/` — numbered schema/RLS/trigger SQL files; see `docs/ai/SQL.md` for the current file map before reading these directly.

## Module Context
- M1 → `docs/ai/modules/M1_PROFILE_REPUTATION.md`
- M2 → `docs/ai/modules/M2_RIDE_SHARING.md`
- M3 → `docs/ai/modules/M3_MESSAGING.md`
- M4 → `docs/ai/modules/M4_SMART_SEARCH_FAVOURITE.md`
- M5 → `docs/ai/modules/M5_TRIP_ECO.md`
- M6 → `docs/ai/modules/M6_DESTINATION_DISCOVERY.md`
- Former Trust & Safety scope → `docs/ai/modules/TRUST_SAFETY_HANDOVER.md`

## Existing Technical Documentation
- `docs/SUPABASE-SETUP.md` — existing Supabase setup notes; validate before treating as canonical.
- `docs/MODULE6-SCHEMA.md` — superseded draft for the former Trust & Safety scope; not Module 6's current schema.
- `docs/MODULE6-API-SETUP.md` — every external request Destination Discovery makes, with field-mask billing tiers, quotas, and outstanding console work.
- `docs/MODULE6-HANDOVER.md` — full Module 6 handover: current state, load-bearing design decisions, boundaries, FR coverage, outstanding human actions, and the traps already hit. Read this first when picking Module 6 up cold.

Keep this file short. Do not list every source file.
