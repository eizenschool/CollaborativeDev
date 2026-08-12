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
6. Trust & Safety

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
npm test
npm run build
npm run preview
```

## Current Source Structure
```text
src/
├── App.jsx
├── main.jsx
├── context/
├── presentation/
├── business-logic/
└── data-access/
```

Current architectural boundary:
```text
Presentation -> Business Logic -> backend/data adapters
```
Presentation code must not directly import/use Supabase.
Existing business-logic services may use the shared Supabase client from `src/data-access/supabaseClient.js`.
Do not replace this established pattern with a new repository architecture unless a concrete need is accepted.

## Current Implementation Reality
`Development` already contains implementation from several modules, including Module 1 profile/auth/vehicle/reputation-related UI and services, Module 2 ride-management components, Module 3 messaging UI/data prototypes, Module 4 search UI components, Module 5 trip/eco components, and Module 6 safety/verification logic and UI.

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
