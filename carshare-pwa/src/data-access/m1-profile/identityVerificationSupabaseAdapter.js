import { isSupabaseConfigured, supabase } from '../shared/supabase/supabaseClient.js';

const BUCKET = 'identity-documents';
const IDENTITY_SELECT = 'status, document_path, license_document_path, submitted_at, reviewed_at, review_note, ic_number, license_expiry';
const DOCUMENT_SELECT = `${IDENTITY_SELECT}, document_type, passport_number`;
const missingDocumentColumns = (error) => ['42703', 'PGRST204'].includes(error?.code)
  && /document_type|passport_number/i.test(`${error.message} ${error.details}`);

function extensionFor(file) {
  if (file.type === 'image/png') return 'png';
  if (file.type === 'image/webp') return 'webp';
  return 'jpg';
}

export const identityVerificationSupabaseAdapter = {
  isConfigured: isSupabaseConfigured,

  async getStatus(userId) {
    const result = await supabase.from('identity_verifications').select(DOCUMENT_SELECT).eq('user_id', userId).maybeSingle();
    if (missingDocumentColumns(result.error)) return supabase.from('identity_verifications').select(IDENTITY_SELECT).eq('user_id', userId).maybeSingle();
    return result;
  },

  async uploadDocument(userId, kind, file) {
    const path = `${userId}/${kind}-${crypto.randomUUID()}.${extensionFor(file)}`;
    const { error } = await supabase.storage.from(BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });
    return { data: error ? null : path, error };
  },

  async submit({ documentPath, icNumber, documentType = 'mykad', documentNumber, licenseExpiry, licenseDocumentPath, driver }) {
    const result = await supabase.rpc('submit_identity_documents_v2', {
      p_document_path: documentPath,
      p_document_type: documentType,
      p_document_number: documentNumber ?? icNumber,
      p_license_expiry: driver ? licenseExpiry : null,
      p_license_document_path: driver ? licenseDocumentPath : null,
      p_driver: driver
    });
    // Keep the existing driver flow usable before the compatible expansion is
    // deployed. Never silently send Passport to the old MyKad-only contract.
    if (!(driver && documentType === 'mykad' && result.error?.code === 'PGRST202')) return result;
    return supabase.rpc('submit_identity_documents', {
      p_document_path: documentPath,
      p_ic_number: icNumber,
      p_license_expiry: driver ? licenseExpiry : null,
      p_license_document_path: driver ? licenseDocumentPath : null,
      p_driver: driver
    });
  },

  removeDocuments(paths) {
    return supabase.storage.from(BUCKET).remove(paths);
  },

  createPreviewUrl(documentPath, expiresInSeconds) {
    return supabase.storage.from(BUCKET).createSignedUrl(documentPath, expiresInSeconds);
  },

  async listSubmissions(status) {
    const run = (columns) => {
      let query = supabase
        .from('identity_verifications')
        .select(`user_id, ${columns}`)
        .order('submitted_at', { ascending: true });
      if (status) query = query.eq('status', status);
      return query;
    };
    const result = await run(DOCUMENT_SELECT);
    return missingDocumentColumns(result.error) ? run(IDENTITY_SELECT) : result;
  },

  review(userId, outcome, note) {
    return supabase.rpc('admin_review_identity_verification', {
      p_user_id: userId,
      p_outcome: outcome,
      p_note: note
    });
  }
};
