import { beforeEach, describe, expect, it } from 'vitest';

const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, value),
  removeItem: (key) => memory.delete(key),
  clear: () => memory.clear()
};

const { TripHistoryEngine, deriveDisplayStatus, estimateCarbonSavedKg, tripDistanceKm } = await import(
  '../TripHistoryEngine.js'
);

const STORAGE_KEY = 'letstumpang_mock_db_v1';
const USER = 'u_demo_1';

// Fixed instant so every derived status is deterministic: 2026-08-13 12:00 in
// Asia/Kuala_Lumpur, the timezone the app formats departures in.
const NOW = new Date('2026-08-13T04:00:00.000Z');

// Every seeded ride is already past 'Published', so mockDataStore's lazy
// lifecycle pass (Published -> Matched | Expired) never rewrites the fixture
// and the tests stay independent of the wall clock.
function ride(overrides) {
  return {
    journeyScale: 'Urban',
    seatsTotal: 2,
    seatsAvailable: 0,
    contribution: '',
    restrictionTags: [],
    waypoints: [],
    status: 'Matched',
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides
  };
}

function seed() {
  memory.clear();
  memory.set(
    STORAGE_KEY,
    JSON.stringify({
      currentUserId: USER,
      users: {
        u_demo_1: { id: USER, fullName: 'Jamie Delacroix', profilePhotoUrl: null, status: 'active' },
        u_host_sarah: { id: 'u_host_sarah', fullName: 'Sarah Tan', profilePhotoUrl: null, status: 'active' },
        u_host_ahmad: { id: 'u_host_ahmad', fullName: 'Ahmad Rizal', profilePhotoUrl: null, status: 'active' },
        u_host_raj: { id: 'u_host_raj', fullName: 'Raj Kumar', profilePhotoUrl: null, status: 'active' }
      },
      vehicles: {},
      impact: {
        u_demo_1: { completedTrips: 34, co2SavedKg: 287, reputationScore: 78, rating: 4.9 },
        u_host_ahmad: { completedTrips: 40, co2SavedKg: 120, reputationScore: 85, rating: 4.9 },
        u_host_sarah: { completedTrips: 25, co2SavedKg: 60, reputationScore: 70, rating: 4.7 },
        u_host_raj: { completedTrips: 8, co2SavedKg: 15, reputationScore: 45, rating: 4.5 }
      },
      rides: {
        // Hosted, finished, carried 2 of 3 seats -> 340km Intercity trip.
        hosted_done: ride({
          id: 'hosted_done', hostId: USER, pickup: 'KL Sentral', destination: 'Melaka',
          departureAt: '2026-08-05T01:00:00.000Z', journeyScale: 'Intercity',
          seatsTotal: 3, seatsAvailable: 1, status: 'Completed'
        }),
        // Published, nobody joined, departure passed. Module 2 lapsed it.
        hosted_expired: ride({
          id: 'hosted_expired', hostId: USER, pickup: 'Ipoh', destination: 'Penang',
          departureAt: '2026-08-06T01:00:00.000Z', journeyScale: 'Intercity',
          seatsTotal: 3, seatsAvailable: 3, status: 'Expired'
        }),
        // Matched but not yet departed.
        hosted_upcoming: ride({
          id: 'hosted_upcoming', hostId: USER, pickup: 'Bangsar', destination: 'Cyberjaya',
          departureAt: '2099-01-01T00:00:00.000Z', seatsTotal: 3, seatsAvailable: 1
        }),
        // Finished in July with every seat still free.
        hosted_empty: ride({
          id: 'hosted_empty', hostId: USER, pickup: 'Shah Alam', destination: 'Klang',
          departureAt: '2026-07-10T01:00:00.000Z', seatsTotal: 4, seatsAvailable: 4, status: 'Completed'
        }),
        joined_accepted: ride({
          id: 'joined_accepted', hostId: 'u_host_sarah', pickup: 'SS2', destination: 'USJ 10',
          departureAt: '2026-08-08T01:00:00.000Z', seatsTotal: 2, seatsAvailable: 0, status: 'Completed'
        }),
        joined_expired: ride({
          id: 'joined_expired', hostId: 'u_host_sarah', pickup: 'Subang Jaya', destination: 'Putrajaya',
          departureAt: '2026-08-10T01:00:00.000Z', seatsTotal: 2, seatsAvailable: 1, status: 'Expired'
        }),
        joined_pending: ride({
          id: 'joined_pending', hostId: 'u_host_raj', pickup: 'Ampang', destination: 'KLCC',
          departureAt: '2026-08-09T01:00:00.000Z', seatsTotal: 2, seatsAvailable: 1, status: 'Completed'
        }),
        // Someone else's finished trip - the signed-in user has no part in it.
        stranger_done: ride({
          id: 'stranger_done', hostId: 'u_host_ahmad', pickup: 'Johor', destination: 'KL',
          departureAt: '2026-08-07T01:00:00.000Z', journeyScale: 'Intercity',
          seatsTotal: 3, seatsAvailable: 1, status: 'Completed'
        })
      },
      rideRequests: {
        rq_accepted: {
          id: 'rq_accepted', rideId: 'joined_accepted', requesterId: USER, seatsRequested: 2,
          companionNames: ['Aina'], status: 'Accepted', createdAt: '2026-08-01T00:00:00.000Z'
        },
        rq_pending: {
          id: 'rq_pending', rideId: 'joined_pending', requesterId: USER, seatsRequested: 1,
          companionNames: [], status: 'Pending', createdAt: '2026-08-02T00:00:00.000Z'
        },
        rq_expired_accepted: {
          id: 'rq_expired_accepted', rideId: 'joined_expired', requesterId: USER, seatsRequested: 1,
          companionNames: [], status: 'Expired', acceptedAt: '2026-08-09T00:00:00.000Z',
          processedAt: '2026-08-10T01:30:00.000Z', createdAt: '2026-08-08T00:00:00.000Z'
        },
        rq_on_my_ride: {
          id: 'rq_on_my_ride', rideId: 'hosted_done', requesterId: 'u_host_sarah', seatsRequested: 2,
          companionNames: ['Daniel'], status: 'Accepted', createdAt: '2026-08-01T00:00:00.000Z'
        }
      },
      rideReviews: {}
    })
  );
}

beforeEach(seed);

describe('Module 5 lifecycle status', () => {
  it('never reports an expired ride as completed, however long ago it departed', () => {
    // Regression: status used to be derived from the clock alone, so every past
    // ride became 'Completed' - including ones nobody ever joined.
    const lapsed = { status: 'Expired', departureAt: '2026-08-06T01:00:00.000Z' };
    expect(deriveDisplayStatus(lapsed, NOW)).toBe('Expired');
  });

  it('passes through the states Module 2 owns without reinterpreting them', () => {
    for (const status of ['Draft', 'Published', 'Cancelled', 'Completed', 'In Transit']) {
      expect(deriveDisplayStatus({ status, departureAt: '2026-08-01T00:00:00.000Z' }, NOW)).toBe(status);
    }
  });

  it('keeps a matched ride matched until its departure time arrives', () => {
    // Regression: 'Matched' was previously unreachable, so FR-5.2's Matched
    // filter could only ever render an empty list.
    const upcoming = { status: 'Matched', departureAt: '2099-01-01T00:00:00.000Z' };
    expect(deriveDisplayStatus(upcoming, NOW)).toBe('Matched');
  });

  it('never invents in-transit or completed state for a departed matched ride', () => {
    const oneHourAgo = { status: 'Matched', departureAt: '2026-08-13T03:00:00.000Z' };
    const yesterday = { status: 'Matched', departureAt: '2026-08-12T04:00:00.000Z' };
    expect(deriveDisplayStatus(oneHourAgo, NOW)).toBe('Matched');
    expect(deriveDisplayStatus(yesterday, NOW)).toBe('Matched');
  });
});

describe('Module 5 trip distance', () => {
  it('uses the distance Module 2 actually routed', () => {
    // Publishing takes a route quote and stores its distance on the ride, so
    // a trip that went through the current flow has a real number.
    expect(tripDistanceKm({ routeDistanceMeters: 23400, journeyScale: 'Urban' }))
      .toEqual({ km: 23.4, measured: true });
  });

  it('falls back to the table for a ride that predates route quotes', () => {
    expect(tripDistanceKm({ journeyScale: 'Urban' })).toEqual({ km: 18, measured: false });
    expect(tripDistanceKm({ journeyScale: 'Intercity' })).toEqual({ km: 340, measured: false });
  });

  it('says which figure it used, so the card can mark an estimate', () => {
    expect(tripDistanceKm({ routeDistanceMeters: 5000 }).measured).toBe(true);
    expect(tripDistanceKm({ routeDistanceMeters: null }).measured).toBe(false);
  });

  it('treats a missing, zero or broken distance as no distance at all', () => {
    // A zero would otherwise wipe out the trip's carbon rather than fall back.
    for (const bad of [null, undefined, 0, -1, NaN, 'far']) {
      expect(tripDistanceKm({ routeDistanceMeters: bad, journeyScale: 'Urban' }))
        .toEqual({ km: 18, measured: false });
    }
  });

  it('survives a ride object that is not there', () => {
    expect(tripDistanceKm(undefined).km).toBe(18);
  });
});

describe('Module 5 carbon estimate', () => {
  it('claims nothing for a trip that carried no passengers', () => {
    // Regression: the estimate used to floor the passenger count at 1, so an
    // empty trip still booked a full seat's worth of savings.
    expect(estimateCarbonSavedKg({ journeyScale: 'Urban', seatsTotal: 4, seatsAvailable: 4 })).toBe(0);
  });

  it('scales with journey distance and seats actually filled', () => {
    expect(estimateCarbonSavedKg({ journeyScale: 'Urban', seatsTotal: 2, seatsAvailable: 0 })).toBe(4.3);
    expect(estimateCarbonSavedKg({ journeyScale: 'Intercity', seatsTotal: 3, seatsAvailable: 1 })).toBe(81.6);
  });

  it('prefers the routed distance over the table for the same ride', () => {
    // 42 km routed x 2 passengers x 0.12 = 10.08, against the Urban table's
    // 18 km x 2 x 0.12 = 4.3. The real figure has to win.
    const ride = { journeyScale: 'Urban', seatsTotal: 3, seatsAvailable: 1 };
    expect(estimateCarbonSavedKg(ride)).toBe(4.3);
    expect(estimateCarbonSavedKg({ ...ride, routeDistanceMeters: 42000 })).toBe(10.1);
  });
});

describe('Module 5 ride history', () => {
  it('counts only accepted requests as trips the user joined', async () => {
    const history = await TripHistoryEngine.listHistory(USER, NOW);
    const ids = history.map((trip) => trip.id);
    expect(ids).toContain('joined_accepted');
    expect(ids).toContain('joined_expired');
    expect(ids).not.toContain('joined_pending');
    expect(ids).not.toContain('stranger_done');
  });

  it('orders history by departure, most recent first', async () => {
    const history = await TripHistoryEngine.listHistory(USER, NOW);
    expect(history.map((trip) => trip.id)).toEqual([
      'hosted_upcoming',
      'joined_expired',
      'joined_accepted',
      'hosted_expired',
      'hosted_done',
      'hosted_empty'
    ]);
  });

  it('labels each trip with the role the user played', async () => {
    const history = await TripHistoryEngine.listHistory(USER, NOW);
    const byId = Object.fromEntries(history.map((trip) => [trip.id, trip]));
    expect(byId.hosted_done.role).toBe('Host');
    expect(byId.joined_accepted.role).toBe('Passenger');
  });
});

describe('Module 5 trip detail access control', () => {
  it('hides a trip the user neither hosted nor joined', async () => {
    // UC5.3 C1. Answering 'not found' rather than 'forbidden' keeps the
    // response from confirming that someone else's trip exists.
    expect(await TripHistoryEngine.getTripDetail('stranger_done', USER, NOW)).toBeNull();
  });

  it('hides a trip the user only ever requested', async () => {
    expect(await TripHistoryEngine.getTripDetail('joined_pending', USER, NOW)).toBeNull();
  });

  it('returns null for a trip that does not exist', async () => {
    expect(await TripHistoryEngine.getTripDetail('no_such_ride', USER, NOW)).toBeNull();
  });

  it('gives the host the full accepted party', async () => {
    const detail = await TripHistoryEngine.getTripDetail('hosted_done', USER, NOW);
    expect(detail.role).toBe('Host');
    expect(detail.participants.map((person) => [person.name, person.role])).toEqual([
      ['Jamie Delacroix', 'Host'],
      ['Sarah Tan', 'Passenger'],
      ['Daniel', 'Companion']
    ]);
  });

  it('gives an accepted passenger the host and their own party only', async () => {
    const detail = await TripHistoryEngine.getTripDetail('joined_accepted', USER, NOW);
    expect(detail.role).toBe('Passenger');
    expect(detail.participants.map((person) => [person.name, person.role])).toEqual([
      ['Sarah Tan', 'Host'],
      ['Jamie Delacroix', 'Passenger'],
      ['Aina', 'Companion']
    ]);
  });

  it('keeps an accepted-then-expired passenger in history without impact credit', async () => {
    const detail = await TripHistoryEngine.getTripDetail('joined_expired', USER, NOW);
    const summary = await TripHistoryEngine.getImpactSummary(USER, NOW);

    expect(detail).toMatchObject({ role: 'Passenger', status: 'Expired', carbonSavedKg: null });
    expect(detail.participants.map((person) => person.name)).toEqual(['Sarah Tan', 'Jamie Delacroix']);
    expect(summary.completedTrips).toBe(3);
  });
});

describe('Module 5 environmental impact statistics', () => {
  it('excludes expired and unfinished trips from every total', async () => {
    const summary = await TripHistoryEngine.getImpactSummary(USER, NOW);
    // hosted_done 81.6 + hosted_empty 0 + joined_accepted 4.3. The expired and
    // upcoming rides contribute nothing.
    expect(summary.completedTrips).toBe(3);
    expect(summary.totalCarbonSavedKg).toBe(85.9);
    expect(summary.totalDistanceKm).toBe(376);
  });

  it('credits passengers carried to the host only', async () => {
    const summary = await TripHistoryEngine.getImpactSummary(USER, NOW);
    // Two seats filled on hosted_done; a passenger did not carry themselves.
    expect(summary.passengersCarried).toBe(2);
  });

  it('reports a real six-month carbon trend ending on the current month', async () => {
    const { monthlyTrend } = await TripHistoryEngine.getImpactSummary(USER, NOW);
    expect(monthlyTrend).toHaveLength(6);
    expect(monthlyTrend.map((point) => point.label)).toEqual(['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug']);
    expect(monthlyTrend.at(-1)).toMatchObject({ year: 2026, month: 7, carbonSavedKg: 85.9 });
    expect(monthlyTrend.at(-2)).toMatchObject({ month: 6, carbonSavedKg: 0 });
  });
});

describe('Module 5 monthly report', () => {
  it('reports only the completed trips that fall in the requested month', async () => {
    const august = await TripHistoryEngine.getMonthlyReport(USER, 2026, 7, NOW);
    expect(august.hasData).toBe(true);
    expect(august.trips.map((trip) => trip.id)).toEqual(['joined_accepted', 'hosted_done']);
    expect(august.totalCarbonSavedKg).toBe(85.9);
    expect(august.totalDistanceKm).toBe(358);
  });

  it('reports an empty month rather than failing', async () => {
    const june = await TripHistoryEngine.getMonthlyReport(USER, 2026, 5, NOW);
    expect(june).toMatchObject({ hasData: false, completedTrips: 0, totalCarbonSavedKg: 0 });
    expect(june.trips).toEqual([]);
  });
});

describe('Module 5 community leaderboard', () => {
  it('ranks only hosts who completed a trip in the requested month', async () => {
    // Regression: the leaderboard took no period at all and ranked every host
    // all-time, while the heading above it advertised the current month.
    const board = await TripHistoryEngine.getLeaderboard(USER, 2026, 7, NOW);
    expect(board).toMatchObject({ year: 2026, month: 7 });
    expect(board.entries.map((entry) => entry.id)).toEqual([
      USER,          // 34*2.0 + 287*0.5 + 78*0.8 = 273.9
      'u_host_ahmad', // 208
      'u_host_sarah', // 136
      'u_host_raj'    // 59.5
    ]);
    expect(board.entries.map((entry) => entry.rank)).toEqual([1, 2, 3, 4]);
  });

  it('scopes a different month to that month\'s hosts', async () => {
    const july = await TripHistoryEngine.getLeaderboard(USER, 2026, 6, NOW);
    expect(july.entries.map((entry) => entry.id)).toEqual([USER]);
  });

  it('reuses the profile composite score so ranks match a host\'s own page', async () => {
    const board = await TripHistoryEngine.getLeaderboard(USER, 2026, 7, NOW);
    const me = board.entries.find((entry) => entry.isCurrentUser);
    expect(me).toMatchObject({ rank: 1, compositeScore: 273.9 });
    expect(me.badge.name).toBeTruthy();
  });
});
