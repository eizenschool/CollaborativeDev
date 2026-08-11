# FILEMAP.md

Shared / cross-module navigation only. Detailed module files belong in `docs/ai/modules/Mx_*.md`.

## Application Entry / Routing
- `src/main.jsx` — React entry.
- `src/App.jsx` — shared routing and cross-module integration point.

## Shared Authentication Context
- `src/context/AuthContext.jsx` — shared authenticated-user state.

## Shared Presentation
- `src/presentation/components/nav/` — shared navigation.
- `src/presentation/components/icons.jsx` — shared icons.
- `src/presentation/styles/` — shared and module style files.

## Business Logic
- `src/business-logic/` — business-rule/service layer, including Module 6 verification logic.

## Data Access / Backend Adapters
- `src/data-access/supabaseClient.js` — shared Supabase client/configuration.
- `src/data-access/mockDataStore.js` — mock/local prototype store.
- `src/data-access/mockMessageData.js` — messaging prototype/mock data.
- `src/data-access/module6Store.js` — Module 6 prototype store.

## Module Context
- M1 → `docs/ai/modules/M1_PROFILE_REPUTATION.md`
- M2 → `docs/ai/modules/M2_RIDE_SHARING.md`
- M3 → `docs/ai/modules/M3_MESSAGING.md`
- M4 → `docs/ai/modules/M4_SMART_SEARCH_FAVOURITE.md`
- M5 → `docs/ai/modules/M5_TRIP_ECO.md`
- M6 → `docs/ai/modules/M6_TRUST_SAFETY.md`

## Existing Technical Documentation
- `docs/SUPABASE-SETUP.md` — existing Supabase setup notes; validate before treating as canonical.
- `docs/MODULE6-SCHEMA.md` — Module 6 schema notes; validate against actual database state.

Keep this file short. Do not list every source file.
