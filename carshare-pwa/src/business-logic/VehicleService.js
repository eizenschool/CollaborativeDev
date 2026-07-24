// ===== BUSINESS LOGIC LAYER (VehicleService) =====
import { supabase, isSupabaseConfigured } from '../data-access/supabaseClient.js';
import { mockDb } from '../data-access/mockDataStore.js';

// Backs the "My Vehicles" screen. Enforces one rule the mockup shows but the raw
// GUI can't be trusted to enforce on its own: only one vehicle may be Active at a
// time (a Host publishes rides against exactly one active vehicle).

function validateVehicle({ make, model, plate, seats }) {
  if (!make?.trim() || !model?.trim()) throw new Error('Make and model are required.');
  if (!plate?.trim()) throw new Error('Plate number is required.');
  if (!Number.isInteger(seats) || seats < 1 || seats > 8) {
    throw new Error('Seats must be a whole number between 1 and 8.');
  }
}

export const VehicleService = {
  async listVehicles(userId) {
    if (isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('vehicles')
        .select('*')
        .eq('owner_id', userId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data;
    }
    return mockDb.listVehicles(userId);
  },

  async saveVehicle(userId, vehicle) {
    validateVehicle(vehicle);
    if (isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('vehicles')
        .upsert({ ...vehicle, owner_id: userId })
        .select();
      if (error) throw error;
      return data;
    }
    return mockDb.upsertVehicle(userId, vehicle);
  },

  async removeVehicle(userId, vehicleId) {
    if (isSupabaseConfigured) {
      const { error } = await supabase.from('vehicles').delete().eq('id', vehicleId).eq('owner_id', userId);
      if (error) throw error;
      return true;
    }
    return mockDb.removeVehicle(userId, vehicleId);
  },

  async setActiveVehicle(userId, vehicleId, active) {
    if (isSupabaseConfigured) {
      // Deactivate all, then activate the chosen one, mirroring the "single active
      // vehicle" rule enforced by the mock backend below.
      if (active) {
        await supabase.from('vehicles').update({ active: false }).eq('owner_id', userId);
      }
      const { data, error } = await supabase
        .from('vehicles')
        .update({ active })
        .eq('id', vehicleId)
        .eq('owner_id', userId)
        .select();
      if (error) throw error;
      return data;
    }
    return mockDb.setVehicleActive(userId, vehicleId, active);
  }
};
