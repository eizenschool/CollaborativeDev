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
`database/sql/001-012` is the deployed database history for the accepted first
slice: Module 1 plus ride CRUD/search. The original `001-007` drafts are kept
as history; `008-012` separate private profile data, harden Auth/RLS/grants,
configure avatars, persist waypoints, and enforce a host-owned vehicle.

## D011 — Supabase Scope and Authentication
**Status:** Accepted
The shared project is `pnetstmovctfwqcumodx`. Frontend configuration uses
`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`; the old anon-key name
is compatibility-only. This slice uses email/password with email verification.
Phone OTP, Google OAuth, account hard deletion, ride requests/reviews, and
Messaging Realtime are deferred. Modules 3-6 retain their local adapters.

## Open Decisions
- final ride/trip domain model;
- database schemas/RLS for Modules 3-6;
- detailed Google Maps integration;
- shared lifecycle contract;
- messaging persistence/realtime architecture;
- reputation and Host Impact formulas;
- carbon model;
- complete offline behaviour;
- deployment workflow cleanup;
- long-lived module branches vs short-lived feature branches.
