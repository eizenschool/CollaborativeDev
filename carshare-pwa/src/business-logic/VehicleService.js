// ===== BUSINESS LOGIC LAYER (VehicleService) =====
import { supabase, isSupabaseConfigured } from '../data-access/supabaseClient.js';
import { mockDb } from '../data-access/mockDataStore.js';

// Malaysian JPJ driving licenses don't have one universal public format the
// way MyKad IC numbers do, so this is a lenient input-capture check (an
// eligibility gate, not a real verification - that remains Module 6's domain).
function validateDriverLicenseNumber(driverLicenseNumber) {
  return /^[A-Za-z0-9]{5,20}$/.test((driverLicenseNumber || '').trim());
}

function validateVehicle({ make, model, plate, seats, driverLicenseNumber }) {
  if (!make?.trim() || !model?.trim()) throw new Error('Make and model are required.');
  if (!plate?.trim()) throw new Error('Plate number is required.');
  if (!validateDriverLicenseNumber(driverLicenseNumber)) {
    throw new Error("Enter a valid driver's license number (5-20 letters/numbers).");
  }
  if (!Number.isInteger(seats) || seats < 1 || seats > 8) {
    throw new Error('Seats must be a whole number between 1 and 8.');
  }
}

export function buildVehicleRecord(userId, vehicle) {
  const record = {
    owner_id: userId,
    make: vehicle.make.trim(),
    model: vehicle.model.trim(),
    plate: vehicle.plate.trim(),
    driver_license_number: vehicle.driverLicenseNumber?.trim() || '',
    colour: vehicle.colour?.trim() || '',
    seats: vehicle.seats,
    year: vehicle.year,
    active: Boolean(vehicle.active)
  };
  if (vehicle.id) record.id = vehicle.id;
  return record;
}

export function hasRegisteredVehicle(vehicles) {
  return Array.isArray(vehicles) && vehicles.length > 0;
}

export const VehicleService = {
  backend: isSupabaseConfigured ? 'supabase' : 'mock',

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
      const record = buildVehicleRecord(userId, vehicle);
      if (vehicle.id) {
        const { id, owner_id: _ownerId, ...patch } = record;
        const { data, error } = await supabase
          .from('vehicles')
          .update(patch)
          .eq('id', id)
          .eq('owner_id', userId)
          .select()
          .single();
        if (error) throw error;
        return data;
      }

      const { id: _id, ...insertRecord } = record;
      const { data, error } = await supabase
        .from('vehicles')
        .insert(insertRecord)
        .select()
        .single();
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
      if (active) {
        const { error: deactivateError } = await supabase
          .from('vehicles')
          .update({ active: false })
          .eq('owner_id', userId);
        if (deactivateError) throw deactivateError;
      }
      const { data, error } = await supabase
        .from('vehicles')
        .update({ active })
        .eq('id', vehicleId)
        .eq('owner_id', userId)
        .select()
        .single();
      if (error) throw error;
      return data;
    }
    return mockDb.setVehicleActive(userId, vehicleId, active);
  }
};
