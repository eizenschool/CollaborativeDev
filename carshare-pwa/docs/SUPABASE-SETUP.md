# Supabase setup

Let's Tumpang is connected to the shared Supabase project for Modules 1-3,
including Module 3 Database, Realtime, and private Storage messaging.

```text
Project ref: pnetstmovctfwqcumodx
Project URL: https://pnetstmovctfwqcumodx.supabase.co
```

Modules 4-6 intentionally remain on their local adapters. Module 3's production
path no longer uses its legacy `localStorage`/`BroadcastChannel` adapter.

## Local configuration

Copy `.env.example` to the ignored `.env.local` file and fill in the browser-safe
values from Supabase Project Settings:

```dotenv
VITE_SUPABASE_URL=https://pnetstmovctfwqcumodx.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your_publishable_key
```

`VITE_SUPABASE_ANON_KEY` remains a temporary compatibility fallback, but new
configuration and documentation must use `VITE_SUPABASE_PUBLISHABLE_KEY`.
Never put a service-role or secret key in Vite/frontend configuration, and never
commit `.env.local`.

Restart `npm run dev` after changing environment values.

## Adopted backend scope

- Supabase Auth: email/password with email confirmation, and Google OAuth (see
  below for the Dashboard-side setup this needs).
- `profiles`: authenticated-visible display fields only.
- `profile_private`: owner-only phone and emergency contact; email remains in Auth.
- `vehicles`: owner-only CRUD with a driver-licence field and one active vehicle per user.
- `host_impact_stats`: authenticated read-only until a trusted update pipeline exists.
- `rides`: authenticated search, RPC-only host mutation, confirmed route references, pickup instructions, waypoints, seat constraints, and a mandatory host-owned vehicle.
- `ride_requests` and `ride_reviews`: RPC-only participation and mutual review lifecycle.
- `conversations`, `conversation_members`, `messages`, and `message_attachments`: member-readable, RPC-mutated messaging with seven-day terminal retention.
- `avatars`: public reads, owner-folder writes, common image MIME types, 5 MB maximum.
- `message-media`: private, no listing, approved media only, 50 MB object maximum, and attachment-bound signed downloads.

Phone OTP, hard account deletion, translation, messaging notifications, and
Modules 4-6 are not part of this connection. Google OAuth code is present, but
it still needs the provider configuration below before it works end to end.

## Enabling Google OAuth (Dashboard + Google Cloud, not code)

The app-side code (`AuthService.signInWithGoogle`, the "Continue with Google"
button on `AuthPage.jsx`) is already in place and calls
`supabase.auth.signInWithOAuth({ provider: 'google' })`. No new SQL migration
is needed for this: `handle_new_user()` (`008_m1_secure_profiles_and_auth.sql`)
already falls back through `full_name` → `name` → the email's local part, and
already reads `avatar_url`/`picture` into `profile_photo_url` - exactly the
`raw_user_meta_data` shape Google's provider supplies. What is still required
is Dashboard/Cloud Console configuration, which only a project owner can do:

1. In Google Cloud Console, create an OAuth 2.0 Client ID (Web application)
   for this project.
2. Add `https://pnetstmovctfwqcumodx.supabase.co/auth/v1/callback` as an
   Authorized redirect URI on that client.
3. In the Supabase Dashboard, go to Authentication → Providers → Google,
   enable it, and paste in that Client ID and Client Secret.
4. In Authentication → URL Configuration, make sure Site URL and Redirect URLs
   include the app's dev/prod origins (the code sends `redirectTo:
   window.location.origin`, so whatever origin the app is served from must be
   allow-listed there).

Until step 3 is done, clicking "Continue with Google" will reach Supabase and
fail with a provider-not-enabled error - that is expected, not a code bug.

## Database history and deployment

The authoritative SQL lives in `database/sql/`. Files `001-026` are deployed
and must not be rerun or edited. `023_m1_m2_public_ride_browsing.sql` was applied
through the Dashboard SQL Editor and is the repository record even though its
name is absent from migration-history output. See `docs/ai/SQL.md` for the
complete deployment-name map and current live state.

`028_m2_route_schedule_and_completion.sql` and the matching Module 2 Edge
Functions are local and **not deployed**. They require a fresh live migration
history check, explicit deployment authorization, server-only Routes secrets,
and the hard-quota gate in `docs/GOOGLE-MAPS-SETUP.md`. New schema work after
this local migration starts at `028`. Do not make Dashboard-only schema changes.

## Security model

RLS and Postgres privileges are separate layers and both are configured:

- `anon` receives only the approved active-profile/Host-impact and Published
  Ride columns; after local `027`, ETA is added while waypoint JSON is removed
  because its upgraded contract contains private Place IDs.
- `authenticated` receives explicit table/column grants only for supported actions.
- Owner policies use both `USING` and `WITH CHECK` for updates.
- The Auth trigger uses an empty `search_path`, schema-qualified objects, and no client execute permission.
- Deactivated hosts' published rides are hidden; successful sign-in reactivates the profile.

Run both Supabase security and performance advisors after every database change.
Immediately after an empty initial deployment, required indexes may be reported
as unused; reassess those notices only after representative traffic exists.

## Verification

Automated checks:

```powershell
npm.cmd test
npm.cmd run build
```

For live acceptance, use two real email accounts and verify:

1. Sign up, click the confirmation email, sign in, refresh, and sign out.
2. User B cannot read User A's `profile_private` row or change A's vehicle/ride.
3. Avatar upload, profile updates, deactivate/sign-in reactivation.
4. Vehicle create/edit/active/delete, driver-licence persistence, and the single-active constraint.
5. Ride draft/publish/search/edit-waypoints/cancel, confirmed Place IDs, current-location pickup, and pickup instructions.
6. An unauthenticated client cannot access any business table.
7. With two accounts, verify Published `Message host`, Accepted group backfill/Realtime, mixed media/location upload retry, unread edit race, delete, History jump, Archive/Leave, and expired access denial.
8. Modules 4-6 local demo functions still operate.
9. Once Google OAuth is enabled in the Dashboard (see above): "Continue with
   Google" reaches the Google consent screen, returns to the app signed in,
   and creates a `profiles`/`profile_private`/`host_impact_stats` row with a
   sensible name and avatar picked up automatically.
