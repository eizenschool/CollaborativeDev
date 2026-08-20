// ===== DATA ACCESS LAYER (mockDataStore) =====
// --- DEV-ONLY FALLBACK STORE ---
// 3.1.3(a) explains why localStorage cannot be the platform's Data Processing Layer:
// it is scoped to a single browser and can't support a Host on one device being found
// by a Client on another. That reasoning still holds here - this file is NOT a
// substitute for Supabase, it exists only so this prototype has something to render
// when no VITE_SUPABASE_URL/KEY is configured (e.g. running the demo offline).
// Every function mirrors the shape of a real Supabase call so swapping this module
// out for supabaseClient calls in Business Logic Layer services is a like-for-like
// change, not a rewrite.

import { rideIntervalsOverlap } from '../business-logic/rideDateTime.js';

const STORAGE_KEY = 'letstumpang_mock_db_v1';

const FIXTURE_DESTINATION_PLACE_IDS = Object.freeze({
  r_1: 'fixture_georgetown',
  r_3: 'fixture_chain_a',
  r_6: 'fixture_jonker'
});

const seedData = {
  currentUserId: 'u_demo_1',
  users: {
    u_demo_1: {
      id: 'u_demo_1',
      fullName: 'Jamie Delacroix',
      email: 'jamie@letstumpang.app',
      phone: '+1 555 0134',
      passwordHash: 'demo-hash', // never store plaintext even in the mock
      emergencyContact: { name: '', phone: '', relationship: '' },
      spokenLanguages: ['english', 'malay'],
      profilePhotoUrl: null,
      status: 'active', // 'active' | 'deactivated' - Account Settings (FR-1.x)
      createdAt: '2026-02-10T00:00:00.000Z'
    },
    // Seeded so the Sign Up screen's own hint - "Use test@example.com to trigger
    // duplicate error" - actually reproduces that error in this offline demo.
    u_demo_2: {
      id: 'u_demo_2',
      fullName: 'Demo Existing User',
      email: 'test@example.com',
      phone: '',
      passwordHash: 'demo-hash',
      emergencyContact: { name: '', phone: '', relationship: '' },
      spokenLanguages: [],
      profilePhotoUrl: null,
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z'
    },
    // Other hosts, seeded read-only so the Ride Hub (Module 2) has a realistic
    // marketplace to browse/search against without a live backend. Not signable-in.
    u_host_ahmad: { id: 'u_host_ahmad', fullName: 'Ahmad Rizal', profilePhotoUrl: null, spokenLanguages: ['malay', 'english'], status: 'active' },
    u_host_sarah: { id: 'u_host_sarah', fullName: 'Sarah Tan', profilePhotoUrl: null, spokenLanguages: ['english', 'mandarin', 'cantonese'], status: 'active' },
    u_host_raj: { id: 'u_host_raj', fullName: 'Raj Kumar', profilePhotoUrl: null, spokenLanguages: ['english', 'tamil'], status: 'active' },
    u_host_nurul: { id: 'u_host_nurul', fullName: 'Nurul Ain', profilePhotoUrl: null, spokenLanguages: ['malay'], status: 'active' }
  },
  vehicles: {
    u_demo_1: [
      {
        id: 'v_1',
        make: 'Toyota',
        model: 'Camry',
        vehicleType: 'sedan',
        plate: 'NSW 4KL 291',
        colour: 'Pearl White',
        seats: 4,
        year: 2021,
        active: true
      },
      {
        id: 'v_2',
        make: 'Honda',
        model: 'Civic',
        vehicleType: 'sedan',
        plate: 'VIC 8BM 774',
        colour: 'Midnight Blue',
        seats: 3,
        year: 2019,
        active: false
      }
    ],
    u_host_ahmad: [{ id: 'v_ahmad', make: 'Perodua', model: 'Alza', vehicleType: 'mpv', plate: 'WXX 101', colour: 'Silver', seats: 6, year: 2023, active: true }],
    u_host_sarah: [{ id: 'v_sarah', make: 'Honda', model: 'HR-V', vehicleType: 'suv', plate: 'BXX 202', colour: 'White', seats: 4, year: 2022, active: true }],
    u_host_raj: [{ id: 'v_raj', make: 'Perodua', model: 'Myvi', vehicleType: 'hatchback', plate: 'VXX 303', colour: 'Blue', seats: 3, year: 2021, active: true }],
    u_host_nurul: [{ id: 'v_nurul', make: 'Toyota', model: 'Hiace', vehicleType: 'van', plate: 'WXX 404', colour: 'Black', seats: 8, year: 2020, active: true }]
  },
  // Reputation Score Engine inputs (3.1.2.a) - completed trips, CO2 saved, and
  // reputation score feed the weighted Composite Impact Score on the Host Dashboard.
  impact: {
    u_demo_1: { completedTrips: 34, co2SavedKg: 287, reputationScore: 78, rating: 4.9 },
    // Ratings shown on Ride Hub cards (Module 2) are a separate public "star"
    // average (Module 2 FR-2.12 Rate & Review) from the 0-100 reputation score -
    // seeded directly here since the Rate & Review screen isn't built yet.
    // completedTrips/co2SavedKg/reputationScore still feed the same Host Impact
    // Engine composite-score formula used on My Profile, so tier badges match.
    u_host_ahmad: { completedTrips: 40, co2SavedKg: 120, reputationScore: 85, rating: 4.9 },
    u_host_sarah: { completedTrips: 25, co2SavedKg: 60, reputationScore: 70, rating: 4.7 },
    u_host_raj: { completedTrips: 8, co2SavedKg: 15, reputationScore: 45, rating: 4.5 },
    u_host_nurul: { completedTrips: 38, co2SavedKg: 110, reputationScore: 84, rating: 4.8 }
  },
  // Ride Sharing Management (Module 2, FR-2.x) - Ride Management Component's
  // records. Seeded with 4 published rides so Find a Ride has something to browse.
  rides: {
    r_1: {
      id: 'r_1',
      hostId: 'u_host_ahmad',
      pickup: 'KL Sentral, Brickfields',
      destination: 'Georgetown, Penang',
      date: '2026-08-15',
      time: '07:00',
      journeyScale: 'Intercity',
      vehicleId: 'v_ahmad',
      seatsTotal: 3,
      seatsAvailable: 3,
      contribution: 'Snacks & drinks',
      restrictionTags: ['Pet-friendly', 'No smoking'],
      status: 'Published',
      createdAt: '2026-08-01T00:00:00.000Z'
    },
    r_2: {
      id: 'r_2',
      hostId: 'u_host_sarah',
      pickup: 'SS2, Petaling Jaya',
      destination: 'USJ 10, Subang Jaya',
      date: '2026-08-17',
      time: '07:30',
      journeyScale: 'Urban',
      vehicleId: 'v_sarah',
      seatsTotal: 2,
      seatsAvailable: 2,
      contribution: 'Toll contribution',
      restrictionTags: ['No smoking', 'Women-only'],
      status: 'Published',
      createdAt: '2026-08-01T00:00:00.000Z'
    },
    r_3: {
      id: 'r_3',
      hostId: 'u_host_raj',
      pickup: 'Ampang Point, Kuala Lumpur',
      destination: 'KLCC, Kuala Lumpur',
      date: '2026-08-18',
      time: '08:15',
      journeyScale: 'Urban',
      vehicleId: 'v_raj',
      seatsTotal: 1,
      seatsAvailable: 1,
      contribution: 'No contribution needed',
      restrictionTags: ['No smoking'],
      status: 'Published',
      createdAt: '2026-08-01T00:00:00.000Z'
    },
    r_4: {
      id: 'r_4',
      hostId: 'u_host_nurul',
      pickup: 'Shah Alam City Centre',
      destination: 'Putrajaya IOI City Mall',
      date: '2026-08-19',
      time: '08:30',
      journeyScale: 'Intercity',
      vehicleId: 'v_nurul',
      seatsTotal: 4,
      seatsAvailable: 4,
      contribution: 'Hot drinks',
      restrictionTags: ['Pet-friendly', 'No smoking', 'Child seat available'],
      status: 'Published',
      createdAt: '2026-08-01T00:00:00.000Z'
    },
    // One host ride for the signed-in demo user makes the mobile management
    // screens reachable immediately, while published rides above remain the
    // public marketplace examples.
    r_5: {
      id: 'r_5',
      hostId: 'u_demo_1',
      pickup: 'Bangsar LRT, Kuala Lumpur',
      destination: 'Cyberjaya, Selangor',
      pickupInstructions: 'Meet beside the main LRT entrance.',
      date: '2026-08-20',
      time: '08:00',
      journeyScale: 'Urban',
      vehicleId: 'v_1',
      seatsTotal: 3,
      seatsAvailable: 2,
      contribution: 'Toll contribution',
      restrictionTags: ['No smoking', 'Music OK'],
      status: 'Published',
      createdAt: '2026-08-02T00:00:00.000Z'
    },
    r_6: {
      id: 'r_6',
      hostId: 'u_host_ahmad',
      pickup: 'KL Sentral, Kuala Lumpur',
      destination: 'Melaka Sentral, Melaka',
      date: '2026-08-10',
      time: '09:00',
      journeyScale: 'Intercity',
      vehicleId: 'v_ahmad',
      seatsTotal: 3,
      seatsAvailable: 2,
      contribution: 'Share snacks',
      restrictionTags: ['No smoking'],
      waypoints: [],
      status: 'Completed',
      createdAt: '2026-08-01T00:00:00.000Z'
    }
  },
  rideRequests: {
    rq_1: {
      id: 'rq_1', rideId: 'r_5', requesterId: 'u_host_ahmad', seatsRequested: 2,
      companionNames: ['Nadia Rizal'], status: 'Pending', createdAt: '2026-08-11T01:00:00.000Z'
    },
    rq_2: {
      id: 'rq_2', rideId: 'r_5', requesterId: 'u_host_sarah', seatsRequested: 1,
      companionNames: [], status: 'Accepted', createdAt: '2026-08-11T02:00:00.000Z', processedAt: '2026-08-11T03:00:00.000Z'
    },
    rq_3: {
      id: 'rq_3', rideId: 'r_1', requesterId: 'u_demo_1', seatsRequested: 1,
      companionNames: [], status: 'Pending', createdAt: '2026-08-11T04:00:00.000Z'
    },
    rq_4: {
      id: 'rq_4', rideId: 'r_6', requesterId: 'u_demo_1', seatsRequested: 1,
      companionNames: [], status: 'Accepted', createdAt: '2026-08-05T04:00:00.000Z', processedAt: '2026-08-05T05:00:00.000Z'
    }
  },
  favourites: {
    u_demo_1: [
      { rideId: 'r_1', createdAt: '2026-08-12T09:00:00.000Z' },
      { rideId: 'r_6', createdAt: '2026-08-11T09:00:00.000Z' }
    ]
  },
  rideReviews: {}
};

function toMockDepartureAt(date, time) {
  return new Date(`${date}T${time}:00+08:00`).toISOString();
}

function normalizeModule2State(db) {
  db.rideRequests ||= {};
  db.rideReviews ||= {};
  db.favourites ||= {};
  for (const user of Object.values(db.users || {})) user.spokenLanguages ||= [];
  for (const ride of Object.values(db.rides || {})) {
    // Repair the pre-vehicle demo Host ride already persisted in older offline
    // browser sessions so Edit Ride can hydrate the same contract as Supabase.
    if (ride.id === 'r_5' && !ride.vehicleId) ride.vehicleId = 'v_1';
    if (!ride.destinationLocation && FIXTURE_DESTINATION_PLACE_IDS[ride.id]) {
      ride.destinationLocation = {
        source: 'place',
        placeId: FIXTURE_DESTINATION_PLACE_IDS[ride.id]
      };
    }
    ride.departureAt ||= toMockDepartureAt(ride.date, ride.time);
    ride.date ||= new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', dateStyle: 'short' }).format(new Date(ride.departureAt));
    ride.publishedAt ??= ride.status === 'Draft' ? null : ride.createdAt;
    ride.recruitmentClosedAt ??= null;
    ride.cancelReason ??= null;
    ride.expiredAt ??= null;
    ride.updatedAt ??= ride.createdAt;
    ride.waypoints ||= [];
    ride.estimatedArrivalAt ??= null;
    ride.scheduleBufferUntil ??= ride.estimatedArrivalAt
      ? new Date(new Date(ride.estimatedArrivalAt).getTime() + 30 * 60 * 1000).toISOString()
      : null;
    ride.routeDistanceMeters ??= null;
    ride.routeDurationSeconds ??= null;
    ride.routeStopoverSeconds ??= null;
    ride.driverArrivedAt ??= null;
    ride.passengerConfirmationDueAt ??= null;
    ride.completedAt ??= null;
  }
  for (const request of Object.values(db.rideRequests)) {
    request.boardingStatus ??= 'Pending';
    request.checkedInAt ??= null;
    request.checkInDistanceMeters ??= null;
    request.noShowAt ??= null;
    request.noShowMarkedBy ??= null;
    request.arrivalConfirmedAt ??= null;
  }
  return db;
}

function distanceMetres(latitudeA, longitudeA, latitudeB, longitudeB) {
  const radians = (value) => value * Math.PI / 180;
  const latitudeDelta = radians(latitudeB - latitudeA);
  const longitudeDelta = radians(longitudeB - longitudeA);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(latitudeA)) * Math.cos(radians(latitudeB))
    * Math.sin(longitudeDelta / 2) ** 2;
  return Math.round(6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, a))));
}

function applyMockRouteQuote(ride, quote) {
  if (!quote?.estimatedArrivalAt || !quote?.expiresAt || new Date(quote.expiresAt) <= new Date()) {
    throw new Error('Calculate a fresh route before publishing.');
  }
  ride.routeDistanceMeters = Number(quote.distanceMeters);
  ride.routeDurationSeconds = Number(quote.routeDurationSeconds);
  ride.routeStopoverSeconds = Number(quote.stopoverSeconds || 0);
  ride.estimatedArrivalAt = quote.estimatedArrivalAt;
  ride.scheduleBufferUntil = new Date(new Date(quote.estimatedArrivalAt).getTime() + 30 * 60 * 1000).toISOString();
  ride.pickupAnchor = quote.pickupAnchor || null;
  ride.destinationAnchor = quote.destinationAnchor || null;
}

function assertMockScheduleAvailable(db, hostId, candidate, excludeRideId = null) {
  if (Object.values(db.rides).some((ride) => ride.hostId === hostId && ride.id !== excludeRideId && ride.status === 'In Transit')) {
    throw new Error('Complete your current In Transit ride before publishing another ride.');
  }
  if (Object.values(db.rides).some((ride) => ride.hostId === hostId && ride.id !== excludeRideId
    && ['Published', 'Matched', 'In Transit'].includes(ride.status) && !ride.scheduleBufferUntil)) {
    throw new Error('Reconfirm the route for your existing active Ride before publishing another Ride.');
  }
  const start = new Date(candidate.departureAt).getTime();
  const end = new Date(candidate.scheduleBufferUntil).getTime();
  const conflict = Object.values(db.rides).some((ride) => {
    if (ride.hostId !== hostId || ride.id === excludeRideId || !['Published', 'Matched', 'In Transit'].includes(ride.status) || !ride.scheduleBufferUntil) return false;
    return rideIntervalsOverlap(start, end, ride.departureAt, ride.scheduleBufferUntil);
  });
  if (conflict) throw new Error('This ride overlaps another active ride, including its 30-minute arrival buffer.');
}

function processDueRides(db, now = new Date()) {
  const instant = now instanceof Date ? now : new Date(now);
  for (const ride of Object.values(db.rides || {})) {
    if (ride.status !== 'Published' || new Date(ride.departureAt) > instant) continue;
    const rideRequests = Object.values(db.rideRequests).filter((request) => request.rideId === ride.id);
    for (const request of rideRequests.filter((item) => item.status === 'Pending')) {
      request.status = 'Expired';
      request.decisionReason = 'Departure time reached';
      request.cancelledBy = 'System';
      request.processedAt = instant.toISOString();
      request.updatedAt = instant.toISOString();
    }
    const hasAccepted = rideRequests.some((request) => request.status === 'Accepted');
    ride.status = hasAccepted ? 'Matched' : 'Expired';
    ride.recruitmentClosedAt = hasAccepted ? (ride.recruitmentClosedAt || instant.toISOString()) : ride.recruitmentClosedAt;
    ride.expiredAt = hasAccepted ? null : instant.toISOString();
    ride.updatedAt = instant.toISOString();
  }
  for (const ride of Object.values(db.rides || {})) {
    if (ride.status === 'In Transit' && ride.passengerConfirmationDueAt && new Date(ride.passengerConfirmationDueAt) <= instant) {
      ride.status = 'Completed';
      ride.completedAt ||= instant.toISOString();
      ride.updatedAt = instant.toISOString();
    }
  }
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seedData));
      return normalizeModule2State(structuredClone(seedData));
    }
    return normalizeModule2State(JSON.parse(raw));
  } catch {
    return normalizeModule2State(structuredClone(seedData));
  }
}

function save(db) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

// Simulate network latency so loading states in the GUI layer are exercised honestly.
const delay = (ms = 250) => new Promise((res) => setTimeout(res, ms));

export const mockDb = {
  async getCurrentUser() {
    await delay();
    const db = load();
    return db.users[db.currentUserId] || null;
  },

  async signUp({ fullName, email, password }) {
    await delay();
    const db = load();
    const existing = Object.values(db.users).find((u) => u.email === email);
    if (existing) {
      const err = new Error('An account with this email already exists.');
      err.code = 'DUPLICATE_EMAIL';
      throw err;
    }
    const id = 'u_' + Date.now();
    db.users[id] = {
      id,
      fullName,
      email,
      phone: '',
      passwordHash: password ? 'hashed:' + password.length : '',
      emergencyContact: { name: '', phone: '', relationship: '' },
      spokenLanguages: [],
      profilePhotoUrl: null,
      status: 'active',
      createdAt: new Date().toISOString()
    };
    db.vehicles[id] = [];
    db.impact[id] = { completedTrips: 0, co2SavedKg: 0, reputationScore: 50 };
    db.currentUserId = id;
    save(db);
    return db.users[id];
  },

  async signIn({ email }) {
    await delay();
    const db = load();
    const user = Object.values(db.users).find((u) => u.email === email);
    if (!user) {
      const err = new Error('No account found for this email.');
      err.code = 'NOT_FOUND';
      throw err;
    }
    // Logging back in reactivates a deactivated account (FR-1.x Account Settings).
    if (user.status === 'deactivated') {
      user.status = 'active';
      db.users[user.id] = user;
    }
    db.currentUserId = user.id;
    save(db);
    return user;
  },

  async updateProfile(userId, patch) {
    await delay();
    const db = load();
    db.users[userId] = { ...db.users[userId], ...patch };
    save(db);
    return db.users[userId];
  },

  // Mirrors the fake-hash scheme signUp() already uses ('hashed:' + length) so
  // a real current-password check works for accounts created through this
  // offline demo's own Sign Up flow. The two hardcoded seed accounts carry a
  // fixed 'demo-hash' sentinel with no real password behind it (mock signIn
  // never checked one either), so any current password is accepted for them.
  async changePassword(userId, currentPassword, newPassword) {
    await delay();
    const db = load();
    const user = db.users[userId];
    if (!user) throw new Error('Account not found.');

    const isSeedAccount = user.passwordHash === 'demo-hash';
    const suppliedHash = 'hashed:' + (currentPassword || '').length;
    if (!isSeedAccount && user.passwordHash !== suppliedHash) {
      throw new Error('Current password is incorrect.');
    }

    db.users[userId] = { ...user, passwordHash: 'hashed:' + newPassword.length };
    save(db);
    return true;
  },

  // ---------- Account Settings (FR-1.x) ----------
  async setAccountStatus(userId, status) {
    await delay();
    const db = load();
    if (!db.users[userId]) throw new Error('Account not found.');
    db.users[userId] = { ...db.users[userId], status };
    save(db);
    return db.users[userId];
  },

  async deleteAccount(userId) {
    await delay();
    const db = load();
    delete db.users[userId];
    delete db.vehicles[userId];
    delete db.impact[userId];
    delete db.favourites[userId];
    if (db.currentUserId === userId) db.currentUserId = null;
    save(db);
    return true;
  },

  async listVehicles(userId) {
    await delay();
    const db = load();
    return db.vehicles[userId] || [];
  },

  async upsertVehicle(userId, vehicle) {
    await delay();
    const db = load();
    const list = db.vehicles[userId] || [];
    const idx = list.findIndex((v) => v.id === vehicle.id);
    if (idx >= 0) list[idx] = vehicle;
    else list.push({ ...vehicle, id: 'v_' + Date.now() });
    db.vehicles[userId] = list;
    save(db);
    return db.vehicles[userId];
  },

  async removeVehicle(userId, vehicleId) {
    await delay();
    const db = load();
    db.vehicles[userId] = (db.vehicles[userId] || []).filter((v) => v.id !== vehicleId);
    save(db);
    return db.vehicles[userId];
  },

  async setVehicleActive(userId, vehicleId, active) {
    await delay();
    const db = load();
    db.vehicles[userId] = (db.vehicles[userId] || []).map((v) =>
      v.id === vehicleId ? { ...v, active } : active ? { ...v, active: false } : v
    );
    // enforce: only one active vehicle at a time, matching the mockup's "1 active vehicle" banner
    if (active) {
      db.vehicles[userId] = db.vehicles[userId].map((v) => ({
        ...v,
        active: v.id === vehicleId
      }));
    }
    save(db);
    return db.vehicles[userId];
  },

  async getImpactStats(userId) {
    await delay();
    const db = load();
    return db.impact[userId] || { completedTrips: 0, co2SavedKg: 0, reputationScore: 0 };
  },

  async adjustImpactStats(userId, { trips = 0, reputation = 0 }) {
    await delay();
    const db = load();
    const current = db.impact[userId] || { completedTrips: 0, co2SavedKg: 0, reputationScore: 0 };
    db.impact[userId] = {
      ...current,
      completedTrips: Math.max(0, current.completedTrips + trips),
      reputationScore: Math.min(100, Math.max(0, current.reputationScore + reputation))
    };
    save(db);
    return db.impact[userId];
  },

  // ---------- Ride Sharing Management (Module 2, FR-2.x) ----------
  // Ride Management Component: create/read published rides. Enriches each ride
  // with a host snapshot (name, photo, reputation score, badge tier) here in the
  // Data Access Layer, the same way a real Supabase view/join would - so the
  // Business Logic and Presentation layers above never need a second round trip.
  async listRides({ from = '', to = '', date = '' } = {}) {
    await delay();
    const db = load();
    processDueRides(db);
    save(db);
    const f = from.trim().toLowerCase();
    const t = to.trim().toLowerCase();
    return Object.values(db.rides)
      .filter((r) => r.status === 'Published')
      .filter((r) => !f || r.pickup.toLowerCase().includes(f))
      .filter((r) => !t || r.destination.toLowerCase().includes(t))
      .filter((r) => !date || r.date === date)
      .map((r) => enrichRide(db, r))
      .sort((a, b) => new Date(a.departureAt) - new Date(b.departureAt));
  },

  async listFavouriteRides(userId) {
    await delay();
    const db = load();
    processDueRides(db);
    save(db);
    return (db.favourites[userId] || [])
      .map((entry) => db.rides[entry.rideId]
        ? { ...enrichRide(db, db.rides[entry.rideId]), favouritedAt: entry.createdAt }
        : null)
      .filter(Boolean)
      .map((ride) => ({
        ...ride,
        favouriteAvailable: ride.status === 'Published' && Number(ride.seatsAvailable) > 0
      }))
      .sort((left, right) => new Date(right.favouritedAt) - new Date(left.favouritedAt));
  },

  async addFavouriteRide(userId, rideId) {
    await delay();
    const db = load();
    processDueRides(db);
    const ride = db.rides[rideId];
    if (!ride || ride.status !== 'Published' || Number(ride.seatsAvailable) < 1) {
      throw new Error('Only an available published ride can be saved.');
    }
    db.favourites[userId] ||= [];
    if (!db.favourites[userId].some((entry) => entry.rideId === rideId)) {
      db.favourites[userId].unshift({ rideId, createdAt: new Date().toISOString() });
    }
    save(db);
    return true;
  },

  async removeFavouriteRide(userId, rideId) {
    await delay();
    const db = load();
    db.favourites[userId] = (db.favourites[userId] || []).filter((entry) => entry.rideId !== rideId);
    save(db);
    return true;
  },

  // Every ride regardless of lifecycle state, mirroring Supabase's
  // authenticated-read policy on `rides`. listRides() above is the public
  // marketplace and only returns Published, so Module 5's community
  // leaderboard (FR-5.10) needs this to see completed trips across all hosts.
  async listAllRides() {
    await delay();
    const db = load();
    processDueRides(db);
    save(db);
    return Object.values(db.rides)
      .map((r) => enrichRide(db, r))
      .sort((a, b) => new Date(b.departureAt) - new Date(a.departureAt));
  },

  async listMyRides(userId) {
    await delay();
    const db = load();
    processDueRides(db);
    save(db);
    const hosting = Object.values(db.rides)
      .filter((r) => r.hostId === userId)
      .map((r) => enrichRide(db, r))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const joining = Object.values(db.rideRequests)
      .filter((request) => request.requesterId === userId)
      .map((request) => enrichRequest(db, request))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return { hosting, joining };
  },

  async getRide(rideId) {
    await delay();
    const db = load();
    processDueRides(db);
    save(db);
    return db.rides[rideId] ? enrichRide(db, db.rides[rideId]) : null;
  },

  async updateRide(rideId, patch) {
    await delay();
    const db = load();
    processDueRides(db);
    const ride = db.rides[rideId];
    if (!ride) throw new Error('Ride not found.');
    if (ride.hostId !== db.currentUserId) throw new Error('Ride not found or permission denied.');
    if (!['Draft', 'Published'].includes(ride.status)) throw new Error('Only Draft or Published rides can be edited.');
    if (Object.values(db.rideRequests).some((request) => request.rideId === rideId && request.status === 'Accepted')) {
      throw new Error('A ride with accepted requests cannot be edited.');
    }
    const next = { ...ride, ...patch };
    const vehicle = (db.vehicles[ride.hostId] || []).find((item) => item.id === next.vehicleId);
    if (!vehicle) throw new Error('Select a vehicle you own.');
    if (Number(next.seatsTotal) > vehicle.seats) throw new Error('Available seats exceed vehicle capacity.');
    if (patch.date || patch.time) next.departureAt = toMockDepartureAt(next.date, next.time);
    if (ride.status === 'Published') {
      if (new Date(next.departureAt).getTime() - Date.now() < 60 * 60 * 1000) {
        throw new Error('Published rides must depart at least 1 hour from now.');
      }
      applyMockRouteQuote(next, patch.routeQuote);
      assertMockScheduleAvailable(db, ride.hostId, next, rideId);
    } else {
      next.estimatedArrivalAt = null;
      next.scheduleBufferUntil = null;
    }
    next.seatsAvailable = Number(next.seatsTotal);
    next.updatedAt = new Date().toISOString();
    db.rides[rideId] = next;
    save(db);
    return enrichRide(db, db.rides[rideId]);
  },

  async createRide(hostId, rideData, status) {
    await delay();
    const db = load();
    processDueRides(db);
    const vehicle = (db.vehicles[hostId] || []).find((item) => item.id === rideData.vehicleId);
    if (!vehicle) throw new Error('Select a vehicle you own.');
    const id = 'r_' + Date.now();
    const seats = Number(rideData.seatsTotal) || 1;
    if (seats > vehicle.seats) throw new Error('Available seats exceed vehicle capacity.');
    const departureAt = rideData.departureAt || toMockDepartureAt(rideData.date, rideData.time);
    if (status === 'Published' && new Date(departureAt).getTime() - Date.now() < 60 * 60 * 1000) {
      throw new Error('Published rides must depart at least 1 hour from now.');
    }
    const ride = {
      id,
      hostId,
      pickup: rideData.pickup,
      destination: rideData.destination,
      pickupLocation: rideData.pickupLocation || null,
      destinationLocation: rideData.destinationLocation || null,
      pickupInstructions: rideData.pickupInstructions || '',
      date: rideData.date,
      time: rideData.time,
      departureAt,
      journeyScale: rideData.journeyScale,
      vehicleId: rideData.vehicleId || null,
      seatsTotal: seats,
      seatsAvailable: seats,
      contribution: rideData.contribution || '',
      restrictionTags: rideData.restrictionTags || [],
      waypoints: rideData.waypoints || [],
      status,
      publishedAt: status === 'Published' ? new Date().toISOString() : null,
      recruitmentClosedAt: null,
      cancelReason: null,
      expiredAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    if (status === 'Published') {
      applyMockRouteQuote(ride, rideData.routeQuote);
      assertMockScheduleAvailable(db, hostId, ride);
    }
    db.rides[id] = ride;
    save(db);
    return enrichRide(db, db.rides[id]);
  },

  async quoteRide() {
    throw new Error('Live route calculation requires Supabase and Google Routes. Save as Draft while offline.');
  },

  async publishDraft(rideId, routeQuote) {
    await delay();
    const db = load();
    const ride = db.rides[rideId];
    if (!ride || ride.hostId !== db.currentUserId || ride.status !== 'Draft') throw new Error('Only your Draft rides can be published.');
    if (new Date(ride.departureAt).getTime() - Date.now() < 60 * 60 * 1000) throw new Error('Published rides must depart at least 1 hour from now.');
    applyMockRouteQuote(ride, routeQuote);
    assertMockScheduleAvailable(db, ride.hostId, ride, rideId);
    ride.status = 'Published';
    ride.publishedAt = new Date().toISOString();
    ride.updatedAt = ride.publishedAt;
    save(db);
    return enrichRide(db, ride);
  },

  async deleteDraft(rideId) {
    await delay();
    const db = load();
    const ride = db.rides[rideId];
    if (!ride || ride.hostId !== db.currentUserId || ride.status !== 'Draft') throw new Error('Only your Draft rides can be deleted.');
    delete db.rides[rideId];
    save(db);
    return true;
  },

  async cancelRide(rideId, reason) {
    await delay();
    const db = load();
    const ride = db.rides[rideId];
    if (!reason?.trim()) throw new Error('A cancellation reason is required.');
    if (!ride || ride.hostId !== db.currentUserId) throw new Error('Ride not found or permission denied.');
    if (!['Published', 'Matched'].includes(ride.status)) throw new Error('Only Published or Matched rides can be cancelled.');
    const now = new Date().toISOString();
    for (const request of Object.values(db.rideRequests).filter((item) => item.rideId === rideId && ['Pending', 'Accepted'].includes(item.status))) {
      request.status = 'Cancelled';
      request.decisionReason = reason.trim();
      request.cancelledBy = 'Host';
      request.cancelledAt = now;
      request.updatedAt = now;
    }
    ride.status = 'Cancelled';
    ride.cancelReason = reason.trim();
    ride.seatsAvailable = ride.seatsTotal;
    ride.recruitmentClosedAt ||= now;
    ride.updatedAt = now;
    save(db);
    return enrichRide(db, ride);
  },

  async closeRideRecruitment(rideId) {
    await delay();
    const db = load();
    const ride = db.rides[rideId];
    if (!ride || ride.hostId !== db.currentUserId || ride.status !== 'Published' || new Date(ride.departureAt) <= new Date()) {
      throw new Error('Only an upcoming Published ride can close recruitment.');
    }
    const now = new Date().toISOString();
    for (const request of Object.values(db.rideRequests).filter((item) => item.rideId === rideId && item.status === 'Pending')) {
      request.status = 'Expired';
      request.decisionReason = 'Recruitment closed';
      request.cancelledBy = 'System';
      request.processedAt = now;
      request.updatedAt = now;
    }
    ride.status = 'Matched';
    ride.recruitmentClosedAt = now;
    ride.updatedAt = now;
    save(db);
    return enrichRide(db, ride);
  },

  async reopenRideRecruitment(rideId) {
    await delay();
    const db = load();
    const ride = db.rides[rideId];
    if (!ride || ride.hostId !== db.currentUserId || ride.status !== 'Matched') throw new Error('Only Matched rides can reopen recruitment.');
    if (new Date(ride.departureAt).getTime() - Date.now() < 60 * 60 * 1000) throw new Error('Recruitment can no longer be reopened.');
    ride.status = 'Published';
    ride.recruitmentClosedAt = null;
    ride.updatedAt = new Date().toISOString();
    save(db);
    return enrichRide(db, ride);
  },

  async submitRideRequest(requesterId, { rideId, seatsRequested, companionNames }) {
    await delay();
    const db = load();
    processDueRides(db);
    const ride = db.rides[rideId];
    if (!ride) throw new Error('Ride not found.');
    if (ride.hostId === requesterId) throw new Error('Hosts cannot request their own ride.');
    if (ride.status !== 'Published') throw new Error('This ride is not accepting requests.');
    if (new Date(ride.departureAt).getTime() - Date.now() < 60 * 60 * 1000) throw new Error('The request deadline has passed.');
    if (seatsRequested > ride.seatsAvailable) throw new Error('Not enough seats are currently available.');
    const previous = Object.values(db.rideRequests).filter((item) => item.rideId === rideId && item.requesterId === requesterId);
    if (previous.some((item) => item.status === 'Rejected')) throw new Error('A rejected request cannot be submitted again.');
    if (previous.some((item) => ['Pending', 'Accepted'].includes(item.status))) throw new Error('You already have an active request for this ride.');
    const id = `rq_${Date.now()}`;
    const now = new Date().toISOString();
    db.rideRequests[id] = { id, rideId, requesterId, seatsRequested, companionNames, status: 'Pending', createdAt: now, updatedAt: now };
    save(db);
    return enrichRequest(db, db.rideRequests[id]);
  },

  async listMyRideRequests(requesterId) {
    await delay();
    const db = load();
    processDueRides(db);
    save(db);
    return Object.values(db.rideRequests).filter((item) => item.requesterId === requesterId).map((item) => enrichRequest(db, item)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async listRideRequests(rideId) {
    await delay();
    const db = load();
    processDueRides(db);
    save(db);
    const ride = db.rides[rideId];
    if (!ride || ride.hostId !== db.currentUserId) throw new Error('Only the ride Host can view these requests.');
    return Object.values(db.rideRequests).filter((item) => item.rideId === rideId).map((item) => enrichRequest(db, item));
  },

  async respondToRideRequest(requestId, decision, reason = null) {
    await delay();
    const db = load();
    processDueRides(db);
    const request = db.rideRequests[requestId];
    const ride = request && db.rides[request.rideId];
    if (!request || !ride || ride.hostId !== db.currentUserId) throw new Error('Only the ride Host can process requests.');
    if (ride.status !== 'Published' || new Date(ride.departureAt) <= new Date()) throw new Error('This ride can no longer process requests.');
    if (request.status !== 'Pending') throw new Error('This request has already been processed.');
    if (decision === 'Accepted') {
      if (request.seatsRequested > ride.seatsAvailable) throw new Error('Not enough seats remain for this request.');
      ride.seatsAvailable -= request.seatsRequested;
      ride.updatedAt = new Date().toISOString();
    } else if (decision !== 'Rejected') throw new Error('Unsupported request decision.');
    request.status = decision;
    request.decisionReason = reason;
    request.processedAt = new Date().toISOString();
    request.updatedAt = request.processedAt;
    save(db);
    return enrichRequest(db, request);
  },

  async cancelRideRequest(requestId, reason) {
    await delay();
    const db = load();
    processDueRides(db);
    const request = db.rideRequests[requestId];
    const ride = request && db.rides[request.rideId];
    if (!request || request.requesterId !== db.currentUserId) throw new Error('Only the requester can cancel this request.');
    if (!['Pending', 'Accepted'].includes(request.status)) throw new Error('Only an active request can be cancelled.');
    if (!ride || ['In Transit', 'Completed'].includes(ride.status) || new Date(ride.departureAt) <= new Date()) throw new Error('This request can no longer be cancelled.');
    if (request.status === 'Accepted') ride.seatsAvailable = Math.min(ride.seatsTotal, ride.seatsAvailable + request.seatsRequested);
    const now = new Date().toISOString();
    request.status = 'Cancelled';
    request.decisionReason = reason;
    request.cancelledBy = 'Requester';
    request.cancelledAt = now;
    request.updatedAt = now;
    ride.updatedAt = now;
    save(db);
    return enrichRequest(db, request);
  },

  async checkInRideRequest(requestId, position) {
    await delay();
    const db = load();
    const request = db.rideRequests[requestId];
    const ride = request && db.rides[request.rideId];
    if (!request || request.requesterId !== db.currentUserId) throw new Error('Ride request not found or permission denied.');
    if (!ride || request.status !== 'Accepted' || request.boardingStatus !== 'Pending') throw new Error('Only an unresolved accepted passenger can check in.');
    if (!['Published', 'Matched'].includes(ride.status)) throw new Error('This Ride is not accepting check-ins.');
    if (new Date(ride.departureAt).getTime() - Date.now() > 60 * 60 * 1000) throw new Error('Check-in opens 1 hour before departure.');
    if (position.accuracy > 100) throw new Error('GPS accuracy must be 100 metres or better.');
    if (!ride.pickupAnchor) throw new Error('This Ride needs a confirmed route before check-in.');
    const distance = distanceMetres(position.latitude, position.longitude, ride.pickupAnchor.latitude, ride.pickupAnchor.longitude);
    if (distance > 200) throw new Error('You must be within 200 metres of the pickup point.');
    request.boardingStatus = 'Checked In';
    request.checkedInAt = new Date().toISOString();
    request.checkInDistanceMeters = distance;
    save(db);
    return enrichRequest(db, request);
  },

  async markRideRequestNoShow(requestId) {
    await delay();
    const db = load();
    const request = db.rideRequests[requestId];
    const ride = request && db.rides[request.rideId];
    if (!ride || ride.hostId !== db.currentUserId) throw new Error('Only the Driver can mark a no-show.');
    if (request.status !== 'Accepted' || request.boardingStatus !== 'Pending') throw new Error('Only an unresolved accepted passenger can be marked No-show.');
    if (new Date(ride.departureAt) > new Date()) throw new Error('No-show can only be marked at or after departure.');
    request.boardingStatus = 'No-show';
    request.noShowAt = new Date().toISOString();
    request.noShowMarkedBy = db.currentUserId;
    save(db);
    return enrichRequest(db, request);
  },

  async startRide(rideId) {
    await delay();
    const db = load();
    const ride = db.rides[rideId];
    if (!ride || ride.hostId !== db.currentUserId) throw new Error('Ride not found or permission denied.');
    if (!['Published', 'Matched'].includes(ride.status) || new Date(ride.departureAt) > new Date()) throw new Error('Only a ready Ride can start at departure.');
    const accepted = Object.values(db.rideRequests).filter((request) => request.rideId === rideId && request.status === 'Accepted');
    if (!accepted.length) throw new Error('At least one accepted passenger is required before departure.');
    if (accepted.some((request) => request.boardingStatus === 'Pending')) throw new Error('Check in or mark No-show for every accepted passenger before starting.');
    ride.status = 'In Transit';
    ride.updatedAt = new Date().toISOString();
    save(db);
    return enrichRide(db, ride);
  },

  async confirmDriverArrival(rideId, position) {
    await delay();
    const db = load();
    const ride = db.rides[rideId];
    if (!ride || ride.hostId !== db.currentUserId || ride.status !== 'In Transit') throw new Error('Only the Driver of an In Transit Ride can confirm arrival.');
    if (position.accuracy > 100) throw new Error('GPS accuracy must be 100 metres or better.');
    if (!ride.destinationAnchor) throw new Error('This Ride has no verified destination.');
    const distance = distanceMetres(position.latitude, position.longitude, ride.destinationAnchor.latitude, ride.destinationAnchor.longitude);
    if (distance > 200) throw new Error('You must be within 200 metres of the destination.');
    ride.driverArrivedAt ||= new Date().toISOString();
    ride.passengerConfirmationDueAt ||= new Date(new Date(ride.driverArrivedAt).getTime() + 24 * 60 * 60 * 1000).toISOString();
    const checkedIn = Object.values(db.rideRequests).filter((request) => request.rideId === rideId && request.status === 'Accepted' && request.boardingStatus === 'Checked In');
    if (!checkedIn.length) {
      ride.status = 'Completed';
      ride.completedAt ||= new Date().toISOString();
    }
    ride.updatedAt = new Date().toISOString();
    save(db);
    return enrichRide(db, ride);
  },

  async confirmPassengerArrival(requestId) {
    await delay();
    const db = load();
    const request = db.rideRequests[requestId];
    const ride = request && db.rides[request.rideId];
    if (!request || request.requesterId !== db.currentUserId || request.status !== 'Accepted' || request.boardingStatus !== 'Checked In') throw new Error('Only a checked-in passenger can confirm arrival.');
    if (!ride || ride.status !== 'In Transit' || !ride.driverArrivedAt) throw new Error('The Driver has not confirmed destination arrival.');
    request.arrivalConfirmedAt ||= new Date().toISOString();
    const checkedIn = Object.values(db.rideRequests).filter((item) => item.rideId === ride.id && item.status === 'Accepted' && item.boardingStatus === 'Checked In');
    if (checkedIn.every((item) => item.arrivalConfirmedAt)) {
      ride.status = 'Completed';
      ride.completedAt = new Date().toISOString();
      ride.updatedAt = ride.completedAt;
    }
    save(db);
    return enrichRequest(db, request);
  },

  async getRideLifecycleContext(rideId) {
    await delay();
    const db = load();
    const ride = db.rides[rideId];
    if (!ride) return null;
    const participant = ride.hostId === db.currentUserId || Object.values(db.rideRequests).some((request) => request.rideId === rideId && request.requesterId === db.currentUserId && request.status === 'Accepted');
    if (!participant) throw new Error('Ride lifecycle details are private to participants.');
    return {
      driverArrivedAt: ride.driverArrivedAt,
      passengerConfirmationDueAt: ride.passengerConfirmationDueAt,
      completedAt: ride.completedAt
    };
  },

  async submitRideReview(reviewerId, { rideId, revieweeId, rating, comment }) {
    await delay();
    const db = load();
    const ride = db.rides[rideId];
    if (!ride || ride.status !== 'Completed') throw new Error('Only Completed rides can be reviewed.');
    const accepted = Object.values(db.rideRequests).filter((item) => item.rideId === rideId && item.status === 'Accepted');
    const valid = (reviewerId === ride.hostId && accepted.some((item) => item.requesterId === revieweeId)) || (revieweeId === ride.hostId && accepted.some((item) => item.requesterId === reviewerId));
    if (!valid) throw new Error('You are not eligible to review this person for this ride.');
    if (Object.values(db.rideReviews).some((item) => item.rideId === rideId && item.reviewerId === reviewerId && item.revieweeId === revieweeId)) throw new Error('You have already submitted this review.');
    const id = `rv_${Date.now()}`;
    db.rideReviews[id] = { id, rideId, reviewerId, revieweeId, rating, comment, createdAt: new Date().toISOString() };
    const ratings = Object.values(db.rideReviews).filter((item) => item.revieweeId === revieweeId).map((item) => item.rating);
    db.impact[revieweeId] ||= { completedTrips: 0, co2SavedKg: 0, reputationScore: 50 };
    db.impact[revieweeId].rating = ratings.reduce((sum, value) => sum + value, 0) / ratings.length;
    save(db);
    return enrichReview(db, db.rideReviews[id]);
  },

  async listProfileReviews(profileId) {
    await delay();
    const db = load();
    return Object.values(db.rideReviews).filter((item) => item.revieweeId === profileId).map((item) => enrichReview(db, item)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async getRideReviewEligibility(reviewerId, rideId) {
    await delay();
    const db = load();
    const ride = db.rides[rideId];
    if (!ride || ride.status !== 'Completed') return [];
    const accepted = Object.values(db.rideRequests).filter((item) => item.rideId === rideId && item.status === 'Accepted');
    const reviewees = reviewerId === ride.hostId ? accepted.map((item) => item.requesterId) : accepted.some((item) => item.requesterId === reviewerId) ? [ride.hostId] : [];
    return reviewees.map((revieweeId) => {
      const user = db.users[revieweeId];
      const existing = Object.values(db.rideReviews).find((item) => item.rideId === rideId && item.reviewerId === reviewerId && item.revieweeId === revieweeId);
      return { revieweeId, revieweeName: user?.fullName || 'Member', revieweeAvatarUrl: user?.profilePhotoUrl || null, reviewerRole: reviewerId === ride.hostId ? 'Host' : 'Passenger', existingRating: existing?.rating ?? null, existingComment: existing?.comment ?? null, reviewedAt: existing?.createdAt ?? null };
    });
  },

  async processRideLifecycle(now = new Date()) {
    const db = load();
    processDueRides(db, now);
    save(db);
    return true;
  }
};

function enrichRequest(db, request) {
  const requester = db.users[request.requesterId];
  const impact = db.impact[request.requesterId] || {};
  return {
    ...request,
    companionNames: request.companionNames || [],
    requester: requester ? {
      id: requester.id,
      fullName: requester.fullName,
      profilePhotoUrl: requester.profilePhotoUrl,
      completedTrips: impact.completedTrips || 0,
      reputationScore: impact.reputationScore || 0,
      rating: impact.rating ?? null
    } : null,
    ride: db.rides[request.rideId] ? enrichRide(db, db.rides[request.rideId]) : null
  };
}

function enrichReview(db, review) {
  const person = (id) => {
    const user = db.users[id];
    return user ? { id: user.id, fullName: user.fullName, profilePhotoUrl: user.profilePhotoUrl } : null;
  };
  const ride = db.rides[review.rideId];
  return {
    ...review,
    reviewer: person(review.reviewerId),
    reviewee: person(review.revieweeId),
    ride: ride ? { id: ride.id, pickup: ride.pickup, destination: ride.destination, departureAt: ride.departureAt } : null
  };
}

function enrichRide(db, ride) {
  const host = db.users[ride.hostId];
  const vehicle = (db.vehicles[ride.hostId] || []).find((item) => item.id === ride.vehicleId);
  const impact = db.impact[ride.hostId] || { completedTrips: 0, co2SavedKg: 0, reputationScore: 0, rating: null };
  const hasAcceptedRequests = Object.values(db.rideRequests)
    .some((request) => request.rideId === ride.id && request.status === 'Accepted');
  return {
    ...ride,
    vehicleType: vehicle?.vehicleType || '',
    hasAcceptedRequests,
    host: host
      ? {
          id: host.id,
          fullName: host.fullName,
          profilePhotoUrl: host.profilePhotoUrl,
          completedTrips: impact.completedTrips,
          co2SavedKg: impact.co2SavedKg,
          reputationScore: impact.reputationScore,
          rating: impact.rating,
          spokenLanguages: host.spokenLanguages || []
        }
      : null
  };
}
