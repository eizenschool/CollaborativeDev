import { isSupabaseConfigured, supabase } from '../shared/supabase/supabaseClient.js';

const BUCKET = 'ride-pickup-photos';

export const ridePickupPhotoSupabaseAdapter = {
  isConfigured: isSupabaseConfigured,

  async currentUserId() {
    const { data, error } = await supabase.auth.getUser();
    return { data: data?.user?.id || null, error };
  },

  async upload(userId, rideId, file) {
    const extension = file.type === 'image/webp' ? 'webp' : file.type === 'image/png' ? 'png' : 'jpg';
    const objectId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const path = `${userId}/${rideId}/${objectId}.${extension}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
      cacheControl: '3600', contentType: file.type, upsert: false
    });
    return { data: error ? null : path, error };
  },

  setRidePhoto(rideId, path) {
    return supabase.rpc('set_ride_pickup_photo', { p_ride_id: rideId, p_storage_path: path });
  },

  removeObject(path) {
    return supabase.storage.from(BUCKET).remove([path]);
  },

  getPublicContext(rideId) {
    return supabase.rpc('get_public_ride_pickup_context', { p_ride_id: rideId });
  },

  getDisplayUrl(rideId) {
    return supabase.functions.invoke('m2-ride-pickup-photo', { body: { rideId } });
  }
};
