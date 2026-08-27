import { describe, expect, it, vi } from 'vitest';

// Kept in its own file because the mock below is module-wide: every service
// under test would see a configured Supabase, which is exactly what the other
// TripHistoryEngine tests must NOT see.
//
// The fake client is only as clever as the queries the engine actually makes -
// select/gt/in/eq/single, awaited at the end - so a query the engine does not
// write cannot accidentally pass here.
vi.mock('../../data-access/supabaseClient.js', () => {
  const TABLES = {
    host_impact_stats: [
      { user_id: 'aaaaaaaa-0000-4000-8000-000000000001', completed_trips: 4, co2_saved_kg: 120, reputation_score: 82 },
      { user_id: 'bbbbbbbb-0000-4000-8000-000000000002', completed_trips: 9, co2_saved_kg: 300, reputation_score: 91 },
      // Never ranked: the board asks for completed_trips > 0.
      { user_id: 'cccccccc-0000-4000-8000-000000000003', completed_trips: 0, co2_saved_kg: 0, reputation_score: 50 }
    ],
    profiles: [
      { id: 'aaaaaaaa-0000-4000-8000-000000000001', full_name: 'Ahmad Rizal' },
      { id: 'bbbbbbbb-0000-4000-8000-000000000002', full_name: 'Siti Aminah' },
      { id: 'cccccccc-0000-4000-8000-000000000003', full_name: 'Never Hosted' }
    ]
  };

  return {
    isSupabaseConfigured: true,
    supabase: {
      from(table) {
        let rows = [...(TABLES[table] || [])];
        const query = {
          select: () => query,
          gt: (column, value) => { rows = rows.filter((row) => Number(row[column]) > value); return query; },
          in: (column, values) => { rows = rows.filter((row) => values.includes(row[column])); return query; },
          eq: (column, value) => { rows = rows.filter((row) => row[column] === value); return query; },
          single: async () => (rows[0]
            ? { data: rows[0], error: null }
            : { data: null, error: { message: 'no rows' } }),
          then: (resolve) => resolve({ data: rows, error: null })
        };
        return query;
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

const { TripHistoryEngine } = await import('../TripHistoryEngine.js');

const SITI = 'bbbbbbbb-0000-4000-8000-000000000002';

describe('Module 5 against a configured Supabase backend', () => {
  it('declares its backend like every other service', () => {
    // Module 5 used to be the only service with no backend field at all, which
    // hid the fact that it read demo data while the rest of the app read live
    // data.
    expect(TripHistoryEngine.backend).toBe('supabase');
  });

  it('ranks live hosts instead of refusing to run', async () => {
    // Regression: this used to throw outright, on the grounds that only a
    // service_role function could write Completed. Migration 028 added the
    // check-in/start/arrival path that authenticated users call, so the premise
    // was stale and the board was blocked for no reason.
    const board = await TripHistoryEngine.getLeaderboard(SITI);
    expect(board.entries.map((entry) => entry.name)).toEqual(['Siti Aminah', 'Ahmad Rizal']);
    expect(board.entries.map((entry) => entry.rank)).toEqual([1, 2]);
  });

  it('never ranks a host who has completed nothing', async () => {
    const board = await TripHistoryEngine.getLeaderboard(SITI);
    expect(board.entries.some((entry) => /Never Hosted/.test(entry.name))).toBe(false);
  });

  it('says the board is all-time rather than naming a month it cannot scope to', async () => {
    // rides RLS is "Published or your own", so other hosts' Completed rides are
    // invisible and host_impact_stats has no month column. Claiming a month
    // here would put "August" over lifetime figures.
    const board = await TripHistoryEngine.getLeaderboard(SITI, 2026, 7);
    expect(board.scope).toBe('all-time');
    expect(board.year).toBeNull();
    expect(board.month).toBeNull();
  });

  it('marks the signed-in host so the board can highlight them', async () => {
    const board = await TripHistoryEngine.getLeaderboard(SITI);
    const you = board.entries.find((entry) => entry.isCurrentUser);
    expect(you.id).toBe(SITI);
    // The real name, with isCurrentUser carrying the highlight - exactly what
    // the demo board does.
    expect(you.name).toBe('Siti Aminah');
  });

  it('carries the same composite score the host sees on their own profile', async () => {
    const board = await TripHistoryEngine.getLeaderboard(SITI);
    for (const entry of board.entries) {
      expect(typeof entry.compositeScore).toBe('number');
      expect(entry.badge).toBeTruthy();
    }
  });
});
