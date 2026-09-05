import { beforeEach, describe, expect, it, vi } from 'vitest';

// Kept in its own file because the mock below is module-wide: it makes every
// service in the graph see a configured Supabase.
const harness = vi.hoisted(() => ({ calls: [], failWith: null }));

vi.mock('../../data-access/supabaseClient.js', () => {
  // PostgREST reports an absent column through its schema cache, not 42703.
  const columnMissing = {
    code: 'PGRST204',
    message: "Could not find the 'vehicle_type' column of 'vehicles' in the schema cache"
  };
  return {
    isSupabaseConfigured: true,
    supabase: {
      from() {
        const state = {};
        const builder = {
          insert(values) { state.op = 'insert'; state.values = values; return builder; },
          update(values) { state.op = 'update'; state.values = values; return builder; },
          eq() { return builder; },
          select() { return builder; },
          async single() {
            harness.calls.push({ op: state.op, values: state.values });
            if (harness.failWith) return { data: null, error: harness.failWith };
            if ('vehicle_type' in state.values) return { data: null, error: columnMissing };
            return { data: { id: 'v-1', owner_id: 'user-a', ...state.values }, error: null };
          }
        };
        return builder;
      }
    }
  };
});

const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, value),
  removeItem: (key) => memory.delete(key),
  clear: () => memory.clear()
};

const { VehicleService } = await import('../VehicleService.js');

const draft = {
  make: 'Perodua',
  model: 'Myvi',
  vehicleType: 'hatchback',
  plate: 'VAA 1234',
  colour: 'Blue',
  seats: 4,
  year: 2024,
  active: false
};

describe('vehicle saving against an environment without migration 039', () => {
  beforeEach(() => {
    harness.calls = [];
    harness.failWith = null;
  });

  it('still registers the vehicle when vehicles.vehicle_type is missing', async () => {
    // Regression: Module 4 added vehicle_type to every insert, so on the live
    // database - where 039 is not deployed - adding any vehicle failed, which
    // also blocked Module 2 hosting because a ride requires a host vehicle.
    const saved = await VehicleService.saveVehicle('user-a', draft);

    expect(harness.calls.map((call) => 'vehicle_type' in call.values)).toEqual([true, false]);
    expect(saved).toMatchObject({ make: 'Perodua', plate: 'VAA 1234', vehicleType: '' });
    expect(saved.categoryPending).toBe(true);
  });

  it('keeps the rest of the record on the retry', async () => {
    await VehicleService.saveVehicle('user-a', draft);

    expect(harness.calls[1].values).toMatchObject({
      owner_id: 'user-a',
      model: 'Myvi',
      seats: 4
    });
  });

  it('retries an edit the same way and reports no pending category once deployed', async () => {
    const saved = await VehicleService.saveVehicle('user-a', { ...draft, id: 'v-1' });
    expect(harness.calls.map((call) => call.op)).toEqual(['update', 'update']);
    expect(saved.categoryPending).toBe(true);

    harness.calls = [];
    harness.failWith = null;
    const deployed = await VehicleService.saveVehicle('user-a', { ...draft, vehicleType: '' })
      .catch((error) => error);
    expect(deployed.message).toMatch(/vehicle category/i);
  });

  it('does not swallow an unrelated database failure', async () => {
    harness.failWith = { code: '23505', message: 'duplicate key value violates unique constraint' };
    await expect(VehicleService.saveVehicle('user-a', draft)).rejects.toThrow(/duplicate key/);
    expect(harness.calls).toHaveLength(1);
  });
});
