import { isSupabaseConfigured, supabase } from '../data-access/supabaseClient.js';
import { mockDb } from '../data-access/mockDataStore.js';

export const PICKUP_PHOTO_SOURCE_MAX_BYTES = 10 * 1024 * 1024;
export const PICKUP_PHOTO_STORED_MAX_BYTES = 2 * 1024 * 1024;
export const PICKUP_PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const BUCKET = 'ride-pickup-photos';

function photoError(error, fallback) {
  return new Error(error?.message?.replace(/^.*?: /, '') || fallback);
}

export function validatePickupPhoto(file) {
  if (!file || !Number.isFinite(file.size) || file.size <= 0) throw new Error('Choose a non-empty pickup photo.');
  if (!PICKUP_PHOTO_MIME_TYPES.includes(String(file.type).toLowerCase())) {
    throw new Error('Use a JPEG, PNG, or WebP pickup photo.');
  }
  if (file.size > PICKUP_PHOTO_SOURCE_MAX_BYTES) throw new Error('Pickup photo must be 10 MB or smaller.');
  return file;
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function dataUrlOf(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Unable to prepare the pickup photo preview.'));
    reader.readAsDataURL(file);
  });
}

async function decodeImage(file) {
  if (globalThis.createImageBitmap) {
    const bitmap = await globalThis.createImageBitmap(file, { imageOrientation: 'from-image' });
    return { image: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close?.() };
  }
  if (!globalThis.document || !globalThis.Image || !globalThis.URL?.createObjectURL) return null;
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('This image could not be read. Choose another photo.'));
      element.src = url;
    });
    return { image, width: image.naturalWidth, height: image.naturalHeight, release: () => {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function preparePickupPhoto(file) {
  validatePickupPhoto(file);
  const decoded = await decodeImage(file);
  if (!decoded) {
    if (file.size <= PICKUP_PHOTO_STORED_MAX_BYTES) return file;
    throw new Error('This browser cannot resize the photo. Choose an image smaller than 2 MB.');
  }
  try {
    const scale = Math.min(1, 1600 / Math.max(decoded.width, decoded.height));
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to prepare the pickup photo.');
    context.drawImage(decoded.image, 0, 0, width, height);

    for (const quality of [0.84, 0.72, 0.6]) {
      const blob = await canvasBlob(canvas, 'image/webp', quality);
      if (blob?.size && blob.size <= PICKUP_PHOTO_STORED_MAX_BYTES) {
        return new File([blob], `pickup-${Date.now()}.webp`, { type: 'image/webp' });
      }
    }
    throw new Error('The prepared pickup photo is still larger than 2 MB. Choose a smaller image.');
  } finally {
    decoded.release();
  }
}

async function currentUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.id) throw new Error('Sign in before adding a pickup photo.');
  return data.user.id;
}

async function removeObject(path) {
  if (!path) return;
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw photoError(error, 'Unable to remove the old pickup photo.');
}

export const RidePickupPhotoService = {
  backend: isSupabaseConfigured ? 'supabase' : 'mock',
  validate: validatePickupPhoto,
  prepare: preparePickupPhoto,

  async replace(rideId, file) {
    const prepared = await preparePickupPhoto(file);
    if (!isSupabaseConfigured) {
      const path = `mock/${rideId}/${prepared.name}`;
      await mockDb.setRidePickupPhoto(rideId, path, await dataUrlOf(prepared));
      return { path, file: prepared };
    }
    const userId = await currentUserId();
    const extension = prepared.type === 'image/webp' ? 'webp' : prepared.type === 'image/png' ? 'png' : 'jpg';
    const objectId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const path = `${userId}/${rideId}/${objectId}.${extension}`;
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, prepared, {
      cacheControl: '3600', contentType: prepared.type, upsert: false,
    });
    if (uploadError) throw photoError(uploadError, 'Unable to upload the pickup photo.');
    try {
      const { data: oldPath, error } = await supabase.rpc('set_ride_pickup_photo', {
        p_ride_id: rideId, p_storage_path: path,
      });
      if (error) throw photoError(error, 'Unable to attach the pickup photo to this ride.');
      if (oldPath && oldPath !== path) removeObject(oldPath).catch(() => {});
      return { path, file: prepared };
    } catch (error) {
      await removeObject(path).catch(() => {});
      throw error;
    }
  },

  async remove(rideId) {
    if (!isSupabaseConfigured) return mockDb.setRidePickupPhoto(rideId, null, null);
    const { data: oldPath, error } = await supabase.rpc('set_ride_pickup_photo', {
      p_ride_id: rideId, p_storage_path: null,
    });
    if (error) throw photoError(error, 'Unable to remove the pickup photo.');
    await removeObject(oldPath).catch(() => {});
    return true;
  },

  async getPublicContext(rideId) {
    if (!isSupabaseConfigured) {
      const ride = await mockDb.getRide(rideId);
      return ride ? { pickupInstructions: ride.pickupInstructions || '', hasPickupPhoto: Boolean(ride.pickupPhotoPath) } : null;
    }
    const { data, error } = await supabase.rpc('get_public_ride_pickup_context', { p_ride_id: rideId });
    if (error) return null;
    return Array.isArray(data) ? data[0] || null : data;
  },

  async getDisplayUrl(rideId) {
    if (!isSupabaseConfigured) return mockDb.getRidePickupPhotoUrl(rideId);
    const { data, error } = await supabase.functions.invoke('m2-ride-pickup-photo', { body: { rideId } });
    if (error) throw photoError(error, 'Unable to load the pickup photo.');
    return data?.signedUrl || null;
  },
};
