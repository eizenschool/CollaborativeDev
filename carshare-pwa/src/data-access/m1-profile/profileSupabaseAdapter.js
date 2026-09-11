import { isSupabaseConfigured, supabase } from '../shared/supabase/supabaseClient.js';

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

const PUBLIC_PROFILE_SELECT = 'id, full_name, spoken_languages, profile_photo_url, status, created_at, host_impact_stats(completed_trips, co2_saved_kg, reputation_score, rating)';
const LEGACY_PUBLIC_PROFILE_SELECT = 'id, full_name, profile_photo_url, status, created_at, host_impact_stats(completed_trips, co2_saved_kg, reputation_score, rating)';

export const profileSupabaseAdapter = {
  isConfigured: isSupabaseConfigured,
  getAuthUser: () => supabase.auth.getUser(),
  updateAuthUser: (attributes) => supabase.auth.updateUser(attributes),
  verifyPassword: (email, password) => supabase.auth.signInWithPassword({ email, password }),

  getProfile(userId, { legacy = false } = {}) {
    return supabase.from('profiles').select(legacy ? LEGACY_PROFILE_SELECT : PROFILE_SELECT).eq('id', userId).single();
  },

  getPublicProfile(userId) {
    return supabase.rpc('get_public_profile', { p_user_id: userId });
  },

  getLegacyPublicProfile(userId, { legacy = false } = {}) {
    return supabase
      .from('profiles')
      .select(legacy ? LEGACY_PUBLIC_PROFILE_SELECT : PUBLIC_PROFILE_SELECT)
      .eq('id', userId)
      .single();
  },

  getVisibility(userId) {
    return supabase.from('profile_visibility').select('*').eq('user_id', userId).single();
  },

  updateVisibility(userId, visibility) {
    return supabase.from('profile_visibility').upsert({
      user_id: userId,
      show_profile_photo: visibility.showProfilePhoto,
      show_spoken_languages: visibility.showSpokenLanguages,
      show_completed_trips: visibility.showCompletedTrips,
      show_eco_impact: visibility.showEcoImpact,
      updated_at: new Date().toISOString()
    }).select().single();
  },

  updateName(userId, fullName) {
    return supabase.from('profiles').update({ full_name: fullName }).eq('id', userId);
  },

  updatePhone(userId, phone) {
    return supabase.from('profile_private').update({ phone, updated_at: new Date().toISOString() }).eq('user_id', userId);
  },

  updateSpokenLanguages(userId, spokenLanguages) {
    return supabase.from('profiles').update({ spoken_languages: spokenLanguages }).eq('id', userId);
  },

  updateEmergencyContact(userId, emergencyContact) {
    return supabase.from('profile_private').update({ emergency_contact: emergencyContact, updated_at: new Date().toISOString() }).eq('user_id', userId);
  },

  async uploadAvatar(userId, file) {
    const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const path = `${userId}/${crypto.randomUUID()}.${extension}`;
    const { error } = await supabase.storage.from('avatars').upload(path, file);
    if (error) return { data: null, error };
    const { data } = supabase.storage.from('avatars').getPublicUrl(path);
    return { data: data?.publicUrl || null, error: null };
  },

  updatePhotoUrl(userId, profilePhotoUrl) {
    return supabase.from('profiles').update({ profile_photo_url: profilePhotoUrl }).eq('id', userId);
  },

  updateStatus(userId, status) {
    return supabase.from('profiles').update({ status }).eq('id', userId);
  }
};
