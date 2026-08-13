# FILEMAP.md

Shared / cross-module navigation only. Detailed module files belong in `docs/ai/modules/Mx_*.md`.

## Application Entry / Routing
- `src/main.jsx` — React entry.
- `src/App.jsx` — shared routing and cross-module integration point.

## Shared Authentication Context
- `src/context/AuthContext.jsx` — shared authenticated-user state.

## Shared Presentation
- `docs/ai/UI.md` — shared mobile-first UI/UX, responsive, component, and accessibility contract.
- `src/presentation/components/nav/` — shared navigation.
- `src/presentation/components/icons.jsx` — shared icons.
- `src/presentation/styles/` — shared and module style files.

## Business Logic
- `src/business-logic/` — business-rule/service layer.
- `src/business-logic/discovery/` — Module 6 place scoring, lifecycle, and chain detection.
- `src/business-logic/verification/` — trip verification logic from the former Trust & Safety scope; see `docs/ai/modules/TRUST_SAFETY_HANDOVER.md`.
- `src/business-logic/GoogleMapsEmbedService.js` — shared Embed URL builder for Place ID, coordinate, and legacy-text route references.
- `src/business-logic/GooglePlacesService.js` — Places Autocomplete, one-shot browser geolocation, and reverse-geocoding boundary.

## Shared Mapping
- `src/presentation/components/maps/GoogleRouteMap.jsx` — shared route iframe with an offline/unconfigured fallback.
- `src/presentation/components/maps/ConfirmedLocationInput.jsx` — reusable confirmed-location combobox and current-pickup confirmation UI.
- `docs/GOOGLE-MAPS-SETUP.md` — Cloud project, restricted-key, environment, and cost-safety setup.

## Data Access / Backend Adapters
- `src/data-access/supabaseClient.js` — shared Supabase client/configuration.
- `src/data-access/mockDataStore.js` — mock/local prototype store.
- `src/data-access/mockMessageData.js` — messaging prototype/mock data.
- `src/data-access/module6Store.js` — trip verification prototype store (former Trust & Safety scope).
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

Keep this file short. Do not list every source file.
