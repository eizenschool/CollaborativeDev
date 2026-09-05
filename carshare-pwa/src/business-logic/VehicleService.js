// ===== BUSINESS LOGIC LAYER (VehicleService) =====
import { supabase, isSupabaseConfigured } from '../data-access/supabaseClient.js';
import { mockDb } from '../data-access/mockDataStore.js';
import { normalizeVehicleType } from './CompatibilityOptions.js';

function mapVehicleRow(row) {
  if (!row) return row;
  return {
    ...row,
    vehicleType: row.vehicle_type ?? row.vehicleType ?? '',
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

// Same fallback shape as vehicle_type above, for the same reason: until
// migration 088 is deployed the column does not exist, and refusing the save
// would take vehicle registration - and therefore hosting - down with it.
function isUndeployedLicenseExpiry(error) {
  const detail = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`;
  return (error?.code === '42703' || error?.code === 'PGRST204')
    && /driver_license_expiry/i.test(detail);
}

// Malaysian JPJ driving licenses don't have one universal public format the
// way MyKad IC numbers do, so this is a lenient input-capture check (an
// eligibility gate, not a real verification - that remains Module 6's domain).
function validateDriverLicenseNumber(driverLicenseNumber) {
  return /^[A-Za-z0-9]{5,20}$/.test((driverLicenseNumber || '').trim());
}

// A license that has already lapsed is not an eligibility gate anybody can
// pass, so the expiry is required on save and must still be in the future.
// Compared date-only: a license is valid through the whole of its expiry day.
export function isDriverLicenseCurrent(expiry, now = new Date()) {
  if (!expiry) return false;
  const expiryDate = new Date(`${String(expiry).slice(0, 10)}T23:59:59.999Z`);
  if (Number.isNaN(expiryDate.getTime())) return false;
  const today = new Date(`${new Date(now).toISOString().slice(0, 10)}T00:00:00.000Z`);
  return expiryDate >= today;
}

function validateVehicle({ make, model, plate, seats, driverLicenseNumber, driverLicenseExpiry }) {
  if (!make?.trim() || !model?.trim()) throw new Error('Make and model are required.');
  if (!plate?.trim()) throw new Error('Plate number is required.');
  if (!validateDriverLicenseNumber(driverLicenseNumber)) {
    throw new Error("Enter a valid driver's license number (5-20 letters/numbers).");
  }
  if (!driverLicenseExpiry) throw new Error("Enter your driver's license expiry date.");
  if (!isDriverLicenseCurrent(driverLicenseExpiry)) {
    throw new Error("That driver's license has already expired. Renew it before registering this vehicle.");
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
    driver_license_expiry: vehicle.driverLicenseExpiry || null,
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

// Publishing needs a vehicle whose license is usable, not merely one that
// exists. A vehicle saved before migration 088 has no expiry on record; that
// unknown is treated as usable here and is caught server-side only when the
// date is actually known to be past, so no existing Host is locked out.
export function hasPublishableVehicle(vehicles, now = new Date()) {
  return Array.isArray(vehicles) && vehicles.some((vehicle) => (
    validateDriverLicenseNumber(vehicle?.driverLicenseNumber ?? vehicle?.driver_license_number)
    && (
      !(vehicle?.driverLicenseExpiry ?? vehicle?.driver_license_expiry)
      || isDriverLicenseCurrent(vehicle.driverLicenseExpiry ?? vehicle.driver_license_expiry, now)
    )
  ));
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

      // Each fallback narrows the same payload, so an environment missing both
      // columns still lands on a record without either rather than retrying a
      // shape it already rejected.
      let payload = record;
      let expiryPending = false;
      let { data, error } = await run(payload);
      if (error && isUndeployedLicenseExpiry(error)) {
        const { driver_license_expiry: _expiry, ...legacyRecord } = payload;
        payload = legacyRecord;
        expiryPending = true;
        ({ data, error } = await run(payload));
      }
      if (error && isUndeployedVehicleCategory(error)) {
        const { vehicle_type: _vehicleType, ...legacyRecord } = payload;
        payload = legacyRecord;
        ({ data, error } = await run(payload));
        if (!error) {
          return { ...mapVehicleRow(data), categoryPending: true, ...(expiryPending && { licenseExpiryPending: true }) };
        }
      }
      if (error) throw error;
      return expiryPending ? { ...mapVehicleRow(data), licenseExpiryPending: true } : mapVehicleRow(data);
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
