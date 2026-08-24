# Voice-call production deployment

This runbook deploys Module 3 one-to-one WebRTC voice calls with Cloudflare
TURN, server-issued 75-minute credentials, a 60-minute call limit, and a
900 GB monthly relay cutoff. Long-lived TURN credentials belong only in
Supabase Edge Function secrets.

## 1. Create the Cloudflare TURN credentials

1. In Cloudflare Dashboard, select the production account and open
   **Realtime → TURN**.
2. Create one TURN key. Save the displayed **TURN Key ID** and **TURN API
   Token** in the team's password manager. The token cannot be recovered from
   the frontend and must never be committed.
3. Copy the Cloudflare **Account ID**.
4. Create a separate API token with **Account Analytics: Read** permission.
   This token is used only by the usage monitor.
5. Under **Manage Account → Billing → Billable Usage**, create a `$1` budget
   alert as a backup notification. Cloudflare alerts are informational and do
   not stop usage; the application cutoff below is the actual guard.

## 2. Apply the database SQL

Confirm the Supabase project ref is `pnetstmovctfwqcumodx`. In SQL Editor,
apply these files once and in order:

1. `database/sql/043_m3_add_voice_calls.sql`
2. `database/sql/044_m3_turn_guard.sql`
3. `database/sql/045_m3_reliable_voice_call_delivery.sql`

`043` is not rerunnable. If `call_sessions already exists` appears, stop and
inspect the current schema rather than dropping anything.

Verify the result:

```sql
select to_regclass('public.call_sessions');

select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'start_voice_call',
    'respond_to_voice_call',
    'end_voice_call',
    'record_turn_credential_issue',
    'expire_overlong_voice_calls'
  );

select schemaname, tablename, policyname, cmd
from pg_policies
where (schemaname = 'public' and tablename = 'call_sessions')
   or (schemaname = 'realtime' and tablename = 'messages');

select tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
  and tablename = 'call_sessions';

select singleton, period_start, egress_bytes, cutoff_bytes,
       automatic_blocked, manual_blocked, last_checked_at
from public.turn_usage_guard;
```

Expected: the call table and five functions exist, private signalling policies
exist, `call_sessions` is published, the incoming-call notification trigger is
enabled, and the guard cutoff is `900000000000`. Run the Supabase security and
performance advisors after the deployment.

## 3. Configure and deploy the Edge Functions

In **Supabase → Edge Functions → Secrets**, add:

```text
CLOUDFLARE_TURN_KEY_ID=<TURN Key ID>
CLOUDFLARE_TURN_API_TOKEN=<TURN API Token>
CLOUDFLARE_ACCOUNT_ID=<Cloudflare Account ID>
CLOUDFLARE_ANALYTICS_TOKEN=<Account Analytics: Read token>
M3_TURN_ALLOWED_ORIGINS=http://localhost:5173,https://your-site.netlify.app
M3_TURN_MONITOR_SECRET=<at least 32 random bytes>
```

Origins must contain only scheme, host, and optional port: no path, query, or
trailing slash. Use the exact branch-preview origin during staging and the
exact production origin after release.

Deploy from the application root:

```powershell
npx supabase login
npx supabase link --project-ref pnetstmovctfwqcumodx
npx supabase functions deploy m3-turn-credentials --project-ref pnetstmovctfwqcumodx
npx supabase functions deploy m3-turn-usage-monitor --project-ref pnetstmovctfwqcumodx
npx supabase functions deploy notification-push --project-ref pnetstmovctfwqcumodx --no-verify-jwt
```

`m3-turn-credentials` keeps JWT verification enabled. The scheduled monitor
has gateway JWT verification disabled, but refuses every request that does not
carry the independent `x-m3-turn-monitor-secret` header. `notification-push`
also keeps gateway JWT verification disabled because the Database Webhook uses
its independent notification webhook secret; voice-call payloads expire after
45 seconds so a push service cannot deliver a stale incoming-call alert later.

## 4. Schedule the five-minute usage monitor

1. Enable **Integrations → Vault**, **Cron**, and `pg_net` if they are not
   already enabled.
2. In Vault, create:
   - `m3_turn_project_url` = `https://pnetstmovctfwqcumodx.supabase.co`
   - `m3_turn_monitor_secret` = the same value stored in the Edge Function's
     `M3_TURN_MONITOR_SECRET`
3. Run this SQL. It stores no secret value in the Cron definition:

```sql
select cron.unschedule(jobid)
from cron.job
where jobname = 'm3-turn-usage-monitor';

select cron.schedule(
  'm3-turn-usage-monitor',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'm3_turn_project_url'
    ) || '/functions/v1/m3-turn-usage-monitor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-m3-turn-monitor-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'm3_turn_monitor_secret'
      )
    ),
    body := '{}'::jsonb
  );
  $$
);
```

After one run, `turn_usage_guard.last_checked_at` must be populated. If it is
missing or older than 15 minutes, the credential function fails closed and
returns STUN only. Check **Edge Function logs** and `cron.job_run_details` when
the timestamp does not update.

## 5. Deploy through Netlify HTTPS

For a new Netlify project, import `eizenschool/CollaborativeDev` and use:

```text
Production branch: main
Base directory: carshare-pwa
Build command: npm run build
Publish directory: dist
```

In **Project configuration → Environment variables**, configure the existing
browser-safe variables, including `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY`. `VITE_WEBRTC_STUN_URLS` is optional. Do not
create any `VITE_` TURN key, token, username, or credential.

Deploy first as a branch preview, then release `main`. Netlify's generated
`https://<site>.netlify.app` URL already uses HTTPS. Add the final origin to
Supabase Auth URL Configuration and `M3_TURN_ALLOWED_ORIGINS`, redeploy the
site after its build variables change, and confirm microphone access works
without mixed-content errors. Supabase Edge Function secret updates are
available without redeploying the function.

## 6. Acceptance and quota drill

Use two real accounts. Put the phone on mobile data and the computer on Wi-Fi,
then test both calling directions, answer, reject, 45-second timeout, mute,
hang-up, microphone denial, and reconnect failure. In desktop Chrome,
`chrome://webrtc-internals` should show a selected candidate with type `relay`
for the cross-network call.

Confirm `call_sessions` ends in a terminal state and that no audio is stored in
Postgres or Storage. A normal connected call must end at 60 minutes; automated
tests cover the timer without waiting an hour.

Test the cost guard without consuming traffic:

```sql
update public.turn_usage_guard
set manual_blocked = true, updated_at = now()
where singleton;
```

Start a call and confirm the UI warns that relay is unavailable and uses STUN
only. Restore production operation immediately after the drill:

```sql
update public.turn_usage_guard
set manual_blocked = false, updated_at = now()
where singleton;
```

At 900,000,000,000 monthly egress bytes, the monitor automatically blocks new
TURN credentials and revokes unexpired credentials. Existing relayed calls may
disconnect; direct peer-to-peer calls can continue without relay charges. The
100 GB buffer protects against monitoring and in-flight traffic delay, but no
external usage meter can stop at exactly one byte before 1,000 GB.
