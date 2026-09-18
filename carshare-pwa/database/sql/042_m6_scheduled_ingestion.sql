-- Module 6 FR-6.1/6.6/UC6.8/UC6.9: a scheduled catalogue sweep. Every run of
-- m6-ingest before this migration was triggered by hand
-- (docs/MODULE6-API-SETUP.md §6). This is new ground for the project: every
-- existing pg_cron job (014, 033, 038) calls a Postgres function directly,
-- and nothing here has ever used pg_net to call an Edge Function. Depends on
-- m6-ingest already being deployed with `verify_jwt = false`
-- (supabase/config.toml).
--
-- Deliberately cheap: the scheduled sweep always calls with `maxDetails: 0`,
-- so it only runs Nearby Search per region (free reconnaissance) and never
-- spends a Place Details request. It exists to keep the catalogue's
-- last_seen_at / absence_counter honest on a schedule, not to grow the
-- catalogue - growing it is still a deliberate manual call with a non-zero
-- maxDetails, per docs/MODULE6-API-SETUP.md §8.
--
-- Requires two Dashboard-only steps this migration cannot perform:
--   1. Enable the pg_net extension (Database -> Extensions), if the
--      `create extension` below is rejected by the hosted project's
--      permissions.
--   2. Store two secrets in Vault (Project Settings -> Vault):
--        name: m6_ingest_function_url
--          value: https://<project-ref>.supabase.co/functions/v1/m6-ingest
--        name: m6_ingest_secret_key
--          value: the same Supabase secret key already used for manual
--          invocation (docs/MODULE6-API-SETUP.md §6) - sent as the `apikey`
--          header, never as a Bearer token, matching m6-ingest's own
--          `auth: "secret"` check.
-- Neither secret value is written by this file. Per D018, the key must never
-- reach the browser bundle or a VITE_ variable - Vault plus this
-- `security definer` function is what keeps it server-side.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function private.run_m6_ingest_sweep()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
  v_request_id bigint;
begin
  select decrypted_secret into v_url
  from vault.decrypted_secrets where name = 'm6_ingest_function_url';

  select decrypted_secret into v_key
  from vault.decrypted_secrets where name = 'm6_ingest_secret_key';

  if v_url is null or v_key is null then
    raise exception
      'm6_ingest_function_url or m6_ingest_secret_key is missing from Vault - see this migration''s header';
  end if;

  -- Fire-and-forget: pg_net queues the call and returns a request id
  -- immediately rather than waiting on m6-ingest's response. A dry run
  -- invoked by hand (docs/MODULE6-API-SETUP.md §6) is how a run is actually
  -- inspected before trusting the schedule; this function is not that
  -- inspection.
  select net.http_post(
    url := v_url,
    headers := jsonb_build_object('apikey', v_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object('maxDetails', 0)
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function private.run_m6_ingest_sweep() from public, anon, authenticated;

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in select jobid from cron.job where jobname = 'm6-catalogue-sweep'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
  -- Weekly, off-peak, on the same anti-thundering-herd minute-past-the-hour
  -- habit as 033's daily retention job, not exactly on the hour.
  perform cron.schedule(
    'm6-catalogue-sweep',
    '17 3 * * 1',
    'select private.run_m6_ingest_sweep();'
  );
end;
$$;
