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
Official database schema: Not started
Official SQL history: Empty
```

The existing files:

```text
docs/SUPABASE-SETUP.md
docs/MODULE6-SCHEMA.md
```

are drafts only.

Do not treat them as the final database design unless the team explicitly adopts part of them later.

## SQL History

No official SQL file has been created yet.

When database development starts, create numbered SQL files in:

```text
database/sql/
```

Example:

```text
001_m1_create_profiles.sql
002_m1_create_vehicles.sql
003_m2_create_rides.sql
004_m2_create_ride_requests.sql
```

The ordered `.sql` files themselves form the SQL development history.

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

None confirmed yet.

### RLS

None confirmed yet.

### Functions / RPC

None confirmed yet.

### Triggers

None confirmed yet.

### Indexes

None confirmed yet.

## SQL File Map

No official SQL files yet.

Add entries here only after real SQL files exist.

Example:

```text
- database/sql/001_m1_create_profiles.sql
  - Creates the profiles table for Module 1.
```

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
