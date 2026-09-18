import { rideContentSupabaseAdapter } from '../../data-access/m2-rides/rideContentSupabaseAdapter.js';

const labels = { contribution: 'Contribution', pickupInstructions: 'Pickup instructions', pickupPhoto: 'Pickup photo' };
const descriptions = {
  personal_information: 'Remove private contact details, addresses or identity information.',
  identity_document: 'Remove identity documents.', personal_information_visible: 'Remove visible private information.',
  sexual_content: 'Remove sexual content.', hate: 'Remove hateful content.', hate_or_extremist_symbols: 'Remove hateful or extremist content.',
  threat: 'Remove threats.', illegal_transaction: 'Remove offers or requests for illegal goods or services.',
  graphic_violence: 'Remove graphic violence.', offensive_gesture: 'Choose a photo without offensive gestures.',
};

export function contentCheckError(fields = {}) {
  const fieldErrors = {};
  for (const [field, result] of Object.entries(fields)) {
    if (result?.status === 'approved') continue;
    fieldErrors[field] = result?.status === 'rejected'
      ? (result.reasons || []).map((reason) => descriptions[reason] || 'Change this content before publishing.').join(' ')
      : 'Content checking is temporarily unavailable. Your input is kept. Please retry.';
  }
  const error = new Error(Object.entries(fieldErrors).map(([field, message]) => `${labels[field] || field}: ${message}`).join(' ') || 'Content checking is temporarily unavailable. Please retry.');
  error.fieldErrors = fieldErrors;
  error.code = 'CONTENT_CHECK_FAILED';
  return error;
}

async function invoke(body) {
  const { data, error } = await rideContentSupabaseAdapter.check(body).catch(() => ({ error: true }));
  let result = data;
  if (error?.context?.json) { try { result = await error.context.json(); } catch { /* Safe fallback below. */ } }
  if (error || !result || Object.values(result.fields || {}).some((row) => row.status !== 'approved')) {
    if (result?.error && !result.fields) throw new Error(result.error);
    throw contentCheckError(result?.fields || (body.action === 'check'
      ? { contribution: { status: 'unavailable' }, pickupInstructions: { status: 'unavailable' } }
      : { pickupPhoto: { status: 'unavailable' } }));
  }
  return result;
}

export const RideContentService = {
  async check(rideId, text, photoPath) {
    if (!rideContentSupabaseAdapter.isConfigured) return null; // Explicit fixture backend only; never a live fallback.
    const result = await invoke({ action: 'check', rideId, text: { contribution: text.contribution || '', pickupInstructions: text.pickupInstructions || '' }, ...(photoPath !== undefined ? { photoPath } : {}) });
    if (!result.approvalId) throw contentCheckError({ contribution: { status: 'unavailable' }, pickupInstructions: { status: 'unavailable' } });
    return result.approvalId;
  },
  async photo(rideId, file, attachDraft = false) {
    const image = await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file);
    });
    const result = await invoke({ action: 'photo', rideId, image, mimeType: file.type, attachDraft });
    if (!result.path) throw contentCheckError({ pickupPhoto: { status: 'unavailable' } });
    return result.path;
  },
  async removeDraftPhoto(rideId) { return invoke({ action: 'remove_draft_photo', rideId }); },
};
