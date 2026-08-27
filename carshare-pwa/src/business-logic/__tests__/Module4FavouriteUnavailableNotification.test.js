import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../..')
const migration = readFileSync(
  resolve(root, 'database/sql/067_m4_favourite_unavailable_notifications.sql'),
  'utf8',
).replace(/\r\n/g, '\n')

describe('Module 4 unavailable-favourite notification migration', () => {
  it('reuses the shared notification producer and delivery tables', () => {
    expect(migration).toContain('private.create_user_notification(')
    expect(migration).toContain("'m4',")
    expect(migration).toContain("'favourite_ride_unavailable',")
    expect(migration).not.toMatch(/create table\s+public\.user_notifications/i)
    expect(migration).not.toMatch(/(?:create|alter|drop)\s+(?:table\s+)?public\.web_push_subscriptions/i)
  })

  it('fires only when an available Published ride becomes unavailable', () => {
    expect(migration).toContain("old.status = 'Published'")
    expect(migration).toContain('coalesce(old.seats_available, 0) > 0')
    expect(migration).toContain("new.status is distinct from 'Published'")
    expect(migration).toContain('coalesce(new.seats_available, 0) <= 0')
    expect(migration).toMatch(/after update of status, seats_available on public\.rides/i)
  })

  it('creates one deduplicated alert for each owner and availability transition', () => {
    expect(migration).toContain('from public.ride_favourites f')
    expect(migration).toContain('where f.ride_id = new.id')
    expect(migration).toContain("'m4:favourite-unavailable:' || new.id::text || ':'")
    expect(migration).toContain("to_char(new.updated_at at time zone 'UTC', 'YYYYMMDDHH24MISSUS')")
  })

  it('builds an encoded internal alternative-search URL using canonical keys', () => {
    expect(migration).toContain("v_action_path := '/search?pickup='")
    expect(migration).toContain("|| '&destination='")
    expect(migration).toContain("|| '&scale='")
    expect(migration).toContain("|| '&date='")
    expect(migration).toContain("|| '&departAfter='")
    expect(migration).toContain('private.m4_url_encode')
  })

  it('retains date and time only for a future departure in Kuala Lumpur time', () => {
    expect(migration).toContain('if new.departure_at >= now() then')
    expect(migration).toContain("new.departure_at at time zone 'Asia/Kuala_Lumpur'")
    expect(migration).toContain("to_char(v_departure_local, 'YYYY-MM-DD')")
    expect(migration).toContain("to_char(v_departure_local, 'HH24:MI')")
  })

  it('does not place private ride-location data in the notification payload or link', () => {
    expect(migration).not.toMatch(/pickup_place_id|destination_place_id|latitude|longitude|pickup_instructions|waypoints|route_geometry/i)
  })

  it('keeps both trigger helpers private and unreachable by client roles', () => {
    expect(migration).toContain("set search_path = ''")
    expect(migration).toContain(
      'revoke all on function private.m4_url_encode(text)\n  from public, anon, authenticated;'
    )
    expect(migration).toContain(
      'revoke all on function private.notify_m4_favourite_unavailable()\n  from public, anon, authenticated;'
    )
  })
})
