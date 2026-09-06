// ===== BUSINESS LOGIC LAYER (ProfileService) =====
import { profileSupabaseAdapter } from '../../data-access/m1-profile/profileSupabaseAdapter.js';
import '../shared/fixture/legacyMockDb.js';
import { profileMockAdapter } from '../../data-access/m1-profile/profileMockAdapter.js';
import { normalizeSpokenLanguages } from './CompatibilityOptions.js';
import {
  buildPublicProfile,
  DEFAULT_PROFILE_VISIBILITY,
  normalizeProfileVisibility
} from './PublicProfilePolicy.js';
// Module 2 read-only lookups, for the active-obligations check below (UC1.11).
// This is the same cross-module pattern HomeScreen.jsx already uses for its
// account status strip - ProfileService only reads these, it never writes them.
import { RideService } from '../m2-rides/RideService.js';
import { RideRequestService } from '../m2-rides/RideRequestService.js';

// A host mid-ride-lifecycle, or a traveller with a request still in play,
// has an obligation to someone else on the platform that deactivating would
// silently strand. Draft/terminal statuses carry no such obligation.
const ACTIVE_HOST_RIDE_STATUSES = ['Published', 'Matched', 'In Transit'];
const ACTIVE_RIDE_REQUEST_STATUSES = ['Pending', 'Accepted'];

const EMPTY_EMERGENCY_CONTACT = { name: '', phone: '', relationship: '' };

// Same lenient-but-real shape as the phone placeholder already shown in the
// form ("+60 19-876 5432" / "0104507792") - local (0...) or international
// (+60.../60...) form, spaces and dashes ignored. Not a full JPJ/MCMC
// numbering-plan check, matching malaysianIdentity.js's own "structure only"
// stance on MyKad numbers.
const MALAYSIAN_PHONE_SHAPE = /^(\+?60|0)[1-9]\d{7,9}$/;

export function normalizePhoneDigits(value) {
  return (value || '').replace(/[\s-]/g, '');
}

export function validateMalaysianPhone(value) {
  return MALAYSIAN_PHONE_SHAPE.test(normalizePhoneDigits(value));
}

// Collapses the local and international spellings of the same number to one
// form, so "012-345 6789" and "+60123456789" compare equal.
export function canonicalMalaysianPhone(value) {
  const digitsOnly = normalizePhoneDigits(value).replace(/\D/g, '');
  if (digitsOnly.startsWith('60') && digitsOnly.length > 10) return `0${digitsOnly.slice(2)}`;
  return digitsOnly;
}
function isUndeployedCompatibilityProfile(error) {
  const detail = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`;
  return error?.code === '42703' || /spoken_languages/i.test(detail);
}

function isUndeployedPublicProfile(error) {
  if (['PGRST202', 'PGRST205', '42P01'].includes(error?.code)) return true;
  // Only treat this as "not deployed" when the message both names the
  // migration's objects AND says they're missing - "permission denied for
  // table profile_visibility" (RLS/grant errors) mentions the same table
  // name but is a real error that must not be masked as a pending migration.
  const detail = `${error?.message || ''} ${error?.details || ''}`;
  return /get_public_profile|profile_visibility/i.test(detail)
    && /does not exist|schema cache|not found/i.test(detail);
}

function mapPublicProfileRpc(value) {
  if (!value) return null;
  return {
    id: value.id,
    displayName: value.displayName ?? value.display_name ?? 'Member',
    profilePhotoUrl: value.profilePhotoUrl ?? value.profile_photo_url ?? null,
    spokenLanguages: normalizeSpokenLanguages(value.spokenLanguages ?? value.spoken_languages),
    createdAt: value.createdAt ?? value.created_at ?? null,
    reputationScore: Number(value.reputationScore ?? value.reputation_score ?? 70),
    rating: value.rating == null ? null : Number(value.rating),
    reviewCount: Number(value.reviewCount ?? value.review_count ?? 0),
    completedTrips: value.completedTrips ?? value.completed_trips ?? null,
    co2SavedKg: value.co2SavedKg ?? value.co2_saved_kg ?? null,
    provisional: Boolean(value.provisional),
    visibility: normalizeProfileVisibility(value.visibility)
  };
}

function privateRow(row) {
  const value = row?.profile_private;
  return Array.isArray(value) ? value[0] : value;
}

export function mapProfileRow(row, authUser) {
  if (!row) return null;
  const privateProfile = privateRow(row);
  return {
    id: row.id,
    fullName: row.full_name,
    spokenLanguages: normalizeSpokenLanguages(row.spoken_languages),
    email: authUser?.email || '',
    phone: privateProfile?.phone || '',
    emergencyContact: privateProfile?.emergency_contact || EMPTY_EMERGENCY_CONTACT,
    profilePhotoUrl: row.profile_photo_url,
    status: row.status,
    createdAt: row.created_at
  };
}

async function currentAuthUser(authUser) {
  if (authUser) return authUser;
  const { data, error } = await profileSupabaseAdapter.getAuthUser();
  if (error) throw error;
  return data.user;
}

export const ProfileService = {
  backend: profileSupabaseAdapter.isConfigured ? 'supabase' : 'mock',

  async getProfile(userId, authUser = null) {
    if (profileSupabaseAdapter.isConfigured) {
      let [{ data, error }, user] = await Promise.all([
        profileSupabaseAdapter.getProfile(userId),
        currentAuthUser(authUser)
      ]);
      if (error && isUndeployedCompatibilityProfile(error)) {
        ({ data, error } = await profileSupabaseAdapter.getProfile(userId, { legacy: true }));
      }
      if (error) throw error;
      return mapProfileRow(data, user);
    }
    return profileMockAdapter.getCurrentUser();
  },

  async getPublicProfile(userId) {
    if (!profileSupabaseAdapter.isConfigured) return profileMockAdapter.getPublicProfile(userId);

    const { data, error } = await profileSupabaseAdapter.getPublicProfile(userId);
    if (!error) return mapPublicProfileRpc(data);
    if (!isUndeployedPublicProfile(error)) throw error;

    let { data: profile, error: profileError } = await profileSupabaseAdapter.getLegacyPublicProfile(userId);
    if (profileError && isUndeployedCompatibilityProfile(profileError)) {
      ({ data: profile, error: profileError } = await profileSupabaseAdapter.getLegacyPublicProfile(userId, { legacy: true }));
    }
    if (profileError) {
      if (profileError.code === 'PGRST116') return null;
      throw profileError;
    }
    const stats = Array.isArray(profile.host_impact_stats) ? profile.host_impact_stats[0] : profile.host_impact_stats;
    return buildPublicProfile({ user: profile, stats, visibility: DEFAULT_PROFILE_VISIBILITY });
  },

  async getProfileVisibility(userId) {
    if (!profileSupabaseAdapter.isConfigured) return profileMockAdapter.getProfileVisibility(userId);
    const { data, error } = await profileSupabaseAdapter.getVisibility(userId);
    if (error) {
      if (isUndeployedPublicProfile(error)) return { ...DEFAULT_PROFILE_VISIBILITY, deploymentPending: true };
      throw error;
    }
    return normalizeProfileVisibility(data);
  },

  async updateProfileVisibility(userId, visibility) {
    const normalized = normalizeProfileVisibility(visibility);
    if (!profileSupabaseAdapter.isConfigured) return profileMockAdapter.updateProfileVisibility(userId, normalized);
    const { data, error } = await profileSupabaseAdapter.updateVisibility(userId, normalized);
    if (error) {
      if (isUndeployedPublicProfile(error)) {
        throw new Error('Public-profile privacy settings can\'t be saved right now - a database permission is missing.');
      }
      throw error;
    }
    return normalizeProfileVisibility(data);
  },

  async updateProfileInfo(userId, { fullName, email, phone }) {
    if (!fullName?.trim()) throw new Error('Full name is required.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '')) {
      throw new Error('Enter a valid email address.');
    }

    if (profileSupabaseAdapter.isConfigured) {
      const existingUser = await currentAuthUser();

      let authUser = existingUser;
      if (email !== existingUser.email) {
        const { data, error } = await profileSupabaseAdapter.updateAuthUser({ email });
        if (error) throw error;
        authUser = data.user;
      }

      const { error: profileError } = await profileSupabaseAdapter.updateName(userId, fullName.trim());
      if (profileError) throw profileError;

      const { error: privateError } = await profileSupabaseAdapter.updatePhone(userId, phone?.trim() || '');
      if (privateError) throw privateError;

      return ProfileService.getProfile(userId, authUser);
    }

    return profileMockAdapter.updateProfile(userId, { fullName, email, phone });
  },

  async updateSpokenLanguages(userId, spokenLanguages) {
    const normalizedLanguages = normalizeSpokenLanguages(spokenLanguages);
    if (profileSupabaseAdapter.isConfigured) {
      const { error } = await profileSupabaseAdapter.updateSpokenLanguages(userId, normalizedLanguages);
      if (error) {
        if (isUndeployedCompatibilityProfile(error)) {
          throw new Error('Spoken-language preferences are not available in this environment yet.');
        }
        throw error;
      }
      return ProfileService.getProfile(userId);
    }
    return profileMockAdapter.updateProfile(userId, { spokenLanguages: normalizedLanguages });
  },

  // Split out from updateProfileInfo: a password change is a sensitive action
  // and requires the current password before Supabase (or the mock adapter)
  // will accept a new one, rather than riding along with a routine profile edit.
  async changePassword(userId, { currentPassword, newPassword }) {
    if (!currentPassword) throw new Error('Enter your current password.');
    if (!newPassword || newPassword.length < 8) {
      throw new Error('New password must be at least 8 characters.');
    }

    if (profileSupabaseAdapter.isConfigured) {
      const existingUser = await currentAuthUser();
      const { error: verifyError } = await profileSupabaseAdapter.verifyPassword(existingUser.email, currentPassword);
      if (verifyError) throw new Error('Current password is incorrect.');

      const { error } = await profileSupabaseAdapter.updateAuthUser({ password: newPassword });
      if (error) throw error;
      return true;
    }

    return profileMockAdapter.changePassword(userId, currentPassword, newPassword);
  },

  // ownPhone comes from the caller's already-loaded profile (UC1.10) rather
  // than a fresh fetch here - this guards against a typo, not an attack, so
  // the extra round trip isn't worth it.
  async updateEmergencyContact(userId, contact, { ownPhone } = {}) {
    const phone = contact?.phone || '';
    if (phone && !validateMalaysianPhone(phone)) {
      throw new Error('Enter a valid phone number, e.g. 012-345 6789 or +60 12-345 6789.');
    }
    if (phone && ownPhone && canonicalMalaysianPhone(phone) === canonicalMalaysianPhone(ownPhone)) {
      throw new Error('Your emergency contact cannot be your own phone number.');
    }

    if (profileSupabaseAdapter.isConfigured) {
      const { error } = await profileSupabaseAdapter.updateEmergencyContact(userId, contact);
      if (error) throw error;
      return ProfileService.getProfile(userId);
    }
    return profileMockAdapter.updateProfile(userId, { emergencyContact: contact });
  },

  async updateProfilePhoto(userId, file) {
    if (file.size > 5 * 1024 * 1024) throw new Error('Profile picture must be 5 MB or smaller.');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      throw new Error('Use a JPEG, PNG, or WebP image.');
    }

    if (profileSupabaseAdapter.isConfigured) {
      const { data: publicUrl, error: uploadError } = await profileSupabaseAdapter.uploadAvatar(userId, file);
      if (uploadError) throw uploadError;
      const { error } = await profileSupabaseAdapter.updatePhotoUrl(userId, publicUrl);
      if (error) throw error;
      return publicUrl;
    }

    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    return profileMockAdapter.updateProfile(userId, { profilePhotoUrl: dataUrl });
  },

  // Blocks deactivation while the member still has an obligation to someone
  // else on the platform (UC1.11's active-obligations check). Reads only -
  // Module 2's own services already abstract mock vs Supabase, so this one
  // check works unchanged on both backends.
  async assertNoActiveObligations(userId) {
    const [rides, requests] = await Promise.all([
      RideService.listMyRides(userId).catch(() => ({ hosting: [] })),
      RideRequestService.listMyRequests(userId).catch(() => [])
    ]);
    const hasActiveRide = (rides?.hosting || []).some((ride) => ACTIVE_HOST_RIDE_STATUSES.includes(ride.status));
    const hasActiveRequest = (requests || []).some((request) => ACTIVE_RIDE_REQUEST_STATUSES.includes(request.status));
    if (hasActiveRide || hasActiveRequest) {
      const error = new Error(
        'You cannot deactivate your account with an active ride or a pending request. Please resolve them first.'
      );
      error.code = 'ACCOUNT_HAS_ACTIVE_OBLIGATIONS';
      throw error;
    }
  },

  // currentPassword is required for a password-based account, re-verified via
  // sign-in exactly like changePassword() above - the confirmation dialog
  // itself is presentation-layer (MyProfile.jsx), this is what actually
  // enforces it. A Google-only account has no password to check, so it skips
  // straight to the obligations check.
  async deactivateAccount(userId, { currentPassword } = {}) {
    await ProfileService.assertNoActiveObligations(userId);

    if (profileSupabaseAdapter.isConfigured) {
      const { data: userData, error: userError } = await profileSupabaseAdapter.getAuthUser();
      if (userError) throw userError;
      const hasPassword = (userData.user?.identities || []).some((identity) => identity.provider === 'email');

      if (hasPassword) {
        if (!currentPassword) throw new Error('Enter your password to confirm.');
        const { error: verifyError } = await profileSupabaseAdapter.verifyPassword(userData.user.email, currentPassword);
        if (verifyError) throw new Error('Current password is incorrect.');
      }

      const { error } = await profileSupabaseAdapter.updateStatus(userId, 'deactivated');
      if (error) throw error;
      return true;
    }

    await profileMockAdapter.verifyPassword(userId, currentPassword);
    await profileMockAdapter.setAccountStatus(userId, 'deactivated');
    return true;
  },

  async reactivateAccount(userId) {
    if (profileSupabaseAdapter.isConfigured) {
      const { error } = await profileSupabaseAdapter.updateStatus(userId, 'active');
      if (error) throw error;
      return true;
    }
    await profileMockAdapter.setAccountStatus(userId, 'active');
    return true;
  }
};
