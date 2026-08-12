# DECISIONS.md

## Path Convention

All paths are relative to the `carshare-pwa/` application root unless explicitly stated otherwise.

This file records important project decisions only.

Do not use it for trivial implementation choices.

---

## Status
- **Proposed** — under discussion.
- **Accepted** — current project direction.
- **Superseded** — replaced by a newer accepted decision.
- **Rejected** — explicitly considered but not selected.

## D001 — Mobile-First PWA
**Status:** Accepted
Let's Tumpang is developed as a Progressive Web Application.

## D002 — Supabase as the Real Backend Baseline
**Status:** Accepted
Supabase is the current backend/data platform direction. Mock/local data may support prototype/demo behaviour but is not the final shared multi-user backend.

## D003 — Google Maps Platform Replaces Earlier OSM Direction
**Status:** Accepted
Google Maps Platform is the current mapping direction. Earlier Leaflet/OpenStreetMap/OSRM assumptions are outdated unless independently re-accepted.

## D004 — Proposal/Module Docs Are Requirement References, Not Frozen Implementations
**Status:** Accepted
Academic intent must be preserved, but implementation details should be validated against current code and current decisions.

## D005 — Shared Core + Per-Module AI Context
**Status:** Accepted

Keep agent entry files at application root:

```text
AGENTS.md
CLAUDE.md
```

Keep shared AI context in:

```text
docs/ai/
```

Keep per-module context in:

```text
docs/ai/modules/
```

Agents should load only relevant context.


## D006 — Karpathy 4 Rules
**Status:** Accepted
Use Think Before Coding, Simplicity First, Surgical Changes, Goal-Driven Execution.

## D007 — Preserve Existing Top-Level Source Layering for Now
**Status:** Accepted
Keep `src/presentation/`, `src/business-logic/`, `src/data-access/`, and `src/context/` unless a concrete accepted need justifies a structural refactor.

## D008 — `Development` Is the Shared Integration Branch
**Status:** Accepted
Use `Development` for integration and `main` for stable/demo-ready code. Do not assume lowercase `development` or `dev` examples match the real repo.

## D009 — AI Context Paths Are Application-Root Relative
**Status:** Accepted

All paths written in AI context documents are interpreted relative to:

```text
carshare-pwa/
```

unless explicitly stated otherwise.

**Why**
This avoids fragile `../` and `../../` references when context files are moved within `docs/ai/`.

---

## D010 — Module 1 and Module 2 Initial Supabase Schema
**Status:** Accepted
`database/sql/001-015` is the deployed history for Module 1 and Module 2. The
original `001-007` drafts are kept as history; `008-012` harden the first slice,
and `013-015` add the accepted ride/request/lifecycle/review model.

## D011 — Supabase Scope and Authentication
**Status:** Accepted
The shared project is `pnetstmovctfwqcumodx`. Frontend configuration uses
`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`; the old anon-key name
is compatibility-only. This slice uses email/password with email verification.
Phone OTP, Google OAuth, account hard deletion, and Messaging Realtime are
deferred. Modules 3-6 retain their local adapters.

## D012 — Module 2 Lifecycle and Participation Contract
**Status:** Accepted
`departure_at` is the authoritative UTC ride instant and the application displays
it in `Asia/Kuala_Lumpur`. A request can include its account holder plus named
companions; only the account holder participates in access and reviews. Pending
requests do not reserve seats, acceptance is all-or-nothing and transactional,
and new requests stop five hours before departure. Module 2 owns lifecycle state
through `Matched`; only a trusted service-role Module 6 pipeline may move a ride
to `In Transit` or `Completed`. Reviews are mutual between the Host and each
accepted account holder and update only the public average star rating.

## D013 — Zero-Charge-First Google Maps Integration
**Status:** Accepted
The initial mapping integration uses only Maps Embed API directions mode because
Google documents it as no-charge with unlimited requests. A dedicated browser
key must be restricted both to approved website referrers and to Maps Embed API.
The application keeps its local map fallback when that key is absent or offline.
Places, Routes, Geocoding, Dynamic Maps, traffic data, and other billable SKUs
must not be enabled or added without a separate team decision and cost-control
review. Budget alerts are notifications, not the Maps spending boundary.

## D014 — Shared Mobile-First UI Contract
**Status:** Accepted
`docs/ai/UI.md` is the shared cross-module UI/UX contract. Phone is the primary
design target; tablet and desktop use intentional responsive reflow rather than
stretched phone layouts. `src/presentation/styles/theme.css` remains the runtime
source of truth for exact implemented token values. Files under `docs/figma/`
are design references and do not silently override accepted decisions, this
contract, or verified current implementation.

## Open Decisions
- database schemas/RLS for Modules 3-6;
- billable Google Maps features such as autocomplete and coordinate persistence;
- production Module 6 verification pipeline integration;
- messaging persistence/realtime architecture;
- reputation and Host Impact formulas;
- carbon model;
- complete offline behaviour;
- deployment workflow cleanup;
- long-lived module branches vs short-lived feature branches.
