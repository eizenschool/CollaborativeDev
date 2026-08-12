# SQL.md

## Purpose

This file is the AI navigation guide for the Let's Tumpang database.

Actual SQL code must be stored in:

```text
database/sql/
```

This file should stay short. It tells Codex / Claude Code:

- whether database work has started;
- which SQL files already exist;
- what the current confirmed database state is;
- which SQL files are relevant to the current task.

Do not store the full SQL history inside this file.

## Current Status

```text
Supabase connected: No
Official database schema: Drafted (Module 1 tables + trigger + RLS; Module 2 rides table drafted alongside, pending M2 owner confirmation)
Official SQL history: 001-007, see SQL File Map below
```

`docs/SUPABASE-SETUP.md` now documents these seven files directly (its
"Run the schema" section links to them file-by-file) and is no longer just a
draft for Module 1's part - Module 1's owner has adopted 001-005 as the
working schema for that module. `docs/MODULE6-SCHEMA.md` is still a draft.

The 006/007 (Module 2 `rides`) files are drafted, not yet confirmed by
Module 2's owner - see D0XX in `docs/ai/DECISIONS.md`. Do not treat them as
final until that review happens.

None of this has been run against a live Supabase project yet - "Supabase
connected: No" stays No until someone actually creates the shared project
and executes these files (see `docs/SUPABASE-SETUP.md` "Working as a team").

## SQL History

Numbered SQL files exist in:

```text
database/sql/
```

Current files (see "SQL File Map" below for what each does). The ordered
`.sql` files themselves form the SQL development history.

A separate SQL history document is not required during development.

## Rules for New Database Work

1. Plan the required database change first.
2. Create the next numbered `.sql` file in `database/sql/`.
3. Keep the SQL file focused on one meaningful database change.
4. Before the SQL file is accepted/committed, it may still be edited.
5. After later SQL files depend on it, do not silently rewrite the old history.
6. For a later database change, create a new numbered SQL file instead.
7. Update this `SQL.md` with the current confirmed database state and SQL file map.
8. Do not invent tables, columns, RLS policies, functions, or triggers before the relevant feature requires them.

## SQL File Naming

Use:

```text
NNN_mX_short_description.sql
```

Examples:

```text
001_m1_create_profiles.sql
002_m2_create_rides.sql
003_m3_create_messages.sql
```

For project-wide database work:

```text
NNN_project_short_description.sql
```

## Current Database State

### Tables

Drafted, not yet run on a live project: `profiles`, `vehicles`,
`host_impact_stats` (Module 1), `rides` (Module 2, pending M2 confirmation).

### RLS

Drafted for all four tables above (005, 007). `host_impact_stats` has no
client insert/update/delete policy at all by design - only a future
service-role pipeline should write to it.

### Functions / RPC

`public.handle_new_user()` drafted (004) - mirrors a new `auth.users` row
into `profiles` + `host_impact_stats` on sign-up.

### Triggers

`on_auth_user_created` drafted (004) - fires `handle_new_user()` after
insert on `auth.users`.

### Indexes

None beyond the primary keys/foreign keys implied by the table definitions.
No additional indexes confirmed yet.

## SQL File Map

- `database/sql/001_m1_create_profiles.sql` - Creates `profiles` (Module 1).
- `database/sql/002_m1_create_vehicles.sql` - Creates `vehicles` (Module 1).
- `database/sql/003_m1_create_host_impact_stats.sql` - Creates `host_impact_stats` (Module 1).
- `database/sql/004_m1_handle_new_user_trigger.sql` - `handle_new_user()` function + `on_auth_user_created` trigger (Module 1).
- `database/sql/005_m1_enable_rls.sql` - RLS + policies for `profiles`, `vehicles`, `host_impact_stats` (Module 1).
- `database/sql/006_m2_create_rides.sql` - Creates `rides` (Module 2, drafted for Module 1's end-to-end demo; needs M2 owner confirmation).
- `database/sql/007_m2_enable_rls.sql` - RLS + policies for `rides` (Module 2, same confirmation note as 006).

## Security

- Never commit `.env`.
- Never expose Supabase service-role/server secrets in frontend code.
- Use browser-safe/public configuration only in the frontend.
- Add RLS when the real schema and access rules require it.

## Submission Note

The lecturer can review the complete SQL development history directly from:

```text
database/sql/
```

If a single combined SQL document is required for final submission, generate it from the numbered SQL files at that time instead of manually maintaining duplicate SQL code.
