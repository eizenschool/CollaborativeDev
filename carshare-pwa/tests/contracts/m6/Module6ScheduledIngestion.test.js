import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../..')
const migration = readFileSync(
  resolve(root, 'database/sql/042_m6_scheduled_ingestion.sql'),
  'utf8',
)

describe('Module 6 scheduled ingestion migration', () => {
  it('enables the extensions this project has never needed before', () => {
    expect(migration).toContain('create extension if not exists pg_cron')
    expect(migration).toContain('create extension if not exists pg_net')
  })

  it('reads both secrets from Vault by name rather than embedding a key', () => {
    expect(migration).toContain("from vault.decrypted_secrets where name = 'm6_ingest_function_url'")
    expect(migration).toContain("from vault.decrypted_secrets where name = 'm6_ingest_secret_key'")
    // No literal Supabase secret key (sb_secret_... or a bare JWT-shaped
    // string) may ever be committed, regardless of how it is used.
    expect(migration).not.toMatch(/sb_secret_/)
  })

  it('sends the key as the apikey header, never as an Authorization/Bearer header', () => {
    expect(migration).toContain("jsonb_build_object('apikey', v_key")
    expect(migration).not.toMatch(/'Authorization'/)
  })

  it('always calls with maxDetails: 0, so a scheduled run never spends Place Details', () => {
    expect(migration).toContain("jsonb_build_object('maxDetails', 0)")
  })

  it('runs as security definer with execute revoked from every client-facing role', () => {
    expect(migration).toContain('security definer')
    expect(migration).toContain(
      'revoke all on function private.run_m6_ingest_sweep() from public, anon, authenticated;'
    )
  })

  it('schedules weekly through an idempotent unschedule-then-schedule block', () => {
    expect(migration).toContain("cron.schedule(")
    expect(migration).toContain("'m6-catalogue-sweep'")
    expect(migration).toContain("'17 3 * * 1'")
    expect(migration).toMatch(/for v_job_id in select jobid from cron\.job where jobname = 'm6-catalogue-sweep'/)
    expect(migration).not.toMatch(/insert\s+into\s+cron\.job|update\s+cron\.job/i)
  })
})
