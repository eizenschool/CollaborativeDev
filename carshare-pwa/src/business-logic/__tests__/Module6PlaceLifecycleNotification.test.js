import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../..')
const migration = readFileSync(
  resolve(root, 'database/sql/075_m6_place_lifecycle_notification.sql'),
  'utf8',
)

describe('Module 6 place-lifecycle notification migration', () => {
  it('uses the shared private notification producer and its own private trigger function', () => {
    expect(migration).toContain('private.create_user_notification(')
    expect(migration).toContain('private.notify_m6_place_lifecycle_change()')
    expect(migration).not.toMatch(/create table\s+public\.user_notifications/i)
  })

  it('fires only on an actual lifecycle_state change, and only into Stale or Retired', () => {
    expect(migration).toContain('after update of lifecycle_state')
    expect(migration).toContain('on public.places')
    expect(migration).toContain('new.lifecycle_state is not distinct from old.lifecycle_state')
    expect(migration).toContain("new.lifecycle_state not in ('Stale', 'Retired')")
  })

  it('does not fire on promotion into Active or Provisional', () => {
    expect(migration).not.toMatch(/'Active'|'Provisional'/)
  })

  it('gathers recipients from both interest signals Module 6 already records', () => {
    expect(migration).toContain('from public.place_interest')
    expect(migration).toContain('from public.ride_notify_registration')
    expect(migration).toContain("status = 'active'")
    expect(migration).toContain('union')
  })

  it('only considers still-relevant interest, not past travel dates', () => {
    expect(migration).toContain("travel_date >= (now() at time zone 'Asia/Kuala_Lumpur')::date")
  })

  it('uses a stable per-place-per-state-per-user dedupe key and an internal action path', () => {
    expect(migration).toContain(
      "'m6:lifecycle:' || new.id::text || ':' || new.lifecycle_state || ':' || v_user_id::text"
    )
    expect(migration).toContain("'/discover/' || new.id::text")
  })

  it('revokes execute on the trigger function from every client-facing role', () => {
    expect(migration).toContain(
      'revoke all on function private.notify_m6_place_lifecycle_change() from public, anon, authenticated;'
    )
  })
})
