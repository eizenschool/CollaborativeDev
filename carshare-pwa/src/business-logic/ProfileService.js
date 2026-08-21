// ===== BUSINESS LOGIC LAYER (ProfileService) =====
import { supabase, isSupabaseConfigured } from '../data-access/supabaseClient.js';
import { mockDb } from '../data-access/mockDataStore.js';
import { normalizeSpokenLanguages } from './CompatibilityOptions.js';

const EMPTY_EMERGENCY_CONTACT = { name: '', phone: '', relationship: '' };
const PROFILE_SELECT = `
  id,
  full_name,
  spoken_languages,
  profile_photo_url,
  status,
  created_at,
  profile_private(phone, emergency_contact)
`;
const LEGACY_PROFILE_SELECT = `
  id,
  full_name,
  profile_photo_url,
  status,
  created_at,
  profile_private(phone, emergency_contact)
`;

function isUndeployedCompatibilityProfile(error) {
  const detail = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`;
  return error?.code === '42703' || /spoken_languages/i.test(detail);
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
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return data.user;
}

export const ProfileService = {
  backend: isSupabaseConfigured ? 'supabase' : 'mock',

  async getProfile(userId, authUser = null) {
    if (isSupabaseConfigured) {
      let [{ data, error }, user] = await Promise.all([
        supabase.from('profiles').select(PROFILE_SELECT).eq('id', userId).single(),
        currentAuthUser(authUser)
      ]);
      if (error && isUndeployedCompatibilityProfile(error)) {
        ({ data, error } = await supabase.from('profiles').select(LEGACY_PROFILE_SELECT).eq('id', userId).single());
      }
      if (error) throw error;
      return mapProfileRow(data, user);
    }
    return mockDb.getCurrentUser();
  },

  async updateProfileInfo(userId, { fullName, email, phone }) {
    if (!fullName?.trim()) throw new Error('Full name is required.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '')) {
      throw new Error('Enter a valid email address.');
    }

    if (isSupabaseConfigured) {
      const existingUser = await currentAuthUser();

      let authUser = existingUser;
      if (email !== existingUser.email) {
        const { data, error } = await supabase.auth.updateUser({ email });
        if (error) throw error;
        authUser = data.user;
      }

      const { error: profileError } = await supabase
        .from('profiles')
        .update({ full_name: fullName.trim() })
        .eq('id', userId);
      if (profileError) throw profileError;

      const { error: privateError } = await supabase
        .from('profile_private')
        .update({ phone: phone?.trim() || '', updated_at: new Date().toISOString() })
        .eq('user_id', userId);
      if (privateError) throw privateError;

      return ProfileService.getProfile(userId, authUser);
    }

    return mockDb.updateProfile(userId, { fullName, email, phone });
  },

  async updateSpokenLanguages(userId, spokenLanguages) {
    const normalizedLanguages = normalizeSpokenLanguages(spokenLanguages);
    if (isSupabaseConfigured) {
      const { error } = await supabase
        .from('profiles')
        .update({ spoken_languages: normalizedLanguages })
        .eq('id', userId);
      if (error) {
        if (isUndeployedCompatibilityProfile(error)) {
          throw new Error('Spoken-language preferences are not available in this environment yet.');
        }
        throw error;
      }
      return ProfileService.getProfile(userId);
    }
    return mockDb.updateProfile(userId, { spokenLanguages: normalizedLanguages });
  },

  // Split out from updateProfileInfo: a password change is a sensitive action
  // and requires the current password before Supabase (or the mock adapter)
  // will accept a new one, rather than riding along with a routine profile edit.
  async changePassword(userId, { currentPassword, newPassword }) {
    if (!currentPassword) throw new Error('Enter your current password.');
    if (!newPassword || newPassword.length < 8) {
      throw new Error('New password must be at least 8 characters.');
    }

    if (isSupabaseConfigured) {
      const existingUser = await currentAuthUser();
      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email: existingUser.email,
        password: currentPassword
      });
      if (verifyError) throw new Error('Current password is incorrect.');

      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      return true;
    }

    return mockDb.changePassword(userId, currentPassword, newPassword);
  },

  async updateEmergencyContact(userId, contact) {
    if (isSupabaseConfigured) {
      const { error } = await supabase
        .from('profile_private')
        .update({ emergency_contact: contact, updated_at: new Date().toISOString() })
        .eq('user_id', userId);
      if (error) throw error;
      return ProfileService.getProfile(userId);
    }
    return mockDb.updateProfile(userId, { emergencyContact: contact });
  },

  async updateProfilePhoto(userId, file) {
    if (file.size > 5 * 1024 * 1024) throw new Error('Profile picture must be 5 MB or smaller.');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      throw new Error('Use a JPEG, PNG, or WebP image.');
    }

    if (isSupabaseConfigured) {
      const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const path = `${userId}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file);
      if (uploadError) throw uploadError;
      const { data: publicUrl } = supabase.storage.from('avatars').getPublicUrl(path);
      const { error } = await supabase
        .from('profiles')
        .update({ profile_photo_url: publicUrl.publicUrl })
        .eq('id', userId);
      if (error) throw error;
      return publicUrl.publicUrl;
    }

    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    return mockDb.updateProfile(userId, { profilePhotoUrl: dataUrl });
  },

  async deactivateAccount(userId) {
    if (isSupabaseConfigured) {
      const { error } = await supabase
        .from('profiles')
        .update({ status: 'deactivated' })
        .eq('id', userId);
      if (error) throw error;
      return true;
    }
    await mockDb.setAccountStatus(userId, 'deactivated');
    return true;
  },

  async reactivateAccount(userId) {
    if (isSupabaseConfigured) {
      const { error } = await supabase
        .from('profiles')
        .update({ status: 'active' })
        .eq('id', userId);
      if (error) throw error;
      return true;
    }
    await mockDb.setAccountStatus(userId, 'active');
    return true;
  }
};
