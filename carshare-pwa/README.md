# Let's Tumpang — Module 1 + Module 2 PWA

A working build of **Module 1 (User Profile & Reputation)** and the first pass
of **Module 2 (Ride Sharing Management)**, implemented against the three-tier
architecture from section 3.1 of the proposal, and structured so Modules 3–6
can be added later without restructuring what's here.

This document defines the coding standards, naming conventions, project architecture, and Git workflow adopted by the Let's Tumpang project. All team members shall follow these standards to ensure consistency, maintainability, and collaboration throughout the development process.

---

| Markable layer | Folder | Files |
|---|---|---|
| **Presentation** | `src/presentation/` | `components/AuthPage.jsx`, `MyProfile.jsx` (Info & Security + My Vehicles + Reputation & Impact + Account Settings, consolidated), `components/ride/` (RideHub, PublishRide, RideCard — Module 2), `components/nav/TopNav.jsx` (shared 6-item nav bar), `components/placeholders/ComingSoonScreen.jsx` (stub for not-yet-built tabs), `components/icons.jsx` (shared icon set) + `styles/theme.css`, `auth.css`, `ride.css` |
| **Business Logic** | `src/business-logic/` | `AuthService.js`, `ProfileService.js`, `VehicleService.js`, `HostImpactEngine.js` (Module 1), `RideService.js` (Module 2) |
| **Data Access** | `src/data-access/` | `supabaseClient.js` (real backend), `mockDataStore.js` (offline fallback so the app is markable without a live Supabase project) |

## Module 1 — CRUD completeness

| Entity | Create | Read | Update | Delete |
|---|---|---|---|---|
| Profile | Sign Up | `getProfile` | `updateProfileInfo`, `updateProfilePhoto`, `updateEmergencyContact` | `deleteAccount` (Account Settings) |
| Vehicles | `saveVehicle` | `listVehicles` | `saveVehicle` (edit), `setActiveVehicle` | `removeVehicle` |
| Account status | — | — | `deactivateAccount` (reactivates on next login) | `deleteAccount` |
| Reputation / Host Impact Score | — | `getImpactSummary` | — | — |

Reputation and Host Impact Score are intentionally **read-only** here — per
the proposal, they're calculated from Module 5/6 trip data, not editable by
the user directly. Account Settings (Deactivate/Delete) was the missing piece
completing CRUD on the Account entity and is now under the "Account Settings"
rail item on My Profile.

## Module 2 — what's built vs. deferred

Built: Ride Hub (Find a Ride search/results, My Rides → Hosting), and the
5-step Publish a Ride flow (Route → Schedule → Vehicle → Trip Details →
Review & Publish) — Create + Read (FR-2.1/2.3/2.5/2.6).

Deferred to a follow-up pass: Ride Detail, Request to Join / My Requests,
Manage Requests (host accept/reject), Edit Ride, Cancel Ride, Rate & Review,
and culinary/cultural waypoints — these are Screens 2, 4–8 in the Module 2
design spec and aren't wired to real data yet. "My Rides → Joining" is left
in place as an empty, ready-to-populate section for when Request to Join lands.

## Design system

`components/nav/TopNav.jsx` renders the full 6-item nav bar (Home, Search, Ride,
Message, Favourite, Profile) shared across every module — Primary Green
`#16A34A`, Poppins headings / Inter body, pill-shaped active nav states.
**Profile** and **Ride** are wired to real screens; Home/Search/Message/Favourite
render `ComingSoonScreen` until Modules 3–6 land, so the shared nav's final
shape is demonstrable without faking functionality. This pass targets the
desktop layout; the nav collapses to icon-only under 900px, but a dedicated
mobile bottom-tab layout is a follow-up, not part of this build.

`src/App.jsx`, `src/main.jsx`, and `src/context/AuthContext.jsx` are routing/wiring
glue that sits above all three layers rather than inside one — each says so in its
own banner comment.

Every module shall follow the three-tier architecture adopted by the project.

```
Presentation Layer
        ↓
Business Logic Layer
        ↓
Data Access Layer
        ↓
Supabase
```

### Layer Responsibilities

| Layer | Responsibility |
|--------|----------------|
| presentation/ | React pages, screens, forms and UI components. No direct Supabase calls. |
| business-logic/ | Validation, business rules, data processing and orchestration. |
| data-access/ | Supabase queries, insert, update and delete operations only. |

### Architecture Rules

- Presentation Layer shall never communicate directly with Supabase.
- Presentation Layer shall only communicate with Business Logic.
- Business Logic shall communicate with Data Access.
- Data Access shall be the only layer allowed to access Supabase.
- Each layer shall only communicate with its adjacent layer.

---

## 1.2 Naming Conventions

| Item | Convention | Example |
|------|------------|---------|
| React Components | PascalCase | RidePublishForm.jsx |
| Business Logic Files | camelCase, verb-first | validateRideRequest.js |
| Data Access Files | camelCase, noun + Repository | rideRepository.js |
| Variables | camelCase | rideStatus |
| Functions | camelCase | getUserReputation() |
| Constants | UPPER_SNAKE_CASE | MAX_SEATS |
| Database Tables | snake_case, plural | ride_requests |
| Database Columns | snake_case | pickup_location |

### Boolean Variables

Boolean variables shall begin with:

- is
- has
- can

Example

```javascript
isVerified
hasVehicle
canPublishRide
```

### Array Variables

| Folder | Tier (3.1.x) | Rule enforced |
|---|---|---|
| `src/presentation/` | 3.1.1 Frontend/GUI Layer | Only imports from `src/business-logic` and `src/context`. Never imports `src/data-access` (3.1.5.a). |
| `src/business-logic/` | 3.1.2 Business Logic Layer | Validates input and shapes data before/after it reaches Supabase (3.1.5.b). Snake_case Supabase columns are mapped to the camelCase shape components use, in the same service file — see `RideService.js`'s `mapRideRow` for the pattern to follow when adding Modules 3–6. |
| `src/data-access/` | 3.1.3 Data Processing Layer | `supabaseClient.js` is the **only** file that imports `@supabase/supabase-js`. `mockDataStore.js` is a dev-only fallback, not a real answer to 3.1.3(a) — see below. |
| `vite.config.js` | 3.1(a) Offline resilience | `vite-plugin-pwa` service worker: precaches the app shell, cache-first for map tiles, network-first (GET only) for Supabase reads. Writes are never cached, so offline is read-only exactly as specified. |

Example

- **No `.env`** (default): every service in `src/business-logic` transparently
  falls back to `src/data-access/mockDataStore.js`, an in-memory + `localStorage`-backed
  store, so every screen above is fully clickable with no setup — including a
  seeded marketplace of 4 other hosts' rides for the Ride Hub to browse/search.
  This exists purely so the prototype runs standalone for demos/marking — it is
  **not** a substitute for the real architecture. The proposal's own reasoning
  in 3.1.3(a) (localStorage is single-browser and can't support a Host on one
  device being found by a Client on another) still holds; that's why this file
  is confined to `src/data-access/` and never referenced from `src/presentation/`.
- **With `.env`** (copy `.env.example`, fill in a real Supabase project's URL/anon
  key): the same service functions call Supabase Auth / Postgres / Storage
  instead. No component code changes — only `src/data-access/supabaseClient.js` and the
  `if (isSupabaseConfigured)` branches in each service are backend-specific.

**Full walkthrough (creating the project, running the schema, RLS policies,
the avatars storage bucket): [`docs/SUPABASE-SETUP.md`](docs/SUPABASE-SETUP.md).**

Event handler functions shall begin with **handle**.

- Leaflet.js / OSRM / Turf.js (Module 4) — not wired in; Publish a Ride's map
  step is a static placeholder, and the offline caching rule for map tiles in
  `vite.config.js` is pre-configured for whenever they are.
- Microsoft Translator / Web Speech API (Module 3) — the security note in 3.1.3(f)
  is honoured in `supabaseClient.js`'s comments so whoever builds Module 3 doesn't
  accidentally import the translator key into client code.
- True closed-app push notifications (3.1.4) — documented in the proposal as a
  stated limitation, not attempted here.
- Module 2's Request to Join / Manage Requests / Rate & Review, and Modules 3,
  5, 6 entirely — see "Module 2 — what's built vs. deferred" above.

Use consistent CRUD naming.

- Existing account: `jamie@letstumpang.app` (any password — the mock store doesn't
  actually verify password hashes, only real Supabase Auth does that)
- Sign-up duplicate-error demo: try signing up with `test@example.com`
- The Ride Hub's "Find a Ride" tab is seeded with 4 rides from other mock hosts
  (Ahmad, Sarah, Raj, Nurul) so search/browse has something real to show without
  needing a second account to publish against.
