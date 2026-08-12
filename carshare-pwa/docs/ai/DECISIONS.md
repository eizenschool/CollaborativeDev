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

## D010 — Module 1 Supabase Schema Drafted as Numbered SQL Files
**Status:** Proposed
`database/sql/001-005` draft `profiles`, `vehicles`, `host_impact_stats`,
the `handle_new_user` trigger, and RLS for Module 1, matching what
`AuthService.js`/`ProfileService.js`/`VehicleService.js`/`HostImpactEngine.js`
already query. `006-007` draft `rides` (Module 2) alongside them so Module
1's Sign Up → Profile → Ride Hub flow is demoable end-to-end; Module 2's
owner (Yee Zu Yao) should confirm or adjust `006-007` before the team
treats them as final. Not yet run against a live Supabase project. Moves
"final database schema/RLS" below from undiscussed to "drafted, pending
team review" - still Proposed, not Accepted, until the team reviews it.

## Open Decisions
- final ride/trip domain model;
- final database schema/RLS (drafted in D010, pending team review);
- detailed Google Maps integration;
- shared lifecycle contract;
- messaging persistence/realtime architecture;
- reputation and Host Impact formulas;
- carbon model;
- complete offline behaviour;
- deployment workflow cleanup;
- long-lived module branches vs short-lived feature branches.
