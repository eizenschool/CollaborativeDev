// ===== BUSINESS LOGIC LAYER (TripHistoryEngine) =====
// Module 5 - Trip Management & Eco Impact (FR-5.1 - FR-5.11)
//
// Everything in this module is READ-ONLY for the user - no create/edit/delete
// of rides happens here (that's Module 2's RideService). It reuses:
//   - mockDb.listMyRides() / listRides() / getRide()  -> Module 2's ride data
//   - HostImpactEngine                                 -> the SAME Composite
//     Host Impact Score formula already used on the Profile/Reputation
//     screen, so the Leaderboard here always matches a host's own profile.
//
// mockDataStore.js currently only seeds rides with status 'Published' and
// doesn't yet track "joined" rides (Module 2's request/join flow isn't wired
// up to listMyRides() yet - it returns joining: [] on purpose) or per-trip
// distance/participants. Rather than editing mockDataStore.js (a shared file
// several teammates are already working in), this file derives everything
// it needs on top of it and keeps its own small, isolated localStorage key
// for the one bit of extra demo data Module 5 needs. Swap the two functions
// marked "DERIVED / DEMO ONLY" for real data as soon as it exists - nothing
// in src/presentation/components/trip/ talks to mockDb or localStorage
// directly, so those screens don't need to change.

import { mockDb } from '../data-access/mockDataStore.js';
import { HostImpactEngine } from './HostImpactEngine.js';

const JOINED_TRIPS_KEY = 'letstumpang_module5_joined_trips_v1';

// ---------- DERIVED / DEMO ONLY: synthetic "joined" trips ----------
// Seeds a couple of the public marketplace rides as if this user had already
// been accepted onto them, the first time this module runs, so "Joined"
// filters/screens have something real to show. Remembered in its own
// localStorage key so it's stable across reloads without touching
// mockDataStore.js's shared store.
async function getOrSeedJoinedRideIds() {
  try {
    const raw = localStorage.getItem(JOINED_TRIPS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // fall through and reseed
  }
  const publicRides = await mockDb.listRides();
  const user = await mockDb.getCurrentUser();
  const ids = publicRides
    .filter((r) => r.hostId !== user?.id)
    .slice(0, 2)
    .map((r) => r.id);
  localStorage.setItem(JOINED_TRIPS_KEY, JSON.stringify(ids));
  return ids;
}

// ---------- DERIVED / DEMO ONLY: lifecycle status ----------
// mockDataStore.js seeds every ride as 'Published' with no lifecycle
// history. So Ride History can demonstrate every status in FR-5.2's filter
// row, this derives a display status from how the ride's date/time compares
// to now, without mutating the underlying ride record. Once Module 2 tracks
// real lifecycle transitions, drop this and use ride.status as-is.
function deriveDisplayStatus(ride) {
  if (ride.status === 'Cancelled' || ride.status === 'Draft') return ride.status;
  const rideDateTime = new Date(`${ride.date}T${ride.time || '00:00'}`);
  const hoursDiff = (rideDateTime - new Date()) / (1000 * 60 * 60);
  if (hoursDiff > 2) return 'Published';
  if (hoursDiff > -3) return 'In Transit';
  return 'Completed';
}

// ---------- DERIVED / DEMO ONLY: estimated carbon savings ----------
// FR-5.4: "estimated based on distance and passengers carried." Ride records
// don't store a distance, so this uses a simple, clearly-labelled estimate:
// an average trip distance per journey scale, times the number of seats
// actually filled, times a standard avoided-emissions factor (kg CO2 per
// passenger-km, based on displacing an equivalent solo car trip).
const AVG_DISTANCE_KM = { Urban: 18, Intercity: 340 };
const EMISSION_FACTOR_KG_PER_PASSENGER_KM = 0.12;

function estimateCarbonSavedKg(ride) {
  const distance = AVG_DISTANCE_KM[ride.journeyScale] ?? AVG_DISTANCE_KM.Urban;
  const passengers = Math.max(0, (ride.seatsTotal || 1) - (ride.seatsAvailable ?? 0));
  return Math.round(distance * Math.max(passengers, 1) * EMISSION_FACTOR_KG_PER_PASSENGER_KM * 10) / 10;
}

function toHistoryCard(ride, role) {
  const status = deriveDisplayStatus(ride);
  return {
    id: ride.id,
    role, // 'Host' | 'Passenger'
    pickup: ride.pickup,
    destination: ride.destination,
    date: ride.date,
    time: ride.time,
    status,
    journeyScale: ride.journeyScale,
    carbonSavedKg: status === 'Completed' ? estimateCarbonSavedKg(ride) : null,
    host: ride.host || null,
    contribution: ride.contribution,
    restrictionTags: ride.restrictionTags || [],
    seatsTotal: ride.seatsTotal,
    seatsAvailable: ride.seatsAvailable
  };
}

export const TripHistoryEngine = {
  // ---------- FR-5.1 / FR-5.2 - Ride History, lifecycle filtering ----------
  async listHistory(userId) {
    const [{ hosting }, joinedIds] = await Promise.all([
      mockDb.listMyRides(userId),
      getOrSeedJoinedRideIds()
    ]);
    const joinedRides = await Promise.all(joinedIds.map((id) => mockDb.getRide(id)));

    const hostedCards = hosting.map((r) => toHistoryCard(r, 'Host'));
    const joinedCards = joinedRides.filter(Boolean).map((r) => toHistoryCard(r, 'Passenger'));

    return [...hostedCards, ...joinedCards].sort(
      (a, b) => new Date(`${b.date}T${b.time || '00:00'}`) - new Date(`${a.date}T${a.time || '00:00'}`)
    );
  },

  // ---------- FR-5.3 / FR-5.4 / FR-5.5 - Trip Detail (read-only) ----------
  async getTripDetail(tripId, userId) {
    const ride = await mockDb.getRide(tripId);
    if (!ride) return null;
    const user = await mockDb.getCurrentUser();
    const role = ride.hostId === userId ? 'Host' : 'Passenger';
    const card = toHistoryCard(ride, role);

    const participants = [
      ride.host
        ? { id: ride.host.id, name: ride.host.fullName, role: 'Host' }
        : { id: ride.hostId, name: 'Host', role: 'Host' },
      role === 'Passenger' ? { id: user?.id, name: user?.fullName || 'You', role: 'Passenger' } : null
    ].filter(Boolean);

    return { ...card, participants };
  },

  // ---------- FR-5.6 / FR-5.7 - Environmental Impact Dashboard ----------
  async getImpactSummary(userId) {
    const history = await TripHistoryEngine.listHistory(userId);
    const completed = history.filter((t) => t.status === 'Completed');
    const totalCarbonSavedKg = completed.reduce((sum, t) => sum + (t.carbonSavedKg || 0), 0);
    const totalDistanceKm = completed.reduce(
      (sum, t) => sum + (AVG_DISTANCE_KM[t.journeyScale] ?? AVG_DISTANCE_KM.Urban),
      0
    );
    const passengersCarried = completed
      .filter((t) => t.role === 'Host')
      .reduce((sum, t) => sum + Math.max(0, (t.seatsTotal || 0) - (t.seatsAvailable ?? 0)), 0);

    return {
      hasData: completed.length > 0,
      totalCarbonSavedKg: Math.round(totalCarbonSavedKg * 10) / 10,
      totalDistanceKm: Math.round(totalDistanceKm),
      passengersCarried,
      treesEquivalent: Math.round(totalCarbonSavedKg / 21) // ~21kg CO2/year per tree, illustrative
    };
  },

  // ---------- FR-5.8 / FR-5.9 - Monthly Impact Report ----------
  async getMonthlyReport(userId, year, month) {
    const history = await TripHistoryEngine.listHistory(userId);
    const monthTrips = history.filter((t) => {
      const d = new Date(`${t.date}T${t.time || '00:00'}`);
      return t.status === 'Completed' && d.getFullYear() === year && d.getMonth() === month;
    });
    const totalCarbonSavedKg = monthTrips.reduce((sum, t) => sum + (t.carbonSavedKg || 0), 0);
    const totalDistanceKm = monthTrips.reduce(
      (sum, t) => sum + (AVG_DISTANCE_KM[t.journeyScale] ?? AVG_DISTANCE_KM.Urban),
      0
    );
    const passengersCarried = monthTrips
      .filter((t) => t.role === 'Host')
      .reduce((sum, t) => sum + Math.max(0, (t.seatsTotal || 0) - (t.seatsAvailable ?? 0)), 0);

    return {
      year,
      month,
      hasData: monthTrips.length > 0,
      completedTrips: monthTrips.length,
      totalCarbonSavedKg: Math.round(totalCarbonSavedKg * 10) / 10,
      totalDistanceKm: Math.round(totalDistanceKm),
      passengersCarried,
      trips: monthTrips
    };
  },

  // ---------- FR-5.10 / FR-5.11 - Monthly Community Leaderboard ----------
  // Ranks hosts by the SAME Composite Host Impact Score formula as My
  // Profile (src/business-logic/HostImpactEngine.js) - reused, not
  // reimplemented, so a host's rank here always matches the score shown on
  // their own profile page.
  async getLeaderboard(userId) {
    const [publicRides, currentUser] = await Promise.all([mockDb.listRides(), mockDb.getCurrentUser()]);
    const hostIds = Array.from(new Set(publicRides.map((r) => r.hostId).concat([userId])));

    const entries = await Promise.all(
      hostIds.map(async (id) => {
        const summary = await HostImpactEngine.getImpactSummary(id);
        const ride = publicRides.find((r) => r.hostId === id);
        const name = id === userId ? currentUser?.fullName || 'You' : ride?.host?.fullName || 'Host';
        return {
          id,
          name,
          isCurrentUser: id === userId,
          compositeScore: summary.compositeScore,
          badge: summary.badge
        };
      })
    );

    return entries
      .sort((a, b) => b.compositeScore - a.compositeScore)
      .map((entry, index) => ({ ...entry, rank: index + 1 }));
  }
};