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

const STORAGE_KEY = 'letstumpang_mock_db_v1';

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
      profilePhotoUrl: null,
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
      profilePhotoUrl: null,
      createdAt: '2026-01-01T00:00:00.000Z'
    }
  },
  vehicles: {
    u_demo_1: [
      {
        id: 'v_1',
        make: 'Toyota',
        model: 'Camry',
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
        plate: 'VIC 8BM 774',
        colour: 'Midnight Blue',
        seats: 3,
        year: 2019,
        active: false
      }
    ]
  },
  // Reputation Score Engine inputs (3.1.2.a) - completed trips, CO2 saved, and
  // reputation score feed the weighted Composite Impact Score on the Host Dashboard.
  impact: {
    u_demo_1: { completedTrips: 34, co2SavedKg: 287, reputationScore: 78 }
  }
};

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seedData));
      return structuredClone(seedData);
    }
    return JSON.parse(raw);
  } catch {
    return structuredClone(seedData);
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
      profilePhotoUrl: null,
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
  }
};
