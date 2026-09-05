import { describe, expect, it, vi } from 'vitest';

// The helpers under test are pure, but importing VehicleService pulls in the
// shared Supabase client, so the module graph needs a stub the same way
// VehicleCategoryFallback.test.js does.
vi.mock('../../data-access/supabaseClient.js', () => ({
  isSupabaseConfigured: false,
  supabase: null
}));

const { hasPublishableVehicle, isDriverLicenseCurrent } = await import('../VehicleService.js');

async function read(relativeUrl) {
  return import('node:fs/promises').then(({ readFile }) => readFile(new URL(relativeUrl, import.meta.url), 'utf8'));
}

const now = new Date('2026-09-05T00:00:00.000Z');
const licensed = { driverLicenseNumber: 'D1234567', driverLicenseExpiry: '2030-01-01' };

describe("driver's license currency", () => {
  it('treats the whole expiry day as still valid', () => {
    expect(isDriverLicenseCurrent('2026-09-05', now)).toBe(true);
    expect(isDriverLicenseCurrent('2026-09-04', now)).toBe(false);
  });

  it('rejects a missing or unparseable expiry', () => {
    expect(isDriverLicenseCurrent('', now)).toBe(false);
    expect(isDriverLicenseCurrent(null, now)).toBe(false);
    expect(isDriverLicenseCurrent('not-a-date', now)).toBe(false);
  });

  it('accepts a full timestamp by reading its date part', () => {
    expect(isDriverLicenseCurrent('2030-01-01T00:00:00.000Z', now)).toBe(true);
  });
});

describe('publishable vehicle gate', () => {
  it('needs a license number, not merely a registered vehicle', () => {
    expect(hasPublishableVehicle([{ driverLicenseExpiry: '2030-01-01' }], now)).toBe(false);
    expect(hasPublishableVehicle([licensed], now)).toBe(true);
  });

  it('blocks a vehicle whose license has lapsed', () => {
    expect(hasPublishableVehicle([{ ...licensed, driverLicenseExpiry: '2020-01-01' }], now)).toBe(false);
  });

  it('still allows a vehicle saved before the expiry column existed', () => {
    expect(hasPublishableVehicle([{ driverLicenseNumber: 'D1234567' }], now)).toBe(true);
  });

  it('reads the snake_case row shape as well', () => {
    expect(hasPublishableVehicle([{ driver_license_number: 'D1234567', driver_license_expiry: '2030-01-01' }], now)).toBe(true);
  });

  it('passes when any one vehicle qualifies', () => {
    expect(hasPublishableVehicle([{ ...licensed, driverLicenseExpiry: '2020-01-01' }, licensed], now)).toBe(true);
    expect(hasPublishableVehicle([], now)).toBe(false);
  });
});

describe('Module 1 identity and reputation SQL contracts', () => {
  it('moves the reputation origin to 100 without rewriting the 072 ledger', async () => {
    const sql = await read('../../../database/sql/087_m1_reputation_starts_at_ceiling.sql');
    expect(sql).toContain('alter column reputation_score set default 100');
    expect(sql).toContain('least(100, greatest(0, reputation_score) + 30)');
    expect(sql).toContain("= '70' then");
    expect(sql).toContain('v_evidence >= 3 and v_score < 90');
    expect(sql).toContain('v_evidence >= 3 and v_score < 75');
    expect(sql).toContain("case when p_role = 'host' then 90 else 75 end");
    expect(sql).not.toMatch(/create table public\.reputation_events/);
    expect(sql).not.toMatch(/daily[_ ]login/i);
  });

  it('records only that the MyKad gate ran, never the IC number', async () => {
    const sql = await read('../../../database/sql/088_m1_identity_gate_hardening.sql');
    expect(sql).toContain('add column if not exists ic_checked_at timestamptz');
    expect(sql).toContain("(new.raw_user_meta_data ->> 'ic_format_checked') = 'true'");
    expect(sql).toMatch(/revoke update \(ic_checked_at\)[\s\S]*from anon, authenticated/);
    expect(sql).not.toMatch(/ic_number|mykad_number|identity_document|storage\.buckets/i);
    expect(sql).not.toMatch(/grant\s+(insert|update)\s*\(ic_checked_at\)/i);
  });

  it('makes a usable license a server-side condition of publishing', async () => {
    const sql = await read('../../../database/sql/088_m1_identity_gate_hardening.sql');
    expect(sql).toContain('add column if not exists driver_license_expiry date');
    expect(sql).toContain('create or replace function private.enforce_ride_driver_license()');
    expect(sql).toContain('enforce_ride_driver_license_before_publish');
    expect(sql).toContain('v_expiry is not null and v_expiry < current_date');
    // A vehicle registered before this migration has no expiry on record; that
    // unknown must not lock an existing Host out of publishing.
    expect(sql).not.toMatch(/v_expiry is null\s+then\s+raise/i);
  });
});
