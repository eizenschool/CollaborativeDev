import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../..')
const migration = readFileSync(
  resolve(root, 'database/sql/041_m6_ride_available_notification.sql'),
  'utf8',
)

describe('Module 6 ride-available notification migration', () => {
  it('uses the shared private notification producer and its own private trigger function', () => {
    expect(migration).toContain('private.create_user_notification(')
    expect(migration).toContain('private.notify_m6_ride_available()')
    expect(migration).toContain("'m6', 'ride_available'")
    expect(migration).not.toMatch(/create table\s+public\.user_notifications/i)
    expect(migration).not.toMatch(/(?:create|alter|drop)\s+(?:table\s+)?public\.web_push_subscriptions/i)
  })

  it('fires on the ride insert that publishes it, not only on a later update', () => {
    // 038's own ride trigger is `after update` only, because a Module 2 ride
    // is drafted then transitioned. A Module 6 registration can exist before
    // the matching ride does, so the very insert that publishes it must match.
    expect(migration).toMatch(/after insert or update of[\s\S]*on public\.rides/)
  })

  it('reads the destination through source_place_id, never a raw place_id column on rides', () => {
    expect(migration).toContain('pl.source_place_id = new.destination_place_id')
    expect(migration).toContain('join public.places pl on pl.id = reg.place_id')
  })

  it('compares travel_date in Malaysia time rather than a bare UTC cast', () => {
    expect(migration).toContain("(new.departure_at at time zone 'Asia/Kuala_Lumpur')::date")
    expect(migration).not.toMatch(/new\.departure_at::date/)
  })

  it('excludes the Host from their own notification and matches only active registrations', () => {
    expect(migration).toContain('reg.user_id <> new.host_id')
    expect(migration).toContain("reg.status = 'active'")
  })

  it('uses a stable, per-registration dedupe key and an internal action path', () => {
    expect(migration).toContain("'m6:notify:' || v_reg.id::text")
    expect(migration).toContain("'/discover/' || v_reg.place_id::text")
  })

  it('flips a matched registration to fulfilled rather than deleting it', () => {
    expect(migration).toContain("set status = 'fulfilled', closed_at = now()")
  })

  it('revokes execute on both private functions from every client-facing role', () => {
    expect(migration).toContain(
      'revoke all on function private.notify_m6_ride_available() from public, anon, authenticated;'
    )
    expect(migration).toContain(
      'revoke all on function private.expire_m6_ride_registrations() from public, anon, authenticated;'
    )
  })

  it('expires stale active registrations through an idempotent daily cron job', () => {
    expect(migration).toContain('private.expire_m6_ride_registrations()')
    expect(migration).toContain("status = 'expired'")
    expect(migration).toContain('cron.schedule(')
    expect(migration).toContain("'m6-expire-registrations'")
    // Idempotent unschedule-then-schedule, matching 033/038's do $$ block -
    // re-running this migration must not register a duplicate job.
    expect(migration).toMatch(/for v_job_id in select jobid from cron\.job where jobname = 'm6-expire-registrations'/)
    expect(migration).not.toMatch(/insert\s+into\s+cron\.job|update\s+cron\.job/i)
  })
})
