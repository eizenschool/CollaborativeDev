import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const lifecycleSql = readFileSync(resolve(root, 'database/sql/051_m2_lifecycle_expiry_and_validation.sql'), 'utf8');

describe('Module 2 lifecycle migration contract', () => {
  it('records stable acceptance history without repurposing processed_at', () => {
    expect(lifecycleSql).toContain('add column if not exists accepted_at timestamptz');
    expect(lifecycleSql).toContain('set accepted_at = coalesce(processed_at, updated_at, created_at)');
    expect(lifecycleSql).toContain('ride_requests_accepted_participant_idx');
    expect(lifecycleSql).toContain('where accepted_at is not null');
    expect(lifecycleSql).toContain("processed_at = now()");
  });

  it('uses the exact exclusive 30-minute deadline for every day-of mutation', () => {
    expect((lifecycleSql.match(/departure_at \+ interval '30 minutes'/g) || []).length).toBeGreaterThanOrEqual(8);
    expect(lifecycleSql).toContain("rr.status in ('Pending', 'Accepted')");
    expect(lifecycleSql).toContain("set status = 'Expired'");
    expect(lifecycleSql).toContain("where r.status in ('Published', 'Matched')");
  });

  it('keeps Matched backed by an accepted passenger', () => {
    expect(lifecycleSql).toContain('Accept at least one passenger before closing recruitment');
    expect(lifecycleSql).toContain("set status = 'Published', recruitment_closed_at = null");
    expect(lifecycleSql).toContain("where ride_id = v_ride_id and status = 'Accepted'");
  });

  it('grants terminal history only to proven Expired former participants', () => {
    expect(lifecycleSql).toContain("v_status = 'Expired'");
    expect(lifecycleSql).toContain("rr.status = 'Expired'");
    expect(lifecycleSql).toContain('rr.accepted_at is not null');
    expect(lifecycleSql).toContain("v_status not in ('Completed', 'Cancelled', 'Expired')");
  });

  it('leaves active Realtime authorization untouched and hardens private helpers', () => {
    expect(lifecycleSql).not.toContain('realtime.messages');
    expect(lifecycleSql).not.toContain('create or replace function private.m2_participant_role');
    expect(lifecycleSql).toMatch(/private\.m2_historical_participant_role[\s\S]*?security definer[\s\S]*?set search_path = ''/);
    expect(lifecycleSql).toContain('from public, anon, authenticated, service_role');
  });

  it('creates deduplicated notifications without private route data', () => {
    expect(lifecycleSql).toContain("'m2:ride:' || new.id::text || ':expired:driver'");
    expect(lifecycleSql).toContain("'m2:request:' || new.id::text || ':status:' || lower(new.status)");
    const notificationSection = lifecycleSql.slice(
      lifecycleSql.indexOf('create or replace function private.notify_m2_ride_request_change'),
      lifecycleSql.indexOf('create or replace function private.process_ride_lifecycle')
    );
    expect(notificationSection).not.toMatch(/jsonb_build_object\([^)]*(latitude|longitude|place_id|pickup_instructions)/is);
  });
});
