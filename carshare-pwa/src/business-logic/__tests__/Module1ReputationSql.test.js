import { describe, expect, it } from 'vitest';

async function read(relativeUrl) {
  return import('node:fs/promises').then(({ readFile }) => readFile(new URL(relativeUrl, import.meta.url), 'utf8'));
}

describe('Module 1 reputation and public-profile SQL contracts', () => {
  it('keeps reputation event-driven, idempotent and enforced at ride mutations', async () => {
    const sql = await read('../../../database/sql/072_m1_reputation_events_and_eligibility.sql');
    expect(sql).toContain('create table public.reputation_events');
    expect(sql).toContain('unique (user_id, source_module, source_event_id, event_type)');
    expect(sql).toContain('greatest(0, 3 - v_existing_positive)');
    expect(sql).toContain('enforce_ride_reputation_before_publish');
    expect(sql).toContain('enforce_request_reputation_before_insert');
    expect(sql).toContain('v_evidence >= 3 and v_score < 65');
    expect(sql).toContain('v_evidence >= 3 and v_score < 50');
    expect(sql).not.toMatch(/daily[_ ]login/i);
    expect(sql).not.toMatch(/grant\s+(insert|update|delete|all).*reputation_events.*authenticated/i);
  });

  it('uses only public.rides fields in the Ride status reputation trigger', async () => {
    const sql = await read('../../../database/sql/074_m1_fix_ride_reputation_status_trigger.sql');
    expect(sql).toContain('create or replace function private.reputation_from_ride_status()');
    expect(sql).toContain('coalesce(new.recruitment_closed_at, new.updated_at, now())');
    expect(sql).not.toContain('new.cancelled_at');
    expect(sql).not.toContain('new.cancelled_by');
  });

  it('exposes a privacy-filtered projection without private account fields', async () => {
    const sql = await read('../../../database/sql/073_m1_public_profile_visibility.sql');
    expect(sql).toMatch(/create table(?: if not exists)? public\.profile_visibility/i);
    expect(sql).toContain('create or replace function public.get_public_profile');
    expect(sql).toMatch(/grant execute on function public\.get_public_profile\(uuid\)\s+to anon, authenticated/i);
    expect(sql).toMatch(/case\s+when v_visibility\.show_profile_photo then v_profile\.profile_photo_url\s+else null\s+end/i);
    expect(sql).not.toMatch(/emergency_contact|profile_private|\bemail\b|\bphone\b/i);
  });
});
