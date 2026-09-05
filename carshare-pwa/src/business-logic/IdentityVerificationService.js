// ===== BUSINESS LOGIC LAYER (IdentityVerificationService) =====
// A Host uploads a photo of their MyKad before they can publish a Ride.
// Deliberately not asked for at sign-up: that gate was skippable through
// Google sign-in, and a member who only browses or rides along should never
// have to hand over an identity document at all.
//
// The image is sensitive personal data. It goes to the PRIVATE
// `identity-documents` bucket under the owner's own folder, is never rendered
// on a public profile or a Ride card, and is only ever viewed through a
// short-lived signed URL. Migration 093 owns the storage policies, the
// submission table, the publish trigger and the service-role-only review path.

import { isSupabaseConfigured, supabase } from '../data-access/supabaseClient.js';
import { mockDb } from '../data-access/mockDataStore.js';
import {
  formatMalaysianIC,
  isDriverLicenseCurrent,
  normalizeMalaysianIC,
  validateMalaysianIC
} from './malaysianIdentity.js';

const BUCKET = 'identity-documents';
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export const IDENTITY_STATUS = Object.freeze({
  NONE: 'none',
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected'
});

// Until migration 093 is deployed the table and bucket do not exist. Blocking
// every Host on a missing migration would take Ride publishing down, so the
// service reports the dependency and the gate stays open, exactly as
// VehicleService does for the vehicle_type and licence-expiry columns.
function isUndeployedIdentityContract(error) {
  const detail = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`;
  if (['PGRST202', 'PGRST205', '42P01'].includes(error?.code)) return true;
  return /identity_verifications|identity-documents/i.test(detail)
    && /does not exist|schema cache|not found|Bucket not found/i.test(detail);
}

// 096_m1's unique index only rejects a *second account* reusing a number
// already on record - a member's own resubmission keeps their existing row
// (see submit()) and never hits this.
function isDuplicateIcNumber(error) {
  if (error?.code !== '23505') return false;
  return /identity_verifications_ic_number_key|ic_number/i.test(`${error?.message || ''} ${error?.details || ''}`);
}

export function describeIdentityStatus(status) {
  switch (status) {
    case IDENTITY_STATUS.APPROVED: return 'Identity verified';
    case IDENTITY_STATUS.PENDING: return 'Awaiting review';
    case IDENTITY_STATUS.REJECTED: return 'Not accepted - please upload a clearer photo';
    default: return 'Not submitted';
  }
}

// Submitting unlocks publishing; approval is what earns the verified label.
// Holding publishing until a human approves would dead-end every Host, because
// the reviewer surface is still an open Trust & Safety decision.
export function canPublishWithIdentity(state) {
  if (!state) return false;
  if (state.deploymentPending) return true;
  const submitted = state.status === IDENTITY_STATUS.PENDING || state.status === IDENTITY_STATUS.APPROVED;
  if (!submitted) return false;
  // A submission made before the licence moved onto this record has no expiry
  // stored. Unknown is treated as valid, not lapsed, so nobody who already
  // verified is locked out by a field that did not exist at the time.
  return !state.licenseExpiry || isDriverLicenseCurrent(state.licenseExpiry);
}

export function identityLicenseHasLapsed(state) {
  return Boolean(state?.licenseExpiry) && !isDriverLicenseCurrent(state.licenseExpiry);
}

export function validateIdentityDocument(file) {
  if (!file) throw new Error('Choose a photo of your MyKad.');
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Upload a JPEG, PNG or WebP photo.');
  }
  if (file.size > MAX_BYTES) {
    throw new Error('That photo is larger than 5 MB. Try a smaller one.');
  }
  return true;
}

// The number and the licence expiry are captured once, here, instead of being
// retyped on every vehicle: a Malaysian licence carries the holder's MyKad
// number, and one person holds one licence.
export function validateIdentitySubmission({ file, icNumber, licenseExpiry } = {}) {
  validateIdentityDocument(file);
  if (!validateMalaysianIC(icNumber)) {
    throw new Error('Enter your MyKad number as printed on the card, e.g. 990101-14-5678.');
  }
  if (!licenseExpiry) throw new Error("Enter your driver's licence expiry date.");
  if (!isDriverLicenseCurrent(licenseExpiry)) {
    throw new Error("That driver's licence has already expired. Renew it before hosting.");
  }
  return true;
}

function extensionFor(file) {
  if (file.type === 'image/png') return 'png';
  if (file.type === 'image/webp') return 'webp';
  return 'jpg';
}

const EMPTY_STATE = {
  status: IDENTITY_STATUS.NONE,
  submittedAt: null,
  reviewedAt: null,
  reviewNote: '',
  documentPath: '',
  icNumber: '',
  licenseExpiry: ''
};

function mapRow(row) {
  if (!row) return { ...EMPTY_STATE };
  return {
    status: row.status ?? IDENTITY_STATUS.NONE,
    submittedAt: row.submitted_at ?? row.submittedAt ?? null,
    reviewedAt: row.reviewed_at ?? row.reviewedAt ?? null,
    reviewNote: row.review_note ?? row.reviewNote ?? '',
    documentPath: row.document_path ?? row.documentPath ?? '',
    // Displayed back to its owner only, and always in the dashed spelling the
    // card itself uses.
    icNumber: formatMalaysianIC(row.ic_number ?? row.icNumber ?? ''),
    licenseExpiry: (row.license_expiry ?? row.licenseExpiry ?? '') || ''
  };
}

export const IdentityVerificationService = {
  backend: isSupabaseConfigured ? 'supabase' : 'mock',

  async getStatus(userId) {
    if (!isSupabaseConfigured) return mapRow(await mockDb.getIdentityVerification(userId));

    const { data, error } = await supabase
      .from('identity_verifications')
      .select('status, document_path, submitted_at, reviewed_at, review_note, ic_number, license_expiry')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      if (isUndeployedIdentityContract(error)) {
        return { ...mapRow(null), deploymentPending: true };
      }
      throw error;
    }
    return mapRow(data);
  },

  async submit(userId, submission) {
    const { file, icNumber, licenseExpiry } = submission || {};
    validateIdentitySubmission(submission);
    if (!isSupabaseConfigured) return mapRow(await mockDb.submitIdentityVerification(userId, submission));

    // Owner-folder path, matching the avatars policy in 009: the first path
    // segment must be the uploader's own id or Storage rejects the write.
    const path = `${userId}/mykad-${Date.now()}.${extensionFor(file)}`;
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) {
      if (isUndeployedIdentityContract(uploadError)) {
        throw new Error('Identity verification is not available until migration 093 is deployed.');
      }
      throw uploadError;
    }

    // A resubmission after a rejection returns the row to pending; RLS forbids
    // any client from writing 'approved'.
    const { data, error } = await supabase
      .from('identity_verifications')
      .upsert(
        {
          user_id: userId,
          status: IDENTITY_STATUS.PENDING,
          document_path: path,
          ic_number: normalizeMalaysianIC(icNumber),
          license_expiry: licenseExpiry
        },
        { onConflict: 'user_id' }
      )
      .select('status, document_path, submitted_at, reviewed_at, review_note, ic_number, license_expiry')
      .single();
    if (error) {
      if (isDuplicateIcNumber(error)) {
        throw new Error('That MyKad number is already registered to another account.');
      }
      throw error;
    }
    return mapRow(data);
  },

  // Short-lived and owner-only, so the member can check what they sent without
  // the image ever becoming a durable URL.
  async previewUrl(documentPath, expiresInSeconds = 60) {
    if (!documentPath) return null;
    if (!isSupabaseConfigured) return mockDb.getIdentityDocumentPreview(documentPath);
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(documentPath, expiresInSeconds);
    if (error) throw error;
    return data?.signedUrl || null;
  }
};
