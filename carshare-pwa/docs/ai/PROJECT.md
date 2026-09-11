# PROJECT.md

## Overview

**Let's Tumpang** is a mobile-first Progressive Web Application for community-based, non-monetary ride sharing in Malaysia.

Hosts who are already travelling may publish available seats. Travellers may find/request compatible rides. The wider academic project also covers profile/reputation, messaging, smart search/favourites, eco-impact, and trust/safety.

## Team Structure

The application is developed collaboratively across six modules:
1. User Profile & Reputation
2. Ride Sharing Management
3. Messaging
4. Smart Search & Favourite
5. Trip Management & Eco Impact
6. Destination Discovery

Module 6's former Trust & Safety scope was redistributed to Modules 1, 2, 3 and 5
with tutor approval; see `docs/ai/modules/TRUST_SAFETY_HANDOVER.md`.

## Repository

Repository: `eizenschool/CollaborativeDev`

Application root: `carshare-pwa/`

Current shared integration branch: `Development`

Stable/demo branch: `main`

Module branches already exist, but branch freshness must be checked before new work because several module branches may be behind `Development`.

## Current Technology Baseline

Frontend:
- React 18
- Vite 5
- JavaScript / ES modules
- React Router
- PWA support through `vite-plugin-pwa`

Testing:
- Vitest

Backend/data:
- Supabase JS
- Supabase is the intended real backend
- the current repository also contains mock/local demo stores

Mapping:
- Google Maps Platform is the current project direction.
- Module 2 uses Maps Embed API for directions previews and a separate restricted Places/Geocoding key for confirmed Malaysia-only location selection, with legacy-text and local visual fallbacks.
- Earlier OpenStreetMap / Leaflet / OSRM planning and tile caching have been removed from the active baseline.
- Routes, Dynamic Maps, traffic-aware routing, and other unused Maps SKUs remain disabled pending a separate accepted cost-control decision.

## Current Commands
Run from `carshare-pwa/`.

```bash
npm ci
npm run dev
npm run check:layers
npm test
npm run build
npm run preview
```

## Current Source Structure
```text
src/
├── main.jsx
├── presentation/
│   ├── shared/          # app shell, UI primitives, shared contexts/styles
│   └── m1-profile/ ... m6-discovery/
├── business-logic/
│   ├── shared/
│   └── m1-profile/ ... m6-discovery/
└── data-access/
    ├── shared/          # Supabase client/config and cross-module foundations
    └── m1-profile/ ... m6-discovery/
```

Current architectural boundary:
```text
Presentation -> Business Logic -> Data Access / backend adapters
```
`src/main.jsx` is the composition root. Presentation code may import only
Presentation and Business Logic. Business Logic may import Business Logic and
Data Access, but reaches Supabase through module-owned adapters. Data Access
imports only Data Access. `npm run check:layers` enforces these directions.
React contexts are presentation state: shared auth/notification contexts live
under `presentation/shared/context`, while messaging/call session contexts live
under `presentation/m3-messaging/context`.

## Current Implementation Reality
`Development` already contains implementation from several modules, including Module 1 profile/auth/vehicle/reputation-related UI and services, Module 2 ride-management components, Module 3 messaging UI/data prototypes, Module 4 search UI components, Module 5 trip/eco components, and the safety/verification logic and UI built under
Module 6's former Trust & Safety scope, now owned by Modules 1/2/3/5
(`docs/ai/modules/TRUST_SAFETY_HANDOVER.md`). Module 6's current Destination
Discovery work is the scoring and lifecycle logic in
`src/business-logic/m6-discovery/discovery/`.

Some routes, integration points, data persistence, and real backend behaviour are incomplete or prototype/mock based.
Do not assume "not wired in App.jsx" means "not implemented anywhere".

## Requirement References
The original proposal and module documents remain academic requirement references. Preserve requirement intent, but validate implementation choices against the current repository.

## Development Philosophy
- progressive context loading;
- module-aware collaboration;
- incremental GitHub integration;
- flexible planning instead of freezing unnecessary architecture;
- Karpathy 4 Rules.
