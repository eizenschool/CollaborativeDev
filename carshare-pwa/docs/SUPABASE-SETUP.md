# Connecting this project to Supabase

Right now every screen runs against `src/data-access/mockDataStore.js` - an
in-memory/localStorage store, not a real backend. This guide switches the app
over to a real Supabase project. **No component code changes** - every service
in `src/business-logic/` already branches on `isSupabaseConfigured` and calls
Supabase instead of the mock store the moment your `.env` is filled in.

## 0. What you're connecting

| Module | Tables it needs |
|---|---|
| Module 1 (Profile & Reputation) | `profiles`, `vehicles`, `host_impact_stats` |
| Module 2 (Ride Sharing) | `rides` (reads `profiles` + `host_impact_stats` too, for the host card on each ride) |
| Modules 3-6 (Messaging, Search, Trip Management, Verification) | not built yet - add their tables the same way, following the pattern below |

## Working as a team (do this once, as a group)

Everyone must point their local app at the **same** Supabase project - not
one project each. If each teammate creates their own project, you'll each be
looking at an empty database with nobody else's accounts or rides in it, and
demoing will mean whoever's laptop is plugged in that day.

1. **One person creates the project** (Section 1 below) - this becomes the
   team's shared backend for the rest of the semester.
2. **That person invites the rest of the group** so everyone can see the
   Table Editor, SQL Editor, and Storage, not just the app itself:
   Supabase dashboard → the org the project lives under → **Team** (or
   **Project Settings → Team**) → **Invite member** → enter each teammate's
   email, role **Developer** is enough (nobody needs **Owner** but the
   project creator).
3. **Share the two connection values** (Project URL + anon key, from Section
   1 step 2) over a private channel your group already uses - group chat,
   private repo wiki, whatever you'd use for any other shared secret.
   **Never commit them** - each person pastes them into their own local
   `.env`, which `.gitignore` already excludes from the repo (checked: yes,
   `.env` and `.env.local` are both listed). Only the `.env.example`
   *template* (with empty values) belongs in git.
4. **Schema changes go through the SQL files in `database/sql/`, not ad-hoc
   typing into the SQL Editor.** Whoever needs a new table/column/policy adds
   a new numbered file there following `docs/ai/SQL.md`'s convention
   (`NNN_mX_short_description.sql`, one meaningful change per file), commits
   it like any other code change, and only after the group has seen the diff
   does someone paste it into the shared project's SQL Editor and run it
   once. That keeps the live database, the migration history, and everyone's
   local mental model of the schema in sync - the same reason you don't let
   people `git push --force` over each other's work.
5. Everyone still runs their **own** `npm run dev` locally against that one
   shared project - you're not sharing a running dev server, just the
   database/auth backend behind it.

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → **New project**. Pick any name/region, and set a database password (save it somewhere - you won't need it for this app, but you'll want it if you ever open the SQL editor's "reset" flow).
2. Once it's provisioned, open **Project Settings → API**. You need two values:
   - **Project URL** (looks like `https://xxxxxxxx.supabase.co`)
   - **anon / public key** (a long JWT string - NOT the `service_role` key, that one must never go in client code)

## 2. Point the app at it

In the project root:

```bash
cp .env.example .env
```

Fill in the two values from step 1:

```
VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

Restart `npm run dev` after saving `.env` (Vite only reads env files on startup). At this point `isSupabaseConfigured` becomes `true` and every service switches over - but the tables don't exist yet, so every request will fail until you run the schema below.

## 3. Run the schema

The schema, trigger, and RLS policies are checked into the repo as seven
numbered files under
[`database/sql/`](../database/sql/) - one meaningful change per file, per
`docs/ai/SQL.md`'s convention - instead of one giant hand-typed block. Open
your project's **SQL Editor** (left sidebar) → **New query**, then copy and
run each file **in order**, since each depends on the one(s) before it:

| File | What it does |
|---|---|
| `001_m1_create_profiles.sql` | `profiles` table |
| `002_m1_create_vehicles.sql` | `vehicles` table |
| `003_m1_create_host_impact_stats.sql` | `host_impact_stats` table |
| `004_m1_handle_new_user_trigger.sql` | auto-creates a profile row on sign-up - see "Module 1 functions and security" below |
| `005_m1_enable_rls.sql` | RLS + policies for the three Module 1 tables |
| `006_m2_create_rides.sql` | `rides` table (Module 2 - drafted here so the app is runnable end-to-end; Module 2's owner should confirm) |
| `007_m2_enable_rls.sql` | RLS + policies for `rides` |

They're written to match exactly what the existing service files already
query - the column names here are not arbitrary, they're read straight out
of `ProfileService.js`, `VehicleService.js`, `HostImpactEngine.js`, and
`RideService.js`.

Only run each file once per project. Anyone adding Module 3-6 tables later
adds new `00N_mX_xxx.sql` files the same way (Section 7 below) rather than
editing these.

## Module 1 functions and security (login/register confirmed in the database)

This is already implemented in the code, wired end-to-end - here's what
happens and where, so the group understands (and can explain in the demo)
*how* a sign-up/login is actually confirmed against the database rather than
just trusted client-side:

1. **`AuthService.signUp` / `AuthService.signIn`** (`src/business-logic/AuthService.js`)
   validate the form first (email shape, password ≥ 8 characters), then call
   Supabase Auth's own `supabase.auth.signUp` / `signInWithPassword`. Supabase
   Auth - not this app - owns the credential: it hashes the password, stores
   it in its own `auth.users` table (which the app never reads or writes
   directly), and issues a signed session/JWT on success. A wrong password
   fails at Supabase's server, not in the browser.
2. **The `handle_new_user` trigger** (`database/sql/004_m1_handle_new_user_trigger.sql`)
   fires *inside Postgres* immediately after a row lands in `auth.users`. It
   copies `full_name`/`phone` out of the signup metadata and inserts the
   matching `profiles` and `host_impact_stats` rows. This runs as
   `security definer`, i.e. with the trigger owner's privileges, specifically
   so a brand-new user (who doesn't have write access to `profiles` yet on
   their own) still gets their profile row created atomically with their
   auth account - there's no window where an account exists but
   `ProfileService.getProfile()` finds nothing.
3. **RLS policies** are what make this safe against a malicious or buggy
   client, independent of the app's own code: `profiles`/`vehicles` restrict
   `update`/`delete` to `auth.uid() = id` (or `owner_id`) - i.e., Postgres
   itself rejects any request to edit a row that isn't yours, even if
   someone bypassed the React app entirely and called the Supabase REST API
   directly with a valid anon key. `host_impact_stats` is `select`-only from
   the client for the same reason - its policy in the schema file has no
   `insert`/`update`/`delete` clause at all, so reputation numbers can only
   move via Module 6's verified pipeline, never a direct client write.
4. **The service_role key is never used** anywhere in `src/` - only the
   `anon` key (`supabaseClient.js`). The service_role key bypasses RLS
   entirely, so it must only ever live server-side (an Edge Function env
   var), never in a Vite client bundle where anyone can read it from the
   browser's network tab.

If you want to see this fail safely: try editing another user's `full_name`
from the browser console after signing in (`supabase.from('profiles').update(...).eq('id', someoneElsesId)`) -
it should come back with a Postgres RLS error, not a silent success.

## 5. Storage bucket for profile photos

`ProfileService.updateProfilePhoto` uploads to a bucket named `avatars`. Create it: **Storage → New bucket → name it `avatars` → Public bucket** (so the returned `getPublicUrl()` links actually resolve). If you'd rather keep photos private, make the bucket private and switch `getPublicUrl` to `createSignedUrl` in `ProfileService.js` - that's the only line that would need to change.

## 6. Try it

```bash
npm run dev
```

Sign up with a real email - you should see a new row appear in **Table Editor → profiles** and **host_impact_stats**. Add a vehicle, publish a ride, deactivate/delete the account - each should show up (or disappear) in the corresponding table in real time.

If a request fails, the browser console will show the Postgres/PostgREST error directly (missing column, RLS policy blocking the write, etc.) - that's almost always faster to debug than re-reading this guide.

## 7. Adding Module 3-6 tables later

Same four-step recipe every time:

1. Write the table in a new `database/sql/00N_mX_short_description.sql` file (e.g. `008_m3_create_conversations.sql`), snake_case columns, `references profiles(id)` for ownership - don't edit an already-run file once it's on the shared project (`docs/ai/SQL.md` rule 5).
2. Add RLS policies in a companion `00N_mX_enable_rls.sql` file (start from the closest existing table above and adjust who can read vs. write) - or the same file, if the change is small.
3. Commit it, then run it once against the shared project's SQL Editor (see "Working as a team" above).
4. In that module's business-logic service, branch on `isSupabaseConfigured` exactly like `RideService.js` does - snake_case in the Supabase query, mapped back to the camelCase shape the mock store already returns, so the presentation layer never has to know which backend is active.
