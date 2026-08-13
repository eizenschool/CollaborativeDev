// ===== DATA ACCESS LAYER (discoveryStore) =====
// Module 6 Destination Discovery's own store, on its own localStorage key so it
// never collides with mockDataStore or module6Store.
//
// Two jobs:
//   1. Hold the fixture catalogue that lets /discover run with no Google Places
//      key and no deployed `places` table - the same "clickable out of the box"
//      standard mockDataStore sets for Module 1.
//   2. Mirror the shape of the real Supabase calls, so when
//      `021_m6_destination_discovery.sql` is deployed the service layer swaps
//      source without a rewrite.
//
// The fixture is deliberately constructed so every scoring and lifecycle rule
// actually fires in a demo rather than being taken on trust:
//   - three same-named outlets in one state  -> chain detection (FR-6.26)
//   - a place with two reviews               -> Provisional + low-confidence
//                                               rating suppression (FR-6.16)
//   - a Stale place                          -> still recommended, ranked down
//   - a Retired place                        -> must never appear anywhere
//   - one category with no ride serving it   -> the unserved section

import { CATEGORY, PLACE_STATE } from '../business-logic/discovery/constants.js';

const STORAGE_KEY = 'letstumpang_discovery_v1';
const LATENCY_MS = 200;

// Photo references are stored, never image bytes - see the compliance note in
// `database/sql/021_m6_destination_discovery.sql`. In the fixture these are
// descriptive placeholders; the real ones come from Place Details.
const photo = (label, author) => ({ reference: `fixture:${label}`, attribution: author });

const seedPlaces = [
  {
    id: 'p_georgetown',
    sourcePlaceId: 'fixture_georgetown',
    name: 'George Town Heritage Core',
    category: CATEGORY.HERITAGE,
    description: 'A UNESCO-listed street grid of shophouses, clan jetties and colonial facades.',
    descriptionIsTemplate: false,
    rating: 4.6,
    reviewCount: 18420,
    lat: 5.4141, lng: 100.3288,
    state: 'Penang',
    photoReferences: [photo('georgetown-1', 'Lim Wei Sheng'), photo('georgetown-2', 'Aisyah Roslan')],
    lifecycleState: PLACE_STATE.ACTIVE,
    // Hosts type a destination freehand, so the catalogue name and the ride text
    // rarely match exactly. Aliases bridge that until ingestion gives both sides
    // a shared Place ID - see DiscoveryContractAdapter.referencesPlace().
    rideDestinationAliases: ['Georgetown', 'Georgetown, Penang']
  },
  {
    id: 'p_jonker',
    sourcePlaceId: 'fixture_jonker',
    name: 'Jonker Street',
    category: CATEGORY.CULINARY,
    description: 'A night market strip known for Peranakan kitchens and chicken rice balls.',
    descriptionIsTemplate: false,
    rating: 4.3,
    reviewCount: 9260,
    lat: 2.1958, lng: 102.2486,
    state: 'Melaka',
    photoReferences: [photo('jonker-1', 'Tan Boon Hock')],
    lifecycleState: PLACE_STATE.ACTIVE,
    rideDestinationAliases: ['Melaka Sentral', 'Melaka']
  },
  {
    id: 'p_cameron',
    sourcePlaceId: 'fixture_cameron',
    name: 'Cameron Highlands Tea Terraces',
    category: CATEGORY.NATURE,
    description: 'Terraced tea slopes and mossy forest trails at around 1,500 metres.',
    descriptionIsTemplate: false,
    rating: 4.5,
    reviewCount: 12100,
    lat: 4.4710, lng: 101.3776,
    state: 'Pahang',
    photoReferences: [photo('cameron-1', 'Nurul Huda')],
    lifecycleState: PLACE_STATE.ACTIVE
  },
  {
    id: 'p_gurney',
    sourcePlaceId: 'fixture_gurney',
    name: 'Gurney Drive Hawker Centre',
    category: CATEGORY.CULINARY,
    description: 'A seafront hawker row where char kway teow and rojak stalls trade side by side.',
    descriptionIsTemplate: false,
    rating: 4.1,
    reviewCount: 7340,
    lat: 5.4380, lng: 100.3090,
    state: 'Penang',
    photoReferences: [photo('gurney-1', 'Kavitha Menon')],
    lifecycleState: PLACE_STATE.ACTIVE
  },
  {
    id: 'p_kellie',
    sourcePlaceId: 'fixture_kellie',
    name: "Kellie's Castle",
    category: CATEGORY.HERITAGE,
    description: 'An unfinished Scottish-Moorish mansion left half-built when its owner died in 1926.',
    descriptionIsTemplate: false,
    rating: 4.2,
    reviewCount: 3180,
    lat: 4.4690, lng: 101.0630,
    state: 'Perak',
    photoReferences: [photo('kellie-1', 'Daniel Wong')],
    lifecycleState: PLACE_STATE.ACTIVE
  },
  {
    id: 'p_sekinchan',
    sourcePlaceId: 'fixture_sekinchan',
    name: 'Sekinchan Paddy Fields',
    category: CATEGORY.NATURE,
    description: 'Flat rice terraces that turn from green to gold across the harvest cycle.',
    descriptionIsTemplate: false,
    rating: 4.4,
    reviewCount: 5210,
    lat: 3.5052, lng: 101.1015,
    state: 'Selangor',
    photoReferences: [photo('sekinchan-1', 'Farid Hakim')],
    lifecycleState: PLACE_STATE.ACTIVE,
    rideDestinationAliases: ['Cyberjaya', 'Cyberjaya, Selangor']
  },

  // --- Provisional tier: two reviews. Rating must be suppressed in favour of a
  // low-confidence indicator (FR-6.16), and quality scores 1.0 x 0.2 = 0.20 even
  // though the raw rating is a perfect 5.0.
  {
    id: 'p_warung_mak_cik',
    sourcePlaceId: 'fixture_warung',
    name: 'Warung Mak Cik Zainab',
    category: CATEGORY.CULINARY,
    description: 'A roadside stall serving nasi lemak.',
    descriptionIsTemplate: true,
    rating: 5.0,
    reviewCount: 2,
    lat: 3.4900, lng: 101.1200,
    state: 'Selangor',
    photoReferences: [],
    lifecycleState: PLACE_STATE.PROVISIONAL
  },

  // --- Chain detection: three outlets, same name, same state (FR-6.26). Their
  // local-economy signal must come out 0.0 while every independent place gets 1.0.
  {
    id: 'p_chain_a',
    sourcePlaceId: 'fixture_chain_a',
    name: 'Restoran Sri Nirwana',
    category: CATEGORY.CULINARY,
    description: 'A banana leaf rice outlet.',
    descriptionIsTemplate: true,
    rating: 4.0, reviewCount: 1450,
    lat: 3.1390, lng: 101.6869,
    state: 'Selangor',
    photoReferences: [photo('chain-a', 'Suresh Pillai')],
    lifecycleState: PLACE_STATE.ACTIVE,
    rideDestinationAliases: ['KLCC', 'Kuala Lumpur']
  },
  {
    id: 'p_chain_b',
    sourcePlaceId: 'fixture_chain_b',
    name: 'Restoran Sri Nirwana',
    category: CATEGORY.CULINARY,
    description: 'A banana leaf rice outlet.',
    descriptionIsTemplate: true,
    rating: 3.9, reviewCount: 980,
    lat: 3.0730, lng: 101.5180,
    state: 'Selangor',
    photoReferences: [],
    lifecycleState: PLACE_STATE.ACTIVE
  },
  {
    id: 'p_chain_c',
    sourcePlaceId: 'fixture_chain_c',
    name: 'Restoran Sri Nirwana',
    category: CATEGORY.CULINARY,
    description: 'A banana leaf rice outlet.',
    descriptionIsTemplate: true,
    rating: 4.1, reviewCount: 1120,
    lat: 3.2100, lng: 101.7400,
    state: 'Selangor',
    photoReferences: [],
    lifecycleState: PLACE_STATE.ACTIVE
  },

  // --- Stale: absent from three ingestion cycles. Still recommendable, ranked
  // down; restoring it must return it to Active, not to a default.
  {
    id: 'p_stale_gallery',
    sourcePlaceId: 'fixture_stale',
    name: 'Kuala Selangor Firefly Gallery',
    category: CATEGORY.NATURE,
    description: 'A riverside boardwalk for evening firefly viewing.',
    descriptionIsTemplate: false,
    rating: 4.0, reviewCount: 620,
    lat: 3.3400, lng: 101.2500,
    state: 'Selangor',
    photoReferences: [],
    lifecycleState: PLACE_STATE.STALE,
    stateBeforeDemotion: PLACE_STATE.ACTIVE,
    absenceCounter: 4
  },

  // --- Retired: absent from ten cycles. Withheld from every list, but the row
  // and its recorded interest are preserved so a return restores both.
  {
    id: 'p_retired_museum',
    sourcePlaceId: 'fixture_retired',
    name: 'Closed Tin Mining Museum',
    category: CATEGORY.HERITAGE,
    description: 'A former tin dredge exhibit.',
    descriptionIsTemplate: true,
    rating: 3.5, reviewCount: 210,
    lat: 4.5900, lng: 101.0900,
    state: 'Perak',
    photoReferences: [],
    lifecycleState: PLACE_STATE.RETIRED,
    stateBeforeDemotion: PLACE_STATE.ACTIVE,
    absenceCounter: 11
  },

  // --- VM2026 event: seasonal alignment scores 1.0 while its window is open.
  {
    id: 'p_vm2026_rainforest',
    sourcePlaceId: 'fixture_vm2026_rainforest',
    name: 'Rainforest World Music Festival',
    category: CATEGORY.EVENT,
    description: 'A three-day festival staged in the grounds of the Sarawak Cultural Village.',
    descriptionIsTemplate: false,
    rating: 4.7, reviewCount: 2890,
    lat: 1.7500, lng: 110.3200,
    state: 'Sarawak',
    photoReferences: [photo('rwmf-1', 'Melissa Anak Jipin')],
    lifecycleState: PLACE_STATE.ACTIVE,
    isVm2026Event: true
  }
];

const defaults = {
  absenceCounter: 0,
  stateBeforeDemotion: null,
  isVm2026Event: false,
  photoReferences: [],
  rideDestinationAliases: []
};

function freshState() {
  return {
    places: seedPlaces.map((p) => ({ ...defaults, ...p })),
    interest: [],        // { userId, placeId, travelDate, createdAt }
    registrations: [],   // { id, userId, placeId, travelDate, status, createdAt }
    preferences: {}      // userId -> { preferredCategories, promptDismissed }
  };
}

function load() {
  if (typeof localStorage === 'undefined') return freshState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshState();
    const parsed = JSON.parse(raw);
    // The catalogue itself is always re-seeded: it is source-derived data, not
    // user data, so a stale copy in a browser must not shadow a newer fixture.
    return { ...parsed, places: freshState().places };
  } catch {
    return freshState();
  }
}

function save(state) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      interest: state.interest,
      registrations: state.registrations,
      preferences: state.preferences
    }));
  } catch {
    // A full or unavailable localStorage must not break browsing.
  }
}

let state = load();
const delay = () => new Promise((resolve) => setTimeout(resolve, LATENCY_MS));

export const discoveryDb = {
  async listPlaces() {
    await delay();
    return state.places.map((p) => ({ ...p }));
  },

  async getPlace(placeId) {
    await delay();
    const found = state.places.find((p) => p.id === placeId);
    return found ? { ...found } : null;
  },

  /**
   * FR-6.30. Unique per (user, place, travel date) - opening the same destination
   * five times is one interested user, not five, which is what makes the demand
   * count meaningful.
   */
  async recordInterest(userId, placeId, travelDate) {
    await delay();
    const exists = state.interest.some(
      (i) => i.userId === userId && i.placeId === placeId && i.travelDate === travelDate
    );
    if (!exists) {
      state.interest.push({ userId, placeId, travelDate, createdAt: new Date().toISOString() });
      save(state);
    }
    return { recorded: !exists };
  },

  /**
   * FR-6.31. Returns counts only, never who - the same privacy boundary the
   * `place_latent_demand()` security definer function enforces in Postgres.
   */
  async latentDemand(travelDate) {
    await delay();
    const counts = new Map();
    for (const row of state.interest) {
      if (row.travelDate !== travelDate) continue;
      const seen = counts.get(row.placeId) || new Set();
      seen.add(row.userId);
      counts.set(row.placeId, seen);
    }
    return new Map([...counts].map(([placeId, users]) => [placeId, users.size]));
  },

  async getPreferences(userId) {
    await delay();
    return state.preferences[userId] || null;
  },

  async savePreferences(userId, { preferredCategories = [], promptDismissed = false } = {}) {
    await delay();
    state.preferences[userId] = { preferredCategories, promptDismissed };
    save(state);
    return { ...state.preferences[userId] };
  },

  /** FR-6.33 / UC6.6 A1: a repeat request returns the existing registration. */
  async registerForNotification(userId, placeId, travelDate) {
    await delay();
    const existing = state.registrations.find(
      (r) => r.userId === userId && r.placeId === placeId
        && r.travelDate === travelDate && r.status === 'active'
    );
    if (existing) return { registration: { ...existing }, alreadyExisted: true };

    const registration = {
      id: `reg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      userId, placeId, travelDate,
      status: 'active',
      createdAt: new Date().toISOString()
    };
    state.registrations.push(registration);
    save(state);
    return { registration: { ...registration }, alreadyExisted: false };
  },

  async listRegistrations(userId) {
    await delay();
    return state.registrations.filter((r) => r.userId === userId).map((r) => ({ ...r }));
  },

  async cancelRegistration(userId, registrationId) {
    await delay();
    const found = state.registrations.find((r) => r.id === registrationId && r.userId === userId);
    if (found) {
      found.status = 'cancelled';
      found.closedAt = new Date().toISOString();
      save(state);
    }
    return found ? { ...found } : null;
  },

  // Test hook: restores the seed so one test's writes cannot leak into another.
  __reset() {
    state = freshState();
    save(state);
  }
};
