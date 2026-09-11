import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const migration = readFileSync(resolve(
  import.meta.dirname,
  '../../../database/sql/068_m4_multi_leg_journey_search.sql'
), 'utf8')

describe('Module 4 multi-leg SQL contract', () => {
  it('keeps privileged endpoint matching private behind a public invoker wrapper', () => {
    expect(migration).toMatch(/create or replace function private\.search_public_multi_leg_journeys[\s\S]*?security definer/i)
    expect(migration).toMatch(/create or replace function public\.search_public_multi_leg_journeys[\s\S]*?security invoker/i)
    expect(migration).toContain("set search_path = ''")
    expect(migration).toContain('to anon, authenticated')
  })

  it('uses only Published rides with seats, active Hosts, and stored ETAs', () => {
    expect(migration).toContain("r.status = 'Published'")
    expect(migration).toContain('r.seats_available >= p_min_seats')
    expect(migration).toContain("p.status = 'active'")
    expect(migration).toContain('r.estimated_arrival_at is not null')
  })

  it('matches confirmed endpoints only through approved catalogue transfer points', () => {
    expect(migration).toContain('tp.source_place_id = l1.destination_place_id')
    expect(migration).toContain('l2.pickup_place_id = tp.source_place_id')
    expect(migration).toContain("p.category = 'heritage'")
    expect(migration).toMatch(/rest\[\[:space:\]\]\+\(area\|stop\)\|hentian/)
  })

  it('enforces ordered schedules and the intercity three-hour boundary', () => {
    expect(migration).toContain("then interval '3 hours'")
    expect(migration).toContain("else interval '0 hours'")
    expect(migration).toContain('l2.departure_at >= l1.estimated_arrival_at')
  })

  it('applies every existing compatibility and search filter to both legs', () => {
    expect(migration).toContain("r.restriction_tags @> coalesce(p_tags, '{}')")
    expect(migration).toContain("r.contribution ilike '%' || btrim(p_contribution) || '%'")
    expect(migration).toContain('coalesce(h.rating, 0) >= p_min_rating')
    expect(migration).toContain('v.vehicle_type = v_vehicle_type')
    expect(migration).toContain('v_language = any(p.spoken_languages)')
    expect(migration).toContain('(l1.departure_at at time zone \'Asia/Kuala_Lumpur\')::time')
  })

  it('returns only a narrow public-safe journey projection', () => {
    const returnedColumns = migration.match(/returns table\s*\(([\s\S]*?)\)\s*language/i)?.[1] || ''
    expect(returnedColumns).toContain('legs jsonb')
    expect(returnedColumns).not.toMatch(/place_id|latitude|longitude|pickup_instructions|waypoints|route_geometry/i)
    for (const privateKey of ['pickupPlaceId', 'destinationPlaceId', 'pickupInstructions', 'waypoints', 'routeGeometry']) {
      expect(migration).not.toContain(`'${privateKey}'`)
    }
  })

  it('adds indexes for both private transfer joins', () => {
    expect(migration).toContain('rides_transfer_destination_idx')
    expect(migration).toContain('rides_transfer_pickup_idx')
  })
})
