# AGENTS.md

## Purpose

This file defines how AI coding agents should work inside the Let's Tumpang application.

Application root: `carshare-pwa/`

All paths mentioned in AI context files are relative to the `carshare-pwa/` application root unless explicitly stated otherwise.

The repository is developed by six team members using module branches and GitHub integration. Codex and Claude Code must follow the same project rules.

## Core Working Philosophy — Karpathy 4 Rules

### 1. Think Before Coding
- Do not silently assume missing requirements.
- Surface uncertainty, assumptions, and trade-offs.
- If multiple reasonable interpretations exist, state them.
- If a simpler approach exists, mention it.
- If a requirement is unclear and the choice has long-term or cross-module impact, stop before making the decision.
- If proposal/module documents conflict with the current repository, identify the conflict before proceeding.
- For small, obvious, reversible implementation details, use reasonable judgment instead of asking unnecessary questions.

### 2. Simplicity First
- Implement the smallest solution that satisfies the current requirement.
- Do not add speculative features.
- Do not create abstractions only for hypothetical future use.
- Avoid unnecessary dependencies.
- Prefer readable, maintainable code over clever architecture.
- Reuse established repository patterns when they are reasonable.
- If a solution becomes much larger than the problem requires, simplify it.

### 3. Surgical Changes
- Change only what is necessary for the current task.
- Do not refactor unrelated working code.
- Match existing project structure and style unless the task explicitly changes them.
- Do not clean up unrelated comments, formatting, or dead code.
- Remove unused code only when the current change created it.
- Mention unrelated problems separately instead of fixing them automatically.

Every changed line should be explainable by the current task.

### 4. Goal-Driven Execution
Before non-trivial implementation, define verifiable success criteria.

```text
1. Step -> verify: expected check
2. Step -> verify: expected check
3. Step -> verify: expected check
```

For bugs:

```text
reproduce -> identify root cause -> fix -> targeted verification
```

A task is not complete only because code was written. Verify the requested behaviour.

## Team / Module Model

Let's Tumpang has six development modules:
1. User Profile & Reputation
2. Ride Sharing Management
3. Messaging
4. Smart Search & Favourite
5. Trip Management & Eco Impact
6. Trust & Safety

Each module has a compact context file under `docs/ai/modules`.
Use the module file as the first specialised context for module work.
Do not read all six module files by default.

## Context Reading Strategy

### Default module task
```text
AGENTS.md
  -> docs/ai/modules/Mx_*.md
  -> relevant source files
```

Use `docs/ai/FILEMAP.md` when locating shared or cross-module files.
Read `docs/ai/UI.md` before changing UI/UX, presentation styling, responsive
behaviour, accessibility, shared navigation/components, or implementing a Figma
design. Then read only the relevant module context and source files.
Read `docs/ai/TODO.md` only when project-level coordination or integration status matters.
Read `docs/ai/PROJECT.md` when project purpose, stack, commands, architecture, or several modules matter.
Read `docs/ai/MEMORY.md` when a stable project preference or long-term fact may affect the work.
Read `docs/ai/DECISIONS.md` when making/changing an important technical decision or shared contract.
For database work, read `docs/ai/SQL.md` first.
Actual SQL code and SQL history are stored in `database/sql/`.
Read only the relevant numbered `.sql` files when needed.

### Cross-module tasks
Read only the module files directly involved.
Example: M2 acceptance -> M3 conversation creation means read M2 + M3, not all modules.

## Repository Reality First
1. Inspect the relevant current files.
2. Prefer current verified repository behaviour over outdated documentation.
3. Do not assume a module branch is current; compare it against `Development` when necessary.
4. Do not invent file paths or APIs that do not exist.
5. Update context when real file responsibility changes.

The current repository already uses:
```text
src/presentation/
src/business-logic/
src/data-access/
src/context/
```
Do not restructure these folders unless the task explicitly requires an architecture change.

## Current Architecture Rule
The project follows a three-tier separation:
```text
Presentation -> Business Logic -> Data Access / backend adapter
```
Current repository reality includes business-logic services importing the shared Supabase client from `src/data-access/supabaseClient.js`.
Therefore:
- Presentation must not import `src/data-access/` directly.
- Presentation should call business-logic services.
- Keep backend-specific access out of presentation components.
- Do not introduce a repository-per-domain abstraction unless a real task justifies it.

## Flexible Planning Rule
The original proposal and module documents define academic intent and early design ideas. They are requirement references, not automatically final implementation designs.
For new, ambiguous, cross-module, database, security, architecture, or third-party integration work:
1. Understand the requirement intent.
2. Inspect the current implementation.
3. Check relevant accepted decisions.
4. Identify conflicts, assumptions, and missing information.
5. Propose the simplest reasonable plan.
6. Define success criteria.
7. Discuss important long-term choices before treating them as final.
8. Implement after the plan is sufficiently clear.
Do not silently discard academic requirements.

## Database / SQL Rules

`docs/ai/SQL.md` is the AI database map and current-state summary.

Actual SQL code and database history must be stored in:

```text
database/sql/
```

Current database status:

- Supabase is not connected yet.
- No official database schema has been confirmed yet.
- Existing database documents such as `docs/SUPABASE-SETUP.md` and `docs/MODULE6-SCHEMA.md` are drafts only unless the team explicitly adopts them.

For database work:

1. Read `docs/ai/SQL.md` first.
2. Inspect the relevant module context and current code.
3. Plan the smallest required database change before writing SQL.
4. Store the actual SQL in the next numbered file under `database/sql/`.
5. Use this naming format:

```text
NNN_mX_short_description.sql
```

Examples:

```text
001_m1_create_profiles.sql
002_m1_create_vehicles.sql
003_m2_create_rides.sql
```

6. Before a SQL file is accepted or committed, it may still be edited.
7. After later SQL files depend on it, do not silently rewrite old SQL history. Create a new numbered `.sql` file for the new change.
8. After a confirmed database change, update `docs/ai/SQL.md` with the current database state and SQL file map.
9. Do not store the full SQL code or full SQL history inside `docs/ai/SQL.md`.
10. Do not invent tables, columns, RLS policies, functions, triggers, or indexes before the relevant feature requires them.
11. Once Supabase is connected, do not make database changes only in the Supabase Dashboard without also recording the equivalent SQL in `database/sql/`.

## Git / Collaboration Rules
The shared integration branch is currently `Development` and `main` is for stable/demo-ready integration.
- Do not commit directly to `main`.
- Do not commit directly to `Development` unless the team explicitly decides otherwise.
- Work in the assigned module branch or a short-lived feature branch.
- Before new work, make sure the working branch is based on or synchronized with current `Development`.
- Keep PRs focused when practical.
- Mention cross-module files touched in the PR description.
- Do not modify another module's code without a concrete integration reason.

Commit convention:
```text
[ModuleX] short imperative description
```

## Documentation Ownership
Shared team truth:
```text
docs/ai/PROJECT.md
docs/ai/MEMORY.md
docs/ai/DECISIONS.md
docs/ai/TODO.md
docs/ai/FILEMAP.md
docs/ai/UI.md
docs/ai/SQL.md
```
Module owners primarily maintain:
```text
docs/ai/modules/Mx_*.md
```
Actual SQL history is stored separately in:
```text
database/sql/
```

Database structure changes should update both:

- the relevant numbered `.sql` file in `database/sql/`;
- `docs/ai/SQL.md`.

Avoid editing shared context for purely local implementation details.

## Testing Rules
- Run the smallest relevant tests first.
- Use `npm test` for targeted Vitest tests where appropriate.
- Use `npm run build` for integration/build verification when routing/bundling can be affected.
- Add a regression test for reproducible logic bugs where practical.
- Broaden testing before integration when shared behaviour changes.

## End-of-Task Output
State concisely:
1. What changed.
2. What was verified.
3. Any unresolved blocker/assumption.
4. Context files updated, if any.
