import { describe, expect, it, vi } from 'vitest';

vi.mock('../../data-access/supabaseClient.js', () => ({
  isSupabaseConfigured: false,
  supabase: null
}));

// The mock backend persists through localStorage, which the node test
// environment does not provide - same shim FavouriteService.test.js uses.
const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, value),
  removeItem: (key) => memory.delete(key),
  clear: () => memory.clear()
};

const {
  canPublishWithIdentity,
  describeIdentityStatus,
  identityLicenseHasLapsed,
  IDENTITY_STATUS,
  IdentityVerificationService,
  validateIdentityDocument,
  validateIdentitySubmission
} = await import('../IdentityVerificationService.js');

async function read(relativeUrl) {
  return import('node:fs/promises').then(({ readFile }) => readFile(new URL(relativeUrl, import.meta.url), 'utf8'));
}

const photo = (type = 'image/jpeg', size = 1024) => ({ type, size, name: 'mykad.jpg' });

describe('identity document capture', () => {
  it('accepts the photo formats a phone camera produces', () => {
    expect(validateIdentityDocument(photo('image/jpeg'))).toBe(true);
    expect(validateIdentityDocument(photo('image/png'))).toBe(true);
    expect(validateIdentityDocument(photo('image/webp'))).toBe(true);
  });

  it('rejects a missing file, a non-image and an oversized photo', () => {
    expect(() => validateIdentityDocument(null)).toThrow(/choose a photo/i);
    expect(() => validateIdentityDocument(photo('application/pdf'))).toThrow(/JPEG, PNG or WebP/i);
    expect(() => validateIdentityDocument(photo('image/jpeg', 6 * 1024 * 1024))).toThrow(/5 MB/i);
  });
});

describe('one-time MyKad capture', () => {
  const submission = { file: photo(), icNumber: '990101-14-5678', licenseExpiry: '2099-12-31' };

  // The licence number is the MyKad number, and one person holds one licence,
  // so both are captured here once instead of on every vehicle.
  it('takes the number and the licence expiry with the photo', () => {
    expect(validateIdentitySubmission(submission)).toBe(true);
  });

  it('rejects a MyKad number that could not exist', () => {
    expect(() => validateIdentitySubmission({ ...submission, icNumber: '990230-14-5678' })).toThrow(/MyKad number/i);
    expect(() => validateIdentitySubmission({ ...submission, icNumber: 'D1234567' })).toThrow(/MyKad number/i);
  });

  it('rejects a missing or lapsed licence expiry', () => {
    expect(() => validateIdentitySubmission({ ...submission, licenseExpiry: '' })).toThrow(/expiry date/i);
    expect(() => validateIdentitySubmission({ ...submission, licenseExpiry: '2020-01-01' })).toThrow(/already expired/i);
  });
});

describe('one MyKad, one account', () => {
  it('refuses a MyKad number already registered to another account', async () => {
    const submission = { file: photo(), icNumber: '990101-14-5678', licenseExpiry: '2099-12-31' };
    await IdentityVerificationService.submit('user-a', submission);
    await expect(IdentityVerificationService.submit('user-b', submission)).rejects.toThrow(
      /already registered to another account/i
    );
  });

  it('still lets a member resubmit under their own account', async () => {
    const submission = { file: photo(), icNumber: '880505-08-1234', licenseExpiry: '2099-12-31' };
    await IdentityVerificationService.submit('user-c', submission);
    await expect(IdentityVerificationService.submit('user-c', submission)).resolves.toMatchObject({
      status: IDENTITY_STATUS.PENDING
    });
  });
});

describe('publish gate', () => {
  it('blocks a Host who has not submitted a document', () => {
    expect(canPublishWithIdentity(null)).toBe(false);
    expect(canPublishWithIdentity({ status: IDENTITY_STATUS.NONE })).toBe(false);
    expect(canPublishWithIdentity({ status: IDENTITY_STATUS.REJECTED })).toBe(false);
  });

  // Approval is what earns the verified label; waiting for it before allowing
  // any publish would dead-end every Host, since the reviewer surface is still
  // an open Trust & Safety decision.
  it('unlocks publishing on submission, before review completes', () => {
    expect(canPublishWithIdentity({ status: IDENTITY_STATUS.PENDING })).toBe(true);
    expect(canPublishWithIdentity({ status: IDENTITY_STATUS.APPROVED })).toBe(true);
  });

  it('pauses publishing when the stored licence has lapsed', () => {
    const lapsed = { status: IDENTITY_STATUS.APPROVED, licenseExpiry: '2020-01-01' };
    expect(canPublishWithIdentity(lapsed)).toBe(false);
    expect(identityLicenseHasLapsed(lapsed)).toBe(true);
  });

  // A submission made before the licence moved onto this record has no expiry
  // stored; unknown must not read as lapsed.
  it('treats a submission with no expiry on record as still valid', () => {
    expect(canPublishWithIdentity({ status: IDENTITY_STATUS.APPROVED, licenseExpiry: '' })).toBe(true);
    expect(identityLicenseHasLapsed({ status: IDENTITY_STATUS.APPROVED })).toBe(false);
  });

  // Same fail-open rule VehicleService uses for undeployed columns: a missing
  // migration must not take Ride publishing down.
  it('stays open when migration 093 is not deployed', () => {
    expect(canPublishWithIdentity({ status: IDENTITY_STATUS.NONE, deploymentPending: true })).toBe(true);
  });

  it('describes each status for the member', () => {
    expect(describeIdentityStatus(IDENTITY_STATUS.APPROVED)).toMatch(/verified/i);
    expect(describeIdentityStatus(IDENTITY_STATUS.PENDING)).toMatch(/review/i);
    expect(describeIdentityStatus(IDENTITY_STATUS.REJECTED)).toMatch(/clearer/i);
    expect(describeIdentityStatus(IDENTITY_STATUS.NONE)).toMatch(/not submitted/i);
  });
});

describe('Module 1 identity verification SQL contract', () => {
  it('keeps the document bucket private and owner-scoped', async () => {
    const sql = await read('../../../database/sql/093_m1_identity_document_verification.sql');
    expect(sql).toMatch(/'identity-documents',\s*'identity-documents',\s*false/);
    expect(sql).toContain("array['image/jpeg', 'image/png', 'image/webp']");
    // Every storage policy is owner-folder scoped and granted to authenticated
    // only - an anon policy would make identity documents world-readable.
    expect(sql).not.toMatch(/on storage\.objects for \w+ to anon/i);
    const ownerScoped = sql.match(/\(storage\.foldername\(name\)\)\[1\] = \(select auth\.uid\(\)\)::text/g) || [];
    expect(ownerScoped.length).toBeGreaterThanOrEqual(5);
  });

  it('never lets a member approve their own submission', async () => {
    const sql = await read('../../../database/sql/093_m1_identity_document_verification.sql');
    expect(sql).toContain("with check (user_id = (select auth.uid()) and status = 'pending')");
    expect(sql).toContain('create or replace function private.review_identity_verification(');
    expect(sql).toMatch(/revoke all on function private\.review_identity_verification\(uuid, text, text\) from public, anon, authenticated;/);
    expect(sql).not.toMatch(/grant\s+execute[\s\S]*review_identity_verification[\s\S]*(anon|authenticated)/i);
  });

  it('requires a submitted document before a Ride reaches Published', async () => {
    const sql = await read('../../../database/sql/093_m1_identity_document_verification.sql');
    expect(sql).toContain('create or replace function private.enforce_ride_identity_verification()');
    expect(sql).toContain('enforce_ride_identity_before_publish');
    expect(sql).toContain('Upload a photo of your MyKad before publishing a ride');
  });

  it('retires the sign-up flag without breaking account creation', async () => {
    const sql = await read('../../../database/sql/093_m1_identity_document_verification.sql');
    // The trigger function must be restored to a body that no longer writes the
    // column BEFORE the column is dropped, or sign-up breaks.
    const restoreAt = sql.indexOf('create or replace function public.handle_new_user()');
    const dropAt = sql.indexOf('drop column if exists ic_checked_at');
    expect(restoreAt).toBeGreaterThan(-1);
    expect(dropAt).toBeGreaterThan(restoreAt);
    expect(sql.slice(restoreAt, dropAt)).not.toContain('ic_checked_at');
  });

  // 094_m1 only granted a column-restricted UPDATE, which Postgres refuses for
  // the INSERT ... ON CONFLICT DO UPDATE supabase-js's .upsert() emits - the
  // same trap 071_project already hit on profile_visibility. 095_m1 clears it
  // with the same plain table-level grant; RLS still does the real gatekeeping.
  it('grants a table-level update so .upsert() no longer hits 42501', async () => {
    const sql = await read('../../../database/sql/095_m1_grant_table_level_identity_verifications_update.sql');
    expect(sql).toContain('grant update on table public.identity_verifications to authenticated;');
  });

  // A second account reusing an already-registered MyKad number is a fraud
  // vector 093_m1/094_m1 left open; 096_m1 closes it.
  it('refuses a second account reusing an already-registered MyKad number', async () => {
    const sql = await read('../../../database/sql/096_m1_unique_ic_number.sql');
    expect(sql).toContain(
      'create unique index if not exists identity_verifications_ic_number_key'
    );
    expect(sql).toContain('on public.identity_verifications (ic_number)');
    // Partial, not a bare unique constraint: a null ic_number (rows from
    // before 094_m1) must never collide with another null.
    expect(sql).toContain('where ic_number is not null');
  });
});
