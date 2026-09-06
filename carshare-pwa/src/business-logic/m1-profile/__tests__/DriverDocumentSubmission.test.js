import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), upload: vi.fn(), remove: vi.fn() }));
vi.mock('../../../data-access/shared/supabase/supabaseClient.js', () => ({
  isSupabaseConfigured: true,
  supabase: { from: api.from, rpc: api.rpc, storage: { from: () => ({ upload: api.upload, remove: api.remove }) } }
}));
import { IdentityVerificationService, canPublishWithIdentity, validateIdentitySubmission } from '../IdentityVerificationService.js';
import { identityVerificationSupabaseAdapter } from '../../../data-access/m1-profile/identityVerificationSupabaseAdapter.js';

const photo = { name: 'photo.jpg', type: 'image/jpeg', size: 200 };
const base = { status: 'approved', document_path: 'owner/mykad.jpg', ic_number: '990101145678',
  license_expiry: '2099-12-31', license_document_path: 'owner/licence.jpg' };
function readRow(row) { return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }; }
beforeEach(() => {
  vi.resetAllMocks();
  api.from.mockImplementation(() => readRow(base));
  api.upload.mockResolvedValue({ error: null });
  api.remove.mockResolvedValue({ error: null });
  api.rpc.mockResolvedValue({ data: { ...base, status: 'pending' }, error: null });
});

describe('driver document submission', () => {
  it('sends Passport through v2 with no licence fields and maps its private number', async () => {
    api.rpc.mockImplementation(async (_, args) => ({ data: { ...base, status: 'pending', document_type: 'passport',
      ic_number: null, passport_number: args.p_document_number, document_path: args.p_document_path } }));
    const state = await IdentityVerificationService.submit('owner', { mode: 'passenger', documentType: 'passport', documentNumber: ' a12345678 ', file: photo });
    expect(api.rpc).toHaveBeenCalledWith('submit_identity_documents_v2', expect.objectContaining({
      p_document_type: 'passport', p_document_number: 'A12345678', p_driver: false, p_license_expiry: null, p_license_document_path: null
    }));
    expect(api.upload).toHaveBeenCalledTimes(1);
    expect(state).toMatchObject({ documentType: 'passport', documentNumber: 'A12345678', icNumber: '', licenseDocumentPath: base.license_document_path });
  });
  it('falls back to legacy status columns when 103 is not deployed', async () => {
    api.from.mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ error: { code: '42703', message: 'document_type does not exist' } }) }) }) });
    expect(await IdentityVerificationService.getStatus('owner')).toMatchObject({ documentType: 'mykad', documentNumber: '990101-14-5678' });
    expect(api.from).toHaveBeenCalledTimes(2);
  });
  it('keeps old driver submission available but never downgrades passenger submission', async () => {
    const missing = { error: { code: 'PGRST202', message: 'RPC not found' } };
    api.rpc.mockResolvedValueOnce(missing).mockResolvedValueOnce({ data: base });
    await identityVerificationSupabaseAdapter.submit({ driver: true, documentType: 'mykad', icNumber: base.ic_number });
    expect(api.rpc.mock.calls.map(([name]) => name)).toEqual(['submit_identity_documents_v2', 'submit_identity_documents']);
    api.rpc.mockClear().mockResolvedValue(missing);
    expect(await identityVerificationSupabaseAdapter.submit({ driver: false, documentType: 'passport', documentNumber: 'A12345678' })).toEqual(missing);
    expect(api.rpc).toHaveBeenCalledTimes(1);
  });
  it('passenger submission omits driver changes and preserves the returned licence', async () => {
    const state = await IdentityVerificationService.submit('owner', { mode: 'passenger', icNumber: base.ic_number });
    expect(api.upload).not.toHaveBeenCalled();
    expect(api.rpc).toHaveBeenCalledWith('submit_identity_documents_v2', expect.objectContaining({
      p_driver: false, p_license_expiry: null, p_license_document_path: null
    }));
    expect(state.licenseDocumentPath).toBe(base.license_document_path);
  });
  it('supplements only the licence without reuploading IC', async () => {
    api.from.mockImplementation(() => readRow({ ...base, license_document_path: null }));
    api.rpc.mockImplementation(async (_, args) => ({ data: { ...base, status: 'pending', license_document_path: args.p_license_document_path } }));
    const state = await IdentityVerificationService.submit('owner', { mode: 'driver', icNumber: base.ic_number, licenseExpiry: base.license_expiry, licenseFile: photo });
    expect(api.upload).toHaveBeenCalledTimes(1);
    expect(state.documentPath).toBe(base.document_path);
    expect(state.licenseDocumentPath).toMatch(/^owner\/licence-/);
  });
  it('does not submit a record when the second image upload fails', async () => {
    api.upload.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: new Error('Upload failed') });
    await expect(IdentityVerificationService.submit('owner', { mode: 'driver', icNumber: base.ic_number, licenseExpiry: base.license_expiry, file: photo, licenseFile: photo })).rejects.toThrow('Upload failed');
    expect(api.rpc).not.toHaveBeenCalled();
    expect(api.remove).toHaveBeenCalledTimes(1);
  });
  it('recovers a committed submission after a lost response without deleting photos', async () => {
    let committed;
    api.from.mockImplementation(() => readRow(committed || base));
    api.rpc.mockImplementation(async (_, args) => {
      committed = { ...base, status: 'pending', document_path: args.p_document_path };
      return { error: new Error('Network response lost') };
    });
    const result = await IdentityVerificationService.submit('owner', { mode: 'passenger', icNumber: base.ic_number, file: photo });
    expect(result.status).toBe('pending');
    expect(api.remove).not.toHaveBeenCalled();
  });
  it('keeps uploaded files when a write outcome remains uncertain', async () => {
    api.rpc.mockRejectedValue(new Error('Network timeout'));
    await expect(IdentityVerificationService.submit('owner', { mode: 'passenger', icNumber: base.ic_number, file: photo })).rejects.toThrow('Network timeout');
    expect(api.remove).not.toHaveBeenCalled();
  });
  it('cleans only new unreferenced photos after a definite database rejection', async () => {
    api.rpc.mockResolvedValue({ error: { code: '23505', message: 'identity_verifications_ic_number_key' } });
    await expect(IdentityVerificationService.submit('owner', { mode: 'passenger', icNumber: base.ic_number, file: photo })).rejects.toThrow(/already registered/);
    expect(api.remove).toHaveBeenCalledWith([expect.stringMatching(/^owner\/mykad-/)]);
  });
  it('requires licence photos for drivers but not passengers', () => {
    expect(() => validateIdentitySubmission({ mode: 'driver', file: photo, icNumber: base.ic_number, licenseExpiry: base.license_expiry })).toThrow(/driving licence/);
    expect(validateIdentitySubmission({ mode: 'passenger', file: photo, icNumber: base.ic_number })).toBe(true);
    expect(canPublishWithIdentity({ status: 'pending', documentPath: base.document_path, icNumber: base.ic_number, licenseExpiry: base.license_expiry })).toBe(false);
  });
});
