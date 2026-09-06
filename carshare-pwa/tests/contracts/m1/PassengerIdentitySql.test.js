import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(new URL('../../../database/sql/103_m1_passenger_identity_documents.sql', import.meta.url), 'utf8');

describe('passenger identity migration contract (static, not database execution)', () => {
  it('adds a versioned owner-scoped RPC without widening RLS or exposing documents', () => {
    expect(sql).toContain('public.submit_identity_documents_v2(');
    expect(sql).toContain("security invoker set search_path = ''");
    expect(sql).toContain('v_user uuid := auth.uid()');
    expect(sql).toContain("split_part(p_document_path, '/', 1) <> v_user::text");
    expect(sql).toContain("bucket_id = 'identity-documents' and name = p_document_path");
    expect(sql).toContain('from public, anon;');
    expect(sql).not.toMatch(/disable row level security|create policy|update storage\.buckets/i);
  });
  it('keeps only one identity number, a matching photo and the existing driver rules', () => {
    expect(sql).toContain("document_type = 'passport' and ic_number is null");
    expect(sql).toContain("passport_number ~ '^[A-Z0-9]{5,20}$'");
    expect(sql).toContain('Upload a matching photo when changing the document type or number');
    expect(sql).toContain("if p_driver and p_document_type <> 'mykad'");
    expect(sql).toContain("interval '17 years'");
    expect(sql).toContain('else iv.license_document_path end');
    expect(sql).toContain('reviewed_at = null, review_note = null');
    expect(sql).not.toContain('create or replace function private.enforce_ride_identity_verification');
    expect(sql).toContain('create trigger enforce_ride_driver_identity_type_before_publish');
    expect(sql).toContain("where user_id = new.host_id and document_type = 'passport'");
    expect(sql).toContain("if old.status = 'Published' then return new; end if;");
  });
});
