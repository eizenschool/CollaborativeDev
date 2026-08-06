// ===== DATA ACCESS LAYER (Module 6 Store) =====
// --- DEV-ONLY FALLBACK STORE, OWNED BY MODULE 6 ---
//
// Deliberately a SEPARATE file and a SEPARATE localStorage key from mockDataStore.js.
// Module 6's records (trip verifications, dispute outcomes, outbound events) are its
// own entities, so writing them into Module 1/2's shared store would mean every
// Module 6 change touching a file four other people also edit. Keeping them apart
// means Module 6 owns its data end-to-end and merges cleanly.
//
// The relationship to Module 2's data is reference-only: a verification record points
// at a rideId, and never writes back to `rides`. Module 2 owns `rides.status`;
// `verificationStatus` below is Module 6's own shadow view of the same trip.
//
// Same conventions as mockDataStore.js on purpose (seed + load/save + simulated
// latency), so swapping this out for real Supabase calls later is like-for-like.

import {
  DISPUTE_STATUS,
  EXCHANGE_OUTCOME,
  GPS_RESULT,
  VERIFICATION_STATUS
} from '../business-logic/verification/constants.js';

const STORAGE_KEY = 'letstumpang_module6_v1';

// Seeded against ride ids that already exist in mockDataStore (r_1..r_4) so the
// verification screens have realistic trips to work on while Module 2's Matched /
// In Transit lifecycle states are still being built. Each seed is parked at a
// different stage so every branch of the flow is reachable in a demo.
const seedData = {
  clockOffsetMs: 0,

  verifications: {
    // Stage 1 - just Matched. PIN issued, nothing confirmed. Entry point for UC6.2.
    r_1: {
      rideId: 'r_1',
      hostId: 'u_host_ahmad',
      clientId: 'u_demo_1',
      pin: '4821',
      pinGeneratedAt: '2026-08-15T06:30:00.000Z',
      pickup: { confirmedAt: null, gpsCheck: null, gpsDistanceM: null },
      noShow: null,
      startConfirm: { host: null, client: null },
      completeConfirm: { host: null, client: null },
      exchange: {
        host: null, hostAt: null, hostDefaulted: false,
        client: null, clientAt: null, clientDefaulted: false
      },
      dispute: {
        status: DISPUTE_STATUS.NONE,
        confidenceScore: null,
        signals: null,
        outcome: null,
        resolvedBy: null,
        resolvedAt: null
      },
      verificationStatus: VERIFICATION_STATUS.MATCHED
    },

    // Stage 2 - pickup verified with a clean GPS cross-check, trip under way.
    // Both parties still have to confirm completion (UC6.4).
    r_2: {
      rideId: 'r_2',
      hostId: 'u_host_sarah',
      clientId: 'u_demo_1',
      pin: '7364',
      pinGeneratedAt: '2026-08-17T07:00:00.000Z',
      pickup: {
        confirmedAt: '2026-08-17T07:32:00.000Z',
        gpsCheck: GPS_RESULT.PASS,
        gpsDistanceM: 24
      },
      noShow: null,
      startConfirm: { host: '2026-08-17T07:33:00.000Z', client: '2026-08-17T07:33:40.000Z' },
      completeConfirm: { host: null, client: null },
      exchange: {
        host: null, hostAt: null, hostDefaulted: false,
        client: null, clientAt: null, clientDefaulted: false
      },
      dispute: {
        status: DISPUTE_STATUS.NONE,
        confidenceScore: null,
        signals: null,
        outcome: null,
        resolvedBy: null,
        resolvedAt: null
      },
      verificationStatus: VERIFICATION_STATUS.IN_TRANSIT
    },

    // Stage 3 - completed, but the two parties disagree about the exchange AND the
    // pickup GPS never matched. Low confidence on purpose: this is the trip that
    // has to land in the admin queue (UC6.9 A1 -> UC6.10).
    r_3: {
      rideId: 'r_3',
      hostId: 'u_host_raj',
      clientId: 'u_demo_1',
      pin: '1195',
      pinGeneratedAt: '2026-08-18T07:45:00.000Z',
      pickup: {
        confirmedAt: '2026-08-18T08:20:00.000Z',
        gpsCheck: GPS_RESULT.MISMATCH,
        gpsDistanceM: 1830
      },
      noShow: null,
      startConfirm: { host: '2026-08-18T08:21:00.000Z', client: '2026-08-18T08:26:00.000Z' },
      completeConfirm: { host: '2026-08-18T09:05:00.000Z', client: '2026-08-18T09:11:00.000Z' },
      exchange: {
        host: EXCHANGE_OUTCOME.FULFILLED,
        hostAt: '2026-08-18T09:15:00.000Z',
        hostDefaulted: false,
        client: EXCHANGE_OUTCOME.NOT_FULFILLED,
        clientAt: '2026-08-19T05:20:00.000Z',
        clientDefaulted: false
      },
      dispute: {
        status: DISPUTE_STATUS.NONE,
        confidenceScore: null,
        signals: null,
        outcome: null,
        resolvedBy: null,
        resolvedAt: null
      },
      verificationStatus: VERIFICATION_STATUS.COMPLETED
    },

    // Stage 4 - same disagreement, but clean GPS, prompt confirmations and two
    // high-reputation parties with no dispute history. High confidence: this one
    // should auto-resolve without ever reaching an admin (UC6.9 basic flow).
    r_4: {
      rideId: 'r_4',
      hostId: 'u_host_nurul',
      clientId: 'u_demo_1',
      pin: '5027',
      pinGeneratedAt: '2026-08-19T08:00:00.000Z',
      pickup: {
        confirmedAt: '2026-08-19T08:31:00.000Z',
        gpsCheck: GPS_RESULT.PASS,
        gpsDistanceM: 41
      },
      noShow: null,
      startConfirm: { host: '2026-08-19T08:32:00.000Z', client: '2026-08-19T08:32:20.000Z' },
      completeConfirm: { host: '2026-08-19T09:40:00.000Z', client: '2026-08-19T09:41:00.000Z' },
      exchange: {
        host: EXCHANGE_OUTCOME.FULFILLED,
        hostAt: '2026-08-19T09:45:00.000Z',
        hostDefaulted: false,
        client: EXCHANGE_OUTCOME.NOT_FULFILLED,
        clientAt: '2026-08-19T10:15:00.000Z',
        clientDefaulted: false
      },
      dispute: {
        status: DISPUTE_STATUS.NONE,
        confidenceScore: null,
        signals: null,
        outcome: null,
        resolvedBy: null,
        resolvedAt: null
      },
      verificationStatus: VERIFICATION_STATUS.COMPLETED
    }
  },

  // Dispute history is Module 6's own domain (Module 1 owns the reputation score,
  // Module 6 owns the record of who has been in how many disputes). Feeds the
  // history signal of the confidence score in UC6.8.
  disputeHistory: {
    u_demo_1: { priorDisputes: 0 },
    u_host_ahmad: { priorDisputes: 0 },
    u_host_sarah: { priorDisputes: 1 },
    u_host_raj: { priorDisputes: 3 },
    u_host_nurul: { priorDisputes: 0 }
  },

  // Outbound event log. Module 6 appends here; Module 1 reads from here when its
  // FR-1.5 reputation recalculation is built. Module 6 never calls Module 1.
  events: []
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

export const module6Db = {
  // ---------- Demo clock (UC6.5 / UC6.22 are time-driven) ----------
  // The no-show window and the 48-hour default confirmation can't be demonstrated
  // by waiting, so Module 6 reads "now" through this offset instead of Date.now().
  // Business-logic functions still take `now` as an explicit argument - the offset
  // only decides what gets passed in, which keeps every rule unit-testable.
  now() {
    const db = load();
    return new Date(Date.now() + (db.clockOffsetMs || 0)).toISOString();
  },

  async advanceClock(ms) {
    const db = load();
    db.clockOffsetMs = (db.clockOffsetMs || 0) + ms;
    save(db);
    return db.clockOffsetMs;
  },

  async resetClock() {
    const db = load();
    db.clockOffsetMs = 0;
    save(db);
    return 0;
  },

  async getClockOffset() {
    return load().clockOffsetMs || 0;
  },

  // ---------- Trip verifications ----------
  async listVerifications() {
    await delay();
    return Object.values(load().verifications);
  },

  async getVerification(rideId) {
    await delay();
    return load().verifications[rideId] || null;
  },

  async saveVerification(rideId, patch) {
    await delay();
    const db = load();
    const existing = db.verifications[rideId];
    if (!existing) throw new Error('No verification record for this trip.');
    db.verifications[rideId] = { ...existing, ...patch };
    save(db);
    return db.verifications[rideId];
  },

  // PIN uniqueness is checked across live verifications so UC6.1's collision-retry
  // branch has something real to collide with.
  async listActivePins() {
    const db = load();
    return Object.values(db.verifications)
      .filter((v) => v.verificationStatus !== VERIFICATION_STATUS.COMPLETED)
      .map((v) => v.pin)
      .filter(Boolean);
  },

  // ---------- Dispute history (UC6.8 history signal) ----------
  async getDisputeHistory(userId) {
    return load().disputeHistory[userId] || { priorDisputes: 0 };
  },

  async incrementDisputeHistory(userId) {
    const db = load();
    const current = db.disputeHistory[userId] || { priorDisputes: 0 };
    db.disputeHistory[userId] = { priorDisputes: current.priorDisputes + 1 };
    save(db);
    return db.disputeHistory[userId];
  },

  // ---------- Outbound event log (consumed by Module 1, FR-1.5) ----------
  async appendEvent(event) {
    const db = load();
    db.events.push({
      id: 'ev_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      consumed: false,
      ...event
    });
    save(db);
    return db.events[db.events.length - 1];
  },

  async listEvents({ unconsumedOnly = false } = {}) {
    const events = load().events;
    return unconsumedOnly ? events.filter((e) => !e.consumed) : events;
  },

  async markEventConsumed(eventId) {
    const db = load();
    const event = db.events.find((e) => e.id === eventId);
    if (event) {
      event.consumed = true;
      save(db);
    }
    return event || null;
  },

  // Demo affordance - lets a reviewer replay the whole flow from a clean slate
  // without clearing Module 1/2's store alongside it.
  async resetModule6() {
    localStorage.removeItem(STORAGE_KEY);
    return load();
  }
};
