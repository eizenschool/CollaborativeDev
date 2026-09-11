import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../..')
const migration = readFileSync(
  resolve(root, 'database/sql/076_m6_demo_lifecycle_toggle.sql'),
  'utf8',
)

describe('Module 6 demo lifecycle-toggle migration', () => {
  it('only accepts the three lifecycle states the trigger cares about', () => {
    expect(migration).toContain("p_state not in ('Active', 'Stale', 'Retired')")
  })

  it('restricts the caller to a place they have interest or a registration in', () => {
    expect(migration).toContain('from public.place_interest')
    expect(migration).toContain('from public.ride_notify_registration')
    expect(migration).toContain('user_id = (select auth.uid())')
    expect(migration).toContain('if not v_allowed then')
  })

  it('never lets a caller change an arbitrary place in the shared catalogue', () => {
    expect(migration).not.toMatch(/update public\.places set lifecycle_state = p_state\s*;/)
    expect(migration).toContain('update public.places set lifecycle_state = p_state where id = p_place_id;')
  })

  it('is callable by authenticated users, unlike the private trigger functions', () => {
    expect(migration).toContain(
      'grant execute on function public.m6_demo_set_place_lifecycle_state(uuid, text) to authenticated;'
    )
    expect(migration).toContain(
      'revoke all on function public.m6_demo_set_place_lifecycle_state(uuid, text) from public, anon;'
    )
  })
})
