# Let's Tumpang — Module 1 (User Profile & Reputation) PWA

This is a working build of **Module 1 only** (Sign Up/Login, Profile Settings, My
Vehicles, Reputation, Host Dashboard), implemented against the three-tier
architecture from section 3.1 of the proposal, and structured so Modules 2–6 can be
added later without restructuring Module 1.

## For marking — the three layers at a glance

Every file under `src/` opens with a `// ===== ... LAYER =====` banner comment
identifying which layer it belongs to. Folder names match the layer names directly:

| Markable layer | Folder | Files |
|---|---|---|
| **Presentation** | `src/presentation/` | `components/AuthPage.jsx`, `ProfileSettings.jsx`, `MyVehicles.jsx`, `Reputation.jsx`, `HostDashboard.jsx`, `Sidebar.jsx` + `styles/theme.css`, `auth.css` |
| **Business Logic** | `src/business-logic/` | `AuthService.js`, `ProfileService.js`, `VehicleService.js`, `HostImpactEngine.js` |
| **Data Access** | `src/data-access/` | `supabaseClient.js` (real backend), `mockDataStore.js` (offline fallback so the app is markable without a live Supabase project) |

`src/App.jsx`, `src/main.jsx`, and `src/context/AuthContext.jsx` are routing/wiring
glue that sits above all three layers rather than inside one — each says so in its
own banner comment.

**The enforced rule:** Presentation only imports from Business Logic (and the
AuthContext wrapper) — never from Data Access. Business Logic is the only layer
that imports Data Access. Data Access is the only layer that imports the Supabase
SDK. That chain is what section 3.1.5 of the proposal calls the three-tier
separation rule, and it's unbroken throughout this codebase.

## Run it

```bash
npm install
npm run dev       # http://localhost:5173
```

No Supabase project is required to try it — see "Backend modes" below.

To build the installable PWA bundle:

```bash
npm run build
npm run preview
```

## Folder layout ↔ the three-tier architecture

| Folder | Tier (3.1.x) | Rule enforced |
|---|---|---|
| `src/presentation/` | 3.1.1 Frontend/GUI Layer | Only imports from `src/business-logic` and `src/context`. Never imports `src/data-access` (3.1.5.a). |
| `src/business-logic/` | 3.1.2 Business Logic Layer | `AuthService`, `ProfileService`, `VehicleService`, `HostImpactEngine` — validate input and shape data before/after it reaches Supabase (3.1.5.b). |
| `src/data-access/` | 3.1.3 Data Processing Layer | `supabaseClient.js` is the **only** file that imports `@supabase/supabase-js`. `mockDataStore.js` is a dev-only fallback, not a real answer to 3.1.3(a) — see below. |
| `vite.config.js` | 3.1(a) Offline resilience | `vite-plugin-pwa` service worker: precaches the app shell, cache-first for map tiles, network-first (GET only) for Supabase reads. Writes are never cached, so offline is read-only exactly as specified. |

## Backend modes

- **No `.env`** (default): every service in `src/business-logic` transparently
  falls back to `src/data-access/mockDataStore.js`, an in-memory + `localStorage`-backed
  store, so all five Module 1 screens are fully clickable with no setup. This
  exists purely so the prototype runs standalone for demos/marking — it is **not**
  a substitute for the real architecture. The proposal's own reasoning in 3.1.3(a)
  (localStorage is single-browser and can't support a Host on one device being
  found by a Client on another) still holds; that's why this file is confined to
  `src/data-access/` and never referenced from `src/presentation/`.
- **With `.env`** (copy `.env.example`, fill in a real Supabase project's URL/anon
  key): the same service functions call Supabase Auth / Postgres / Storage
  instead. No component code changes — only `src/data-access/supabaseClient.js` and the
  `if (isSupabaseConfigured)` branches in each service are backend-specific.

To go live, you'd still need to create the Supabase tables this code expects
(`profiles`, `vehicles`, `host_impact_stats`) and their RLS policies — that's a
Design Phase / Supabase-project task, not something a static code handoff can set
up for you.

## What's deliberately out of scope here

Per the brief ("Module 1 only to compatible other modules"), nothing from
Modules 2–6 is implemented — the "Publish New Ride" button and the Reputation
screen's trip-history note are explicit stubs pointing at where those modules
plug in later. Also out of scope, per the proposal itself:

- Leaflet.js / OSRM / Turf.js (Module 4) — not wired in; the offline caching rule
  for map tiles in `vite.config.js` is pre-configured for whenever they are.
- Microsoft Translator / Web Speech API (Module 3) — the security note in 3.1.3(f)
  is honoured in `supabaseClient.js`'s comments so whoever builds Module 3 doesn't
  accidentally import the translator key into client code.
- True closed-app push notifications (3.1.4) — documented in the proposal as a
  stated limitation, not attempted here.

## Demo credentials (mock backend only)

- Existing account: `jamie@letstumpang.app` (any password — the mock store doesn't
  actually verify password hashes, only real Supabase Auth does that)
- Sign-up duplicate-error demo: try signing up with `test@example.com`
