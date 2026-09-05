// ===== BUSINESS LOGIC LAYER (VehicleService) =====
import { supabase, isSupabaseConfigured } from '../data-access/supabaseClient.js';
import { mockDb } from '../data-access/mockDataStore.js';
import { normalizeVehicleType } from './CompatibilityOptions.js';

function mapVehicleRow(row) {
  if (!row) return row;
  return {
    ...row,
    vehicleType: row.vehicle_type ?? row.vehicleType ?? '',
    // Legacy, read-only: 019/088 captured these per vehicle before the licence
    // moved onto the account. Nothing writes them now.
    driverLicenseNumber: row.driver_license_number ?? row.driverLicenseNumber ?? '',
    driverLicenseExpiry: row.driver_license_expiry ?? row.driverLicenseExpiry ?? ''
  };
}

// Migration 039 adds vehicles.vehicle_type. Until it is deployed the column is
// missing, and blocking the save would take the pre-existing Module 1 vehicle
// registration (and Module 2 hosting, which requires a vehicle) down with it.
function isUndeployedVehicleCategory(error) {
  const detail = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`;
  return error?.code === '42703' || error?.code === 'PGRST204' || /vehicle_type/i.test(detail);
}

// The driver's licence is no longer captured here. It belongs to the account,
// not to each car, and is entered once with the MyKad photo
// (IdentityVerificationService, migration 094). A Host who registers three
// vehicles used to retype the same licence number three times.
function validateVehicle({ make, model, plate, seats }) {
  if (!make?.trim() || !model?.trim()) throw new Error('Make and model are required.');
  if (!plate?.trim()) throw new Error('Plate number is required.');
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
    vehicle_type: normalizeVehicleType(vehicle.vehicleType),
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
      return data.map(mapVehicleRow);
    }
    return mockDb.listVehicles(userId);
  },

  async saveVehicle(userId, vehicle) {
    validateVehicle(vehicle);
    if (!normalizeVehicleType(vehicle.vehicleType)) throw new Error('Choose a vehicle category.');
    if (isSupabaseConfigured) {
      const record = buildVehicleRecord(userId, vehicle);
      const run = vehicle.id
        ? (values) => {
          const { id, owner_id: _ownerId, ...patch } = values;
          return supabase.from('vehicles').update(patch).eq('id', id).eq('owner_id', userId).select().single();
        }
        : (values) => {
          const { id: _id, ...insertRecord } = values;
          return supabase.from('vehicles').insert(insertRecord).select().single();
        };

      let { data, error } = await run(record);
      if (error && isUndeployedVehicleCategory(error)) {
        const { vehicle_type: _vehicleType, ...legacyRecord } = record;
        ({ data, error } = await run(legacyRecord));
        if (!error) return { ...mapVehicleRow(data), categoryPending: true };
      }
      if (error) throw error;
      return mapVehicleRow(data);
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
      return mapVehicleRow(data);
    }
    return mockDb.setVehicleActive(userId, vehicleId, active);
  }
};
