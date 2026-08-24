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
- `message_translations` (after deploying `036`): member-readable, Edge-Function-written shared text/voice translation cache.
- `user_notifications`: recipient-owned cross-module inbox, with Message as its first producer; browser-device subscriptions are Edge-Function-only and never client-readable.
- `avatars`: public reads, owner-folder writes, common image MIME types, 5 MB maximum.
- `message-media`: private, no listing, approved media only, 50 MB object maximum, and attachment-bound signed downloads.

Phone OTP, hard account deletion, email notifications, and Modules
4-6 are not part of this connection. The notification centre is implemented
locally but needs the project-owner setup below before it sends a real device
alert. Google OAuth code is present, but it still needs the provider
configuration below before it works end to end.

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

`033_project_notifications.sql` is deployed as `project_notifications`. The
two notification Edge Functions are also deployed; only their project-owner
VAPID secrets and Database Webhook remain to be configured below. See
`docs/ai/SQL.md` for the authoritative deployment map; do not make
Dashboard-only schema changes.

`036_m3_message_translation.sql` and `m3-message-translation` are deployed in
the shared project; the Function is active as version 2. The project-owner setup
below remains the required process for another environment or a controlled
redeployment.

`041_m3_add_voice_calls.sql`, `042_m3_turn_guard.sql`, and the two TURN Edge
Functions are the voice-call production boundary. Follow
`docs/VOICE-CALL-DEPLOYMENT.md` for the Cloudflare key, server-only secrets,
five-minute quota monitor, Netlify HTTPS, and two-device acceptance sequence.

## Message translation setup (project owner)

Translation is deliberately proxied through Supabase. Never add a Cloudflare
token to `.env.local`, a `VITE_` variable, client code, GitHub, or a screenshot.

1. Create or use a Cloudflare account on **Workers Free**. Do not enable Workers
   Paid or prepaid AI Gateway credits for this academic zero-charge deployment.
2. In Cloudflare Dashboard → Workers AI → Use REST API, create the standard
   Workers AI API token and retain its Account ID and token. The generated token
   needs Workers AI Read/Edit permissions; do not share its value in chat.
3. In Supabase Dashboard → Edge Functions → Secrets, add:

   ```text
   CLOUDFLARE_ACCOUNT_ID=<Cloudflare account ID>
   CLOUDFLARE_AI_TOKEN=<Workers AI token>
   M3_TRANSLATION_ALLOWED_ORIGINS=http://localhost:5173,https://your-app.example
   ```

   Replace the example production origin and keep every entry origin-only: no
   path, query string, or trailing slash. Supabase's runtime database credentials
   are supplied automatically and must not be copied into frontend configuration.
4. In a new environment, apply `database/sql/036_m3_message_translation.sql`
   through the team's normal migration workflow, then deploy the authenticated
   Function (the shared project has already completed this step):

   ```powershell
   supabase functions deploy m3-message-translation
   ```

   `supabase/config.toml` keeps JWT verification enabled. The Function also calls
   `auth.getUser()` and manually confirms active membership, message tombstone,
   and conversation expiry before its privileged cache write or private audio read.
5. Run the Supabase security/performance advisors. Confirm `anon` cannot read the
   table, a non-member cannot translate another conversation's message, and an
   authenticated member cannot insert/update/delete cache rows directly.
6. Test all four languages with two real accounts. Repeating the same message and
   target must return `cached: true`; edited/deleted/expired messages must not
   return stale text. Cloudflare HTTP 429 must show the free-limit message and
   never call another provider.

## Notification delivery setup (project owner)

The inbox and Realtime bell work once `033_project_notifications.sql` is
deployed. System alerts when the PWA is closed additionally require standard
VAPID Web Push and a Database Webhook. Do this only for the intended production
Supabase project, never by placing secrets in Vite.

1. Generate one VAPID key pair with the same pinned library the push function
   uses. For example, in a temporary Deno script import
   `jsr:@negrel/webpush@0.5.0`, call `generateVapidKeys()`, then retain both
   `exportVapidKeys(keys)` (the complete JWK JSON) and
   `exportApplicationServerKey(keys)` (the browser-safe public key). Do not
   rotate the pair while devices remain subscribed.
2. Set these Edge Function secrets in the Supabase project. Use a high-entropy
   random value for the webhook secret, and never commit any value:

   ```text
   NOTIFICATION_VAPID_KEYS_JSON=<complete VAPID JWK JSON>
   NOTIFICATION_VAPID_SUBJECT=mailto:owner@example.com
   NOTIFICATION_WEBHOOK_SECRET=<random webhook secret>
   NOTIFICATION_ALLOWED_ORIGIN=https://your-app.example
   ```

   `SUPABASE_SERVICE_ROLE_KEY` is supplied by the Edge Runtime; it is not a
   frontend environment variable and must not be copied into `.env.local`.
3. Set the matching public `VITE_WEB_PUSH_PUBLIC_KEY` during the Vite build.
   This is the application-server public key from step 1, not the JWK JSON and
   not a secret. Rebuild/redeploy the frontend after setting it.
4. The migration and both functions are already deployed through the shared
   Supabase workflow. Repeat deployment only when their source changes:

   ```powershell
   supabase functions deploy notification-subscriptions
   supabase functions deploy notification-push
   ```

   `supabase/config.toml` deliberately sets `notification-push` to
   `verify_jwt = false`: it is a database-machine endpoint, protected instead
   by the custom webhook secret. The subscription function retains normal user
   JWT verification.
5. In Dashboard → Database → Webhooks, create an `INSERT` webhook for
   `public.user_notifications`. Point it to
   `https://pnetstmovctfwqcumodx.supabase.co/functions/v1/notification-push`
   (replace the project ref for another project) and add the custom HTTP header
   `x-notification-webhook-secret` with exactly the value from step 2. Do not
   put the secret in the URL. The function removes a stored subscription when
   a push service reports endpoint status 404 or 410.

6. Run the Supabase security/performance advisors. Then verify with two real
   accounts over HTTPS: user B enables device notifications and closes the app;
   user A sends text, image, video, voice, location, and group-chat messages;
   B receives only the other members' alerts and each tap opens the correct
   Message conversation. Check that the inbox read state synchronises after
   opening the item.

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
7. With two accounts, verify Published `Message host`, Accepted group backfill/Realtime, mixed media/location upload retry, unread edit race, delete, History jump, Archive/Leave, expired access denial, four-language text/voice translation and shared caching after completing Message translation setup, recipient-only notifications, and VAPID click-through after completing the Notification delivery setup.
8. Modules 4-6 local demo functions still operate.
9. Once Google OAuth is enabled in the Dashboard (see above): "Continue with
   Google" reaches the Google consent screen, returns to the app signed in,
   and creates a `profiles`/`profile_private`/`host_impact_stats` row with a
   sensible name and avatar picked up automatically.
