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
  isDriverLicenseExpiringSoon,
  isOldEnoughToDrive,
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

// Mirrors the allowlist in database/sql/097_m1_admin_identity_review.sql.
// This check is a UX convenience only - it decides whether to show the
// admin page, not whether a request succeeds. The real gate is the SQL
// function's own private.is_identity_review_admin() check, which a client
// cannot bypass by editing this array.
export const IDENTITY_REVIEW_ADMIN_EMAILS = Object.freeze([
  'donghuanlin25@gmail.com',
  'p4862@tarc.edu.my',
  'zaviertang051212@gmail.com',
  'eizenlhy-wp23@student.tarc.edu.my',
  'chongzz-wp23@student.tarc.edu.my',
  'yeezy-wp23@student.tarc.edu.my',
  'rok470205@gmail.com'
]);

export function isIdentityReviewAdmin(user) {
  return Boolean(user?.email) && IDENTITY_REVIEW_ADMIN_EMAILS.includes(user.email);
}

// Missing identity contracts are unavailable, never an eligibility bypass.
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

// Submitting unlocks every gate below; approval is what earns the verified
// label. Holding any of them until a human approves would dead-end every
// member, because the reviewer surface is still an open Trust & Safety
// decision.
//
// This is the shared standard: identity has been submitted and not rejected.
// Requesting to join a ride and contacting another member need nothing more -
// neither puts the member behind the wheel. Publishing layers a
// licence-currency check on top of it, below.
export function canInteractWithIdentity(state) {
  if (!state) return false;
  if (state.deploymentPending) return false;
  return state.status === IDENTITY_STATUS.PENDING || state.status === IDENTITY_STATUS.APPROVED;
}

export function identityBelowDrivingAge(state) {
  return Boolean(state?.icNumber) && !isOldEnoughToDrive(state.icNumber);
}

export function canPublishWithIdentity(state) {
  if (!canInteractWithIdentity(state)) return false;
  if (state.deploymentPending) return false;
  // Publishing puts the member behind the wheel, so it is the one gate that
  // checks driving age - requesting to join or messaging another member does
  // not. The MyKad's own birth date is what's checked, not a self-reported
  // field, so this cannot be talked past by resubmitting the same number.
  if (identityBelowDrivingAge(state)) return false;
  return Boolean(state.documentPath && state.licenseDocumentPath
    && validateMalaysianIC(state.icNumber) && isDriverLicenseCurrent(state.licenseExpiry));
}

export function identityLicenseHasLapsed(state) {
  return Boolean(state?.licenseExpiry) && !isDriverLicenseCurrent(state.licenseExpiry);
}

// A lapsed licence only surfaces once it already blocks Publish. This lets
// Profile warn a Host while there is still time to renew.
export function identityLicenseExpiringSoon(state) {
  return Boolean(state?.licenseExpiry) && isDriverLicenseExpiringSoon(state.licenseExpiry);
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
export function validateIdentitySubmission({ file, icNumber, licenseExpiry, licenseFile, mode = 'driver' } = {}, existing = {}) {
  if (file || !existing.documentPath) validateIdentityDocument(file);
  if (!validateMalaysianIC(icNumber)) {
    throw new Error('Enter your MyKad number as printed on the card, e.g. 990101-14-5678.');
  }
  if (mode === 'passenger') return true;
  if (licenseFile) validateIdentityDocument(licenseFile);
  else if (!existing.licenseDocumentPath) throw new Error('Choose a photo of your driving licence.');
  if (!isOldEnoughToDrive(icNumber)) throw new Error('You must be at least 17 to host.');
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
    licenseDocumentPath: row.license_document_path ?? row.licenseDocumentPath ?? '',
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
      .select('status, document_path, license_document_path, submitted_at, reviewed_at, review_note, ic_number, license_expiry')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      if (isUndeployedIdentityContract(error)) {
        throw new Error('Document submission is temporarily unavailable. Please try again after the service update.');
      }
      throw error;
    }
    return mapRow(data);
  },

  // Mirrors ReputationService.requireEligibility: fetches the caller's own
  // status fresh and throws with a matchable code, rather than every call
  // site re-fetching getStatus and re-running canInteractWithIdentity itself.
  // Submission unlocks interaction; approval is reserved for the reviewed label.
  async requireVerifiedIdentity(userId) {
    const state = await this.getStatus(userId);
    if (!canInteractWithIdentity(state)) {
      const error = new Error('Verify your identity in Profile > Info & Security before using this feature.');
      error.code = 'IDENTITY_NOT_VERIFIED';
      throw error;
    }
    return state;
  },

  async submit(userId, submission) {
    const existing = await this.getStatus(userId);
    const { file, licenseFile, icNumber, licenseExpiry, mode = 'driver' } = submission || {};
    validateIdentitySubmission(submission, existing);
    if (!isSupabaseConfigured) return mapRow(await mockDb.submitIdentityVerification(userId, submission));

    const uploaded = [];
    let documentPath = existing.documentPath;
    let licenseDocumentPath = existing.licenseDocumentPath;
    let writeAttempted = false;
    try {
      for (const [kind, photo] of [['mykad', file], ['licence', mode === 'driver' && licenseFile]]) {
        if (!photo) continue;
        const path = `${userId}/${kind}-${crypto.randomUUID()}.${extensionFor(photo)}`;
        const { error } = await supabase.storage.from(BUCKET)
          .upload(path, photo, { contentType: photo.type, upsert: false });
        if (error) throw error;
        uploaded.push(path);
        if (kind === 'mykad') documentPath = path;
        else licenseDocumentPath = path;
      }
      writeAttempted = true;
      const { data, error } = await supabase.rpc('submit_identity_documents', {
        p_document_path: documentPath,
        p_ic_number: normalizeMalaysianIC(icNumber),
        p_license_expiry: mode === 'driver' ? licenseExpiry : null,
        p_license_document_path: mode === 'driver' ? licenseDocumentPath : null,
        p_driver: mode === 'driver'
      });
      if (error) throw error;
      return mapRow(data);
    } catch (error) {
      // A response may have been lost after committing. Read before allowing a
      // retry, and never delete files while a write outcome is uncertain.
      if (writeAttempted) {
        try {
          const saved = await this.getStatus(userId);
          if (saved.status === 'pending' && saved.documentPath === documentPath
            && normalizeMalaysianIC(saved.icNumber) === normalizeMalaysianIC(icNumber)
            && (mode !== 'driver' || (saved.licenseDocumentPath === licenseDocumentPath
              && saved.licenseExpiry === licenseExpiry))) return saved;
          // Only a definite SQL rejection proves this write cannot still commit.
          if (/^[0-9A-Z]{5}$/.test(error.code || '') && !error.code.startsWith('08')) {
            const unused = uploaded.filter((p) => p !== saved.documentPath && p !== saved.licenseDocumentPath);
            if (unused.length) await supabase.storage.from(BUCKET).remove(unused);
          }
        } catch { /* Preserve files if read-back or cleanup is unavailable. */ }
      } else if (uploaded.length) {
        await supabase.storage.from(BUCKET).remove(uploaded).catch(() => {});
      }
      if (isDuplicateIcNumber(error)) throw new Error('That MyKad number is already registered to another account.');
      if (isUndeployedIdentityContract(error)) throw new Error('Document submission is temporarily unavailable. Please try again after the service update.');
      throw error;
    }
  },

  // Short-lived and owner-only, so the member can check what they sent without
  // the image ever becoming a durable URL. An admin reviewer can also call
  // this for another member's document: the storage SELECT policy added by
  // 097_m1 is what makes that succeed, not anything in this function.
  async previewUrl(documentPath, expiresInSeconds = 60) {
    if (!documentPath) return null;
    if (!isSupabaseConfigured) return mockDb.getIdentityDocumentPreview(documentPath);
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(documentPath, expiresInSeconds);
    if (error) throw error;
    return data?.signedUrl || null;
  },

  // Admin-only (097_m1). RLS restricts this select to rows the caller owns or,
  // for an allowlisted reviewer email, every row - so a non-admin calling this
  // simply gets back their own single submission, never an error.
  async adminListSubmissions(status = IDENTITY_STATUS.PENDING) {
    if (!isSupabaseConfigured) {
      const rows = await mockDb.adminListIdentityVerifications(status);
      return rows.map((row) => ({ userId: row.userId, ...mapRow(row) }));
    }

    let query = supabase
      .from('identity_verifications')
      .select('user_id, status, document_path, license_document_path, submitted_at, reviewed_at, review_note, ic_number, license_expiry')
      .order('submitted_at', { ascending: true });
    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) {
      if (isUndeployedIdentityContract(error)) return [];
      throw error;
    }
    return (data || []).map((row) => ({ userId: row.user_id, ...mapRow(row) }));
  },

  // Admin-only (097_m1). Routes through public.admin_review_identity_verification,
  // which re-checks the caller's email server-side before ever touching
  // private.review_identity_verification - so this call fails outright for
  // anyone not on that allowlist, regardless of what this client sends.
  async adminReview(userId, outcome, note = null) {
    if (!isSupabaseConfigured) return mockDb.adminReviewIdentityVerification(userId, outcome, note);

    const { error } = await supabase.rpc('admin_review_identity_verification', {
      p_user_id: userId,
      p_outcome: outcome,
      p_note: note
    });
    if (error) throw error;
  }
};
