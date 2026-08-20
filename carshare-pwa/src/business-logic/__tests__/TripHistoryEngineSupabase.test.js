import { describe, expect, it, vi } from 'vitest';

// Kept in its own file because the mock below is module-wide: every service
// under test would see a configured Supabase, which is exactly what the other
// TripHistoryEngine tests must NOT see.
vi.mock('../../data-access/supabaseClient.js', () => ({
  isSupabaseConfigured: true,
  supabase: null
}));

const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, value),
  removeItem: (key) => memory.delete(key),
  clear: () => memory.clear()
};

const { TripHistoryEngine, LEADERBOARD_NEEDS_COMPLETED_TRIPS } = await import('../TripHistoryEngine.js');

describe('Module 5 against a configured Supabase backend', () => {
  it('declares its backend like every other service', () => {
    // Module 5 used to be the only service with no backend field at all, which
    // hid the fact that it read demo data while the rest of the app read live
    // data.
    expect(TripHistoryEngine.backend).toBe('supabase');
  });

  it('refuses the leaderboard with the reason instead of querying demo hosts', async () => {
    // Regression: the leaderboard read host ids from the demo store and passed
    // them to the Supabase-backed HostImpactEngine, so Postgres rejected them
    // with 'invalid input syntax for type uuid: "u_host_ahmad"'. Failing early
    // with the real reason beats a mixed-backend crash.
    await expect(TripHistoryEngine.getLeaderboard('7c9e6679-7425-40de-944b-e07fc1f90ae7'))
      .rejects.toThrow(LEADERBOARD_NEEDS_COMPLETED_TRIPS);
  });

  it('explains the missing upstream rather than blaming the module', () => {
    expect(LEADERBOARD_NEEDS_COMPLETED_TRIPS).toMatch(/completed trips/i);
    expect(LEADERBOARD_NEEDS_COMPLETED_TRIPS).toMatch(/live backend|connected database/i);
  });
});
