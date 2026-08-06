// ===== BUSINESS LOGIC LAYER (ProfileService) =====
import { supabase, isSupabaseConfigured } from '../data-access/supabaseClient.js';
import { mockDb } from '../data-access/mockDataStore.js';

// Backs the "My Profile" screen's panels: Info & Security, Profile Picture,
// Emergency Contact, Account Settings. GUI components call these methods only -
// never Supabase directly.
//
// profiles is snake_case in Postgres (see docs/SUPABASE-SETUP.md), same
// convention as VehicleService/HostImpactEngine/RideService - mapRow/mapPatch
// below are the one place that translates to/from the camelCase shape every
// component already uses against the mock backend.

function mapRow(row) {
  if (!row) return row;
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    emergencyContact: row.emergency_contact || { name: '', phone: '', relationship: '' },
    profilePhotoUrl: row.profile_photo_url,
    status: row.status,
    createdAt: row.created_at
  };
}

export const ProfileService = {
  async getProfile(userId) {
    if (isSupabaseConfigured) {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
      if (error) throw error;
      return mapRow(data);
    }
    return mockDb.getCurrentUser();
  },

  async updateProfileInfo(userId, { fullName, email, phone, newPassword }) {
    if (!fullName?.trim()) throw new Error('Full name is required.');
    if (!email?.trim()) throw new Error('Email is required.');

    if (isSupabaseConfigured) {
      if (newPassword) {
        const { error: pwError } = await supabase.auth.updateUser({ password: newPassword });
        if (pwError) throw pwError;
      }
      const { data, error } = await supabase
        .from('profiles')
        .update({ full_name: fullName, email, phone })
        .eq('id', userId)
        .select()
        .single();
      if (error) throw error;
      return mapRow(data);
    }

    return mockDb.updateProfile(userId, { fullName, email, phone });
  },

  async updateEmergencyContact(userId, contact) {
    if (isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('profiles')
        .update({ emergency_contact: contact })
        .eq('id', userId)
        .select()
        .single();
      if (error) throw error;
      return mapRow(data);
    }
    return mockDb.updateProfile(userId, { emergencyContact: contact });
  },

  async updateProfilePhoto(userId, file) {
    if (isSupabaseConfigured) {
      const path = `${userId}/${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, {
        upsert: true
      });
      if (uploadError) throw uploadError;
      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
      const { error } = await supabase.from('profiles').update({ profile_photo_url: pub.publicUrl }).eq('id', userId);
      if (error) throw error;
      return pub.publicUrl;
    }
    // Mock: read as a data URL so the demo still shows a real preview without Storage.
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    return mockDb.updateProfile(userId, { profilePhotoUrl: dataUrl });
  },

  // ---------- Account Settings (FR-1.x) - completes CRUD on the Account entity:
  // Create = Sign Up, Read = getProfile above, Update = updateProfileInfo/
  // updateEmergencyContact/deactivateAccount, Delete = deleteAccount. ----------

  async deactivateAccount(userId) {
    if (isSupabaseConfigured) {
      const { error } = await supabase.from('profiles').update({ status: 'deactivated' }).eq('id', userId);
      if (error) throw error;
      return true;
    }
    await mockDb.setAccountStatus(userId, 'deactivated');
    return true;
  },

  async deleteAccount(userId, reason) {
    if (!reason?.trim()) throw new Error('Tell us why you\'re leaving so we can improve.');
    if (isSupabaseConfigured) {
      // A real deployment would log `reason` to a support table before this call,
      // then let a Postgres cascade (ON DELETE CASCADE - see docs/SUPABASE-SETUP.md)
      // remove dependent rows (vehicles, host_impact_stats, rides).
      const { error } = await supabase.from('profiles').delete().eq('id', userId);
      if (error) throw error;
      return true;
    }
    return mockDb.deleteAccount(userId);
  }
};
