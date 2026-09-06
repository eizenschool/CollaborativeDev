// ===== BUSINESS LOGIC LAYER (VehicleService) =====
import { vehicleSupabaseAdapter } from '../../data-access/m1-profile/vehicleSupabaseAdapter.js';
import '../shared/fixture/legacyMockDb.js';
import { profileMockAdapter } from '../../data-access/m1-profile/profileMockAdapter.js';
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
  backend: vehicleSupabaseAdapter.isConfigured ? 'supabase' : 'mock',

  async listVehicles(userId) {
    if (vehicleSupabaseAdapter.isConfigured) {
      const { data, error } = await vehicleSupabaseAdapter.listByOwner(userId);
      if (error) throw error;
      return data.map(mapVehicleRow);
    }
    return profileMockAdapter.listVehicles(userId);
  },

  async saveVehicle(userId, vehicle) {
    validateVehicle(vehicle);
    if (!normalizeVehicleType(vehicle.vehicleType)) throw new Error('Choose a vehicle category.');
    if (vehicleSupabaseAdapter.isConfigured) {
      const record = buildVehicleRecord(userId, vehicle);
      const run = (values) => vehicleSupabaseAdapter.save(userId, values);

      let { data, error } = await run(record);
      if (error && isUndeployedVehicleCategory(error)) {
        const { vehicle_type: _vehicleType, ...legacyRecord } = record;
        ({ data, error } = await run(legacyRecord));
        if (!error) return { ...mapVehicleRow(data), categoryPending: true };
      }
      if (error) throw error;
      return mapVehicleRow(data);
    }
    return profileMockAdapter.upsertVehicle(userId, vehicle);
  },

  async removeVehicle(userId, vehicleId) {
    if (vehicleSupabaseAdapter.isConfigured) {
      const { error } = await vehicleSupabaseAdapter.remove(userId, vehicleId);
      if (error) throw error;
      return true;
    }
    return profileMockAdapter.removeVehicle(userId, vehicleId);
  },

  async setActiveVehicle(userId, vehicleId, active) {
    if (vehicleSupabaseAdapter.isConfigured) {
      const { data, error } = await vehicleSupabaseAdapter.setActive(userId, vehicleId, active);
      if (error) throw error;
      return mapVehicleRow(data);
    }
    return profileMockAdapter.setVehicleActive(userId, vehicleId, active);
  }
};
