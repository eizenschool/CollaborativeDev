import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../..')
const migration = readFileSync(
  resolve(root, 'database/sql/038_m2_ride_usability_notifications.sql'),
  'utf8',
)

describe('Module 2 usability notification migration', () => {
  it('uses the shared private notification producer and private trigger functions', () => {
    expect(migration).toContain('private.create_user_notification(')
    expect(migration).toContain('private.notify_m2_ride_request_change()')
    expect(migration).toContain('private.notify_m2_ride_change()')
    expect(migration).toContain('private.notify_m2_driver_arrival()')
    expect(migration).not.toMatch(/create table\s+public\.user_notifications/i)
    expect(migration).not.toMatch(/(?:create|alter|drop)\s+(?:table\s+)?public\.web_push_subscriptions/i)
  })

  it('covers request, boarding, arrival, cancellation, schedule, and completion events', () => {
    for (const event of [
      'ride_request_received',
      'ride_request_accepted',
      'ride_request_rejected',
      'ride_request_expired',
      'ride_request_cancelled',
      'passenger_checked_in',
      'passenger_no_show',
      'ride_cancelled',
      'ride_arrangement_changed',
      'driver_arrived',
      'ride_completed',
    ]) {
      expect(migration).toContain(event)
    }
  })

  it('uses stable recipient-scoped dedupe keys and internal action paths', () => {
    expect(migration).toContain("'m2:request:' || new.id::text")
    expect(migration).toContain("'m2:ride:' || new.id::text")
    expect(migration).toContain("'/ride/' || new.ride_id::text || '?view=trip'")
    expect(migration).toContain("else '/ride'")
  })

  it('keeps sensitive trip details out of notification content and payloads', () => {
    const notificationCalls = migration.match(/private\.create_user_notification\([\s\S]*?\n\s*\);/g) ?? []
    expect(notificationCalls.length).toBeGreaterThan(8)
    for (const call of notificationCalls) {
      expect(call).not.toMatch(/place_id|latitude|longitude|pickup_instructions|companion_names/i)
    }
  })

  it('schedules reminders through cron.schedule and bounds overdue departure alerts', () => {
    expect(migration).toContain('private.enqueue_m2_ride_reminders()')
    expect(migration).toContain("r.departure_at > now() - interval '30 minutes'")
    expect(migration).toContain("cron.schedule(")
    expect(migration).toContain("'* * * * *'")
    expect(migration).not.toMatch(/insert\s+into\s+cron\.job|update\s+cron\.job/i)
  })
})
