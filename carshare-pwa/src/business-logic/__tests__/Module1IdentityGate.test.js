import { describe, expect, it } from 'vitest';
import { ageFromMalaysianIC, isDriverLicenseCurrent, isOldEnoughToDrive, MIN_DRIVING_AGE } from '../malaysianIdentity.js';

async function read(relativeUrl) {
  return import('node:fs/promises').then(({ readFile }) => readFile(new URL(relativeUrl, import.meta.url), 'utf8'));
}

const now = new Date('2026-09-05T00:00:00.000Z');

describe("driver's licence currency", () => {
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

describe('age implied by a MyKad birth date', () => {
  it('resolves the century to whichever reading is not in the future', () => {
    // yy=05 read as 2005 (21 as of `now`) - 1905 would make them 121.
    expect(ageFromMalaysianIC('050615-14-5678', now)).toBe(21);
    // yy=30 read as 1930 (96 as of `now`) - 2030 has not happened yet.
    expect(ageFromMalaysianIC('300101-14-1234', now)).toBe(96);
  });

  it('has not yet counted a birthday later this year', () => {
    // Born 2009-09-06: one day past `now` (2026-09-05), so still 16.
    expect(ageFromMalaysianIC('090906-14-1234', now)).toBe(16);
    // Born 2009-09-05: turns 17 on exactly `now`.
    expect(ageFromMalaysianIC('090905-14-1234', now)).toBe(17);
  });

  it('returns null for anything that is not a well-formed MyKad', () => {
    expect(ageFromMalaysianIC('', now)).toBeNull();
    expect(ageFromMalaysianIC(null, now)).toBeNull();
    expect(ageFromMalaysianIC('not-a-mykad', now)).toBeNull();
  });
});

describe("JPJ's minimum driving age", () => {
  it(`requires at least ${MIN_DRIVING_AGE}, the Class D minimum`, () => {
    expect(isOldEnoughToDrive('090905-14-1234', now)).toBe(true); // turns 17 today
    expect(isOldEnoughToDrive('090906-14-1234', now)).toBe(false); // still 16
    expect(isOldEnoughToDrive('050615-14-5678', now)).toBe(true); // 21
  });

  it('rejects a missing or unparseable MyKad rather than defaulting to eligible', () => {
    expect(isOldEnoughToDrive('', now)).toBe(false);
    expect(isOldEnoughToDrive(null, now)).toBe(false);
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

  // 088 captured the licence per vehicle. 094 retires that trigger and moves
  // the licence onto the account, but 088's own file is deployed history and
  // must keep saying what it did.
  it('keeps the 088 vehicle licence contract intact as history', async () => {
    const sql = await read('../../../database/sql/088_m1_identity_gate_hardening.sql');
    expect(sql).toContain('add column if not exists driver_license_expiry date');
    expect(sql).toContain('enforce_ride_driver_license_before_publish');
    expect(sql).not.toMatch(/ic_number|identity_document|storage\.buckets/i);
  });

  it('retires the per-vehicle licence gate when the licence moves to the account', async () => {
    const sql = await read('../../../database/sql/094_m1_identity_holds_the_licence.sql');
    expect(sql).toContain('add column if not exists ic_number text');
    expect(sql).toContain('add column if not exists license_expiry date');
    expect(sql).toContain('drop trigger if exists enforce_ride_driver_license_before_publish on public.rides;');
    expect(sql).toContain('v_expiry is not null and v_expiry < current_date');
    // The number is the licence number, so the server checks it is present
    // rather than trusting the client to have sent it.
    expect(sql).toContain("coalesce(btrim(v_ic), '') = ''");
    expect(sql).toContain('Add your MyKad number before publishing a ride');
    // The old per-vehicle columns are left in place: other modules may read
    // them, and dropping columns is not this migration's business.
    expect(sql).not.toMatch(/alter table public\.vehicles\s+drop column/i);
  });
});
