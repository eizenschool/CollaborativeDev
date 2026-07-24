// ===== BUSINESS LOGIC LAYER (ProfileService) =====
import { supabase, isSupabaseConfigured } from '../data-access/supabaseClient.js';
import { mockDb } from '../data-access/mockDataStore.js';

// Backs the "Profile Settings" screen's three tabs: Profile Info, Profile Picture,
// Emergency Contact. GUI components call these methods only - never Supabase directly.

export const ProfileService = {
  async getProfile(userId) {
    if (isSupabaseConfigured) {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
      if (error) throw error;
      return data;
    }
    return mockDb.getCurrentUser();
  },

  async updateProfileInfo(userId, { fullName, email, phone, newPassword }) {
    if (!fullName?.trim()) throw new Error('Full name is required.');
    if (!email?.trim()) throw new Error('Email is required.');

    const patch = { fullName, email, phone };

    if (isSupabaseConfigured) {
      if (newPassword) {
        const { error: pwError } = await supabase.auth.updateUser({ password: newPassword });
        if (pwError) throw pwError;
      }
      const { data, error } = await supabase
        .from('profiles')
        .update(patch)
        .eq('id', userId)
        .select()
        .single();
      if (error) throw error;
      return data;
    }

    return mockDb.updateProfile(userId, patch);
  },

  async updateEmergencyContact(userId, contact) {
    if (isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('profiles')
        .update({ emergencyContact: contact })
        .eq('id', userId)
        .select()
        .single();
      if (error) throw error;
      return data;
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
      return mockUpdate(userId, pub.publicUrl);
    }
    // Mock: read as a data URL so the demo still shows a real preview without Storage.
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    return mockDb.updateProfile(userId, { profilePhotoUrl: dataUrl });

    async function mockUpdate(uid, url) {
      const { error } = await supabase.from('profiles').update({ profilePhotoUrl: url }).eq('id', uid);
      if (error) throw error;
      return url;
    }
  }
};
