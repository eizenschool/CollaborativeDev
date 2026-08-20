// ===== BUSINESS LOGIC LAYER (TripHistoryEngine) =====
// Module 5 - Trip Management & Eco Impact (FR-5.1 - FR-5.11)
//
// Everything in this module is READ-ONLY for the user - no create/edit/delete
// of rides happens here (that's Module 2's RideService). It reuses:
//   - RideService / RideRequestService -> Module 2's ride and request data.
//     Going through those services rather than a data-access store is what
//     makes FR-5.1/5.2/5.3 work against Supabase as well as the mock: both
//     already branch on isSupabaseConfigured and return the same shapes.
//   - HostImpactEngine  -> the SAME Composite Host Impact Score formula already
//     used on the Profile/Reputation screen, so the Leaderboard here always
//     matches a host's own profile
//   - departureParts()  -> Module 2's shared Asia/Kuala_Lumpur formatting, so a
//     trip's displayed date matches what Module 2 shows for the same ride
//
// `departure_at` is the authoritative ride instant (D012). The `date`/`time`
// columns were dropped in database/sql/013, so nothing here may read them.

import { isSupabaseConfigured } from '../data-access/supabaseClient.js';
import { mockDb } from '../data-access/mockDataStore.js';
import { RideService } from './RideService.js';
import { RideRequestService } from './RideRequestService.js';
import { HostImpactEngine } from './HostImpactEngine.js';
import { departureParts } from './rideDateTime.js';
import { evaluateAchievements } from './TripAchievements.js';

const round1 = (value) => Math.round(value * 10) / 10;

// Shown instead of a blank board when the app runs against Supabase. Says what
// is missing and why, rather than implying the module is unfinished.
export const LEADERBOARD_NEEDS_COMPLETED_TRIPS =
  'The community leaderboard is not available on the live backend yet. Ranking hosts needs completed trips, and no ride has reached Completed on the connected database.';

const SHORT_MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

// 'YYYY-MM' in Asia/Kuala_Lumpur, taken from the already-localised card date so
// month bucketing never drifts against what the user sees on screen.
function monthKey(year, month) {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

// ---------- Lifecycle status ----------
// Module 2 owns ride lifecycle and its cron job already drives
// Published -> Matched | Expired. Those states, plus Draft/Cancelled, are
// authoritative and must never be overridden - in particular 'Expired'
// (published, nobody joined, departure passed) is NOT a completed trip and
// must never earn carbon credit.
export function deriveDisplayStatus(ride, now = new Date()) {
  if (ride.status !== 'Matched') return ride.status;

  // A Matched ride whose departure has passed really has started or finished,
  // but D012 reserves the 'In Transit'/'Completed' writes for a service-role
  // Module 6 verification pipeline that does not exist yet. Until it lands,
  // show the stage the trip has actually reached rather than leaving every
  // past ride stuck on 'Matched'. Delete this branch the day that pipeline
  // starts writing real transitions.
  const hoursSinceDeparture = (now - new Date(ride.departureAt)) / 3_600_000;
  if (hoursSinceDeparture < 0) return 'Matched';
  if (hoursSinceDeparture < 3) return 'In Transit';
  return 'Completed';
}

// ---------- Estimated carbon savings ----------
// FR-5.4: "estimated based on distance and passengers carried." Ride records
// carry no distance (no lat/lng columns, and D013 rules out billable Maps
// SKUs), so this uses an average trip distance per journey scale times the
// seats actually filled times a standard avoided-emissions factor.
// The carbon model is still an open decision in docs/ai/DECISIONS.md - these
// numbers are a labelled estimate, not a ratified formula.
const AVG_DISTANCE_KM = { Urban: 18, Intercity: 340 };
const EMISSION_FACTOR_KG_PER_PASSENGER_KM = 0.12;

export function estimateDistanceKm(ride) {
  return AVG_DISTANCE_KM[ride.journeyScale] ?? AVG_DISTANCE_KM.Urban;
}

export function estimateCarbonSavedKg(ride) {
  const distanceKm = estimateDistanceKm(ride);
  const passengers = Math.max(0, (ride.seatsTotal || 0) - (ride.seatsAvailable ?? 0));
  // UC5.4 C2 requires a distance greater than zero, and the whole premise of
  // the estimate is a shared ride - a trip that carried nobody saved nothing.
  if (distanceKm <= 0 || passengers <= 0) return 0;
  return round1(distanceKm * passengers * EMISSION_FACTOR_KG_PER_PASSENGER_KM);
}

export function toHistoryCard(ride, role, now = new Date()) {
  const status = deriveDisplayStatus(ride, now);
  const { date, time } = departureParts(ride.departureAt);
  const completed = status === 'Completed';
  return {
    id: ride.id,
    role, // 'Host' | 'Passenger'
    pickup: ride.pickup,
    destination: ride.destination,
    // Module 2's confirmed route references (database/sql/020). Carried through
    // so the trip map can ask the Embed for the exact place rather than
    // re-geocoding the free-text address.
    pickupLocation: ride.pickupLocation || null,
    destinationLocation: ride.destinationLocation || null,
    departureAt: ride.departureAt,
    date,
    time,
    status,
    journeyScale: ride.journeyScale,
    distanceKm: completed ? estimateDistanceKm(ride) : null,
    carbonSavedKg: completed ? estimateCarbonSavedKg(ride) : null,
    host: ride.host || null,
    hostId: ride.hostId,
    contribution: ride.contribution,
    restrictionTags: ride.restrictionTags || [],
    seatsTotal: ride.seatsTotal,
    seatsAvailable: ride.seatsAvailable
  };
}

function passengersCarriedOn(trip) {
  return Math.max(0, (trip.seatsTotal || 0) - (trip.seatsAvailable ?? 0));
}

// Only the Host's own trips count towards "passengers carried" - a passenger
// did not carry themselves.
function aggregate(trips) {
  const hosted = trips.filter((trip) => trip.role === 'Host');
  return {
    completedTrips: trips.length,
    totalCarbonSavedKg: round1(trips.reduce((sum, trip) => sum + (trip.carbonSavedKg || 0), 0)),
    totalDistanceKm: Math.round(trips.reduce((sum, trip) => sum + (trip.distanceKm || 0), 0)),
    passengersCarried: hosted.reduce((sum, trip) => sum + passengersCarriedOn(trip), 0)
  };
}

// FR-5.7's "Carbon saved trend" - the real per-month totals for the last N
// months, so the chart shows measured data instead of an illustration.
function buildMonthlyTrend(completedTrips, now = new Date(), months = 6) {
  const buckets = [];
  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const point = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    buckets.push({
      year: point.getFullYear(),
      month: point.getMonth(),
      label: SHORT_MONTH_NAMES[point.getMonth()],
      carbonSavedKg: 0
    });
  }
  for (const trip of completedTrips) {
    const bucket = buckets.find((item) => monthKey(item.year, item.month) === trip.date.slice(0, 7));
    if (bucket) bucket.carbonSavedKg = round1(bucket.carbonSavedKg + (trip.carbonSavedKg || 0));
  }
  return buckets;
}

// UC5.3's participant list. mockDb.listRideRequests() deliberately refuses
// non-hosts, which is the right privacy boundary: a Host sees everyone they
// accepted, a passenger sees the Host and their own party.
async function buildParticipants(ride, userId, ownRequest, listRideRequests) {
  const host = ride.host
    ? { id: ride.host.id, name: ride.host.fullName, role: 'Host' }
    : { id: ride.hostId, name: 'Host', role: 'Host' };

  const partyOf = (request) => [
    {
      id: request.requesterId,
      name: request.requester?.fullName || 'Passenger',
      role: 'Passenger'
    },
    ...(request.companionNames || []).map((name, index) => ({
      id: `${request.id}_companion_${index}`,
      name,
      role: 'Companion'
    }))
  ];

  if (ride.hostId === userId) {
    try {
      const requests = await listRideRequests(ride.id);
      return [host, ...requests.filter((request) => request.status === 'Accepted').flatMap(partyOf)];
    } catch {
      // Losing the passenger list should not take the whole trip page down.
      return [host];
    }
  }

  return ownRequest ? [host, ...partyOf(ownRequest)] : [host];
}

export const TripHistoryEngine = {
  backend: isSupabaseConfigured ? 'supabase' : 'mock',

  // ---------- FR-5.1 / FR-5.2 - Ride History, lifecycle filtering ----------
  async listHistory(userId, now = new Date()) {
    // RideService.listMyRides() returns joining: [] on its Supabase path, so
    // joined trips always come from RideRequestService - which reads the same
    // ride_requests rows on both backends.
    const [{ hosting }, requests] = await Promise.all([
      RideService.listMyRides(userId),
      RideRequestService.listMyRequests(userId)
    ]);

    const hostedCards = hosting.map((ride) => toHistoryCard(ride, 'Host', now));
    // request.status is the REQUEST state - only an Accepted request means the
    // user actually joined the trip.
    const joinedCards = requests
      .filter((request) => request.status === 'Accepted' && request.ride)
      .map((request) => toHistoryCard(request.ride, 'Passenger', now));

    // UC5.1 C2 - most recent trip first.
    return [...hostedCards, ...joinedCards].sort(
      (a, b) => new Date(b.departureAt) - new Date(a.departureAt)
    );
  },

  // ---------- FR-5.3 / FR-5.4 / FR-5.5 - Trip Detail (read-only) ----------
  async getTripDetail(tripId, userId, now = new Date()) {
    const [ride, requests] = await Promise.all([
      RideService.getRide(tripId),
      RideRequestService.listMyRequests(userId)
    ]);
    if (!ride) return null;

    const isHost = ride.hostId === userId;
    const ownRequest = requests.find(
      (request) => request.rideId === tripId && request.status === 'Accepted'
    );
    // UC5.3 C1 - users may only view trips they hosted or joined. A
    // non-participant gets the same "not found" answer as a missing trip so
    // the response never confirms that the ride exists.
    if (!isHost && !ownRequest) return null;

    const card = toHistoryCard(ride, isHost ? 'Host' : 'Passenger', now);
    const participants = await buildParticipants(
      ride,
      userId,
      ownRequest,
      (id) => RideRequestService.listRideRequests(id)
    );

    return { ...card, participants };
  },

  // ---------- FR-5.6 / FR-5.7 - Environmental Impact Dashboard ----------
  async getImpactSummary(userId, now = new Date()) {
    const history = await TripHistoryEngine.listHistory(userId, now);
    const completed = history.filter((trip) => trip.status === 'Completed');
    const totals = aggregate(completed);

    return {
      hasData: completed.length > 0,
      ...totals,
      // ~21kg CO2 absorbed per tree per year, illustrative.
      treesEquivalent: Math.round(totals.totalCarbonSavedKg / 21),
      monthlyTrend: buildMonthlyTrend(completed, now),
      // FR-5.7 - the same completed trips, expressed as milestones.
      achievements: evaluateAchievements(completed)
    };
  },

  // ---------- FR-5.8 / FR-5.9 - Monthly Impact Report ----------
  // `month` is 0-indexed, matching Date#getMonth().
  async getMonthlyReport(userId, year, month, now = new Date()) {
    const history = await TripHistoryEngine.listHistory(userId, now);
    const key = monthKey(year, month);
    const monthTrips = history.filter(
      (trip) => trip.status === 'Completed' && trip.date.slice(0, 7) === key
    );

    return {
      year,
      month,
      hasData: monthTrips.length > 0,
      ...aggregate(monthTrips),
      trips: monthTrips
    };
  },

  // ---------- FR-5.10 / FR-5.11 - Monthly Community Leaderboard ----------
  // UC5.10: eligible hosts are those with at least one completed trip in the
  // month; they are then ranked by the SAME Composite Host Impact Score
  // formula as My Profile (HostImpactEngine) - reused, not reimplemented, so a
  // host's rank here always matches the score shown on their own profile.
  //
  // Ranking needs every host's completed trips, and Module 2 exposes no
  // all-hosts ride query - only the Published marketplace. Rather than add a
  // speculative one, this stays on the demo store: the connected database
  // currently holds no Completed ride at all, because the only function that
  // can write that status (transition_verified_ride, database/sql/014) is
  // service_role-only with no caller yet. Drop this branch and read live rides
  // once Module 6's verified-trip pipeline starts completing trips.
  async getLeaderboard(userId, year, month, now = new Date()) {
    if (isSupabaseConfigured) throw new Error(LEADERBOARD_NEEDS_COMPLETED_TRIPS);

    const period = year == null || month == null
      ? { year: now.getFullYear(), month: now.getMonth() }
      : { year, month };
    const key = monthKey(period.year, period.month);

    const [allRides, currentUser] = await Promise.all([mockDb.listAllRides(), mockDb.getCurrentUser()]);

    const namesByHostId = new Map();
    const eligibleHostIds = new Set();
    for (const ride of allRides) {
      if (ride.host) namesByHostId.set(ride.hostId, ride.host.fullName);
      const card = toHistoryCard(ride, 'Host', now);
      if (card.status === 'Completed' && card.date.slice(0, 7) === key) {
        eligibleHostIds.add(ride.hostId);
      }
    }

    const entries = await Promise.all(
      Array.from(eligibleHostIds).map(async (id) => {
        const summary = await HostImpactEngine.getImpactSummary(id);
        const isCurrentUser = id === userId;
        return {
          id,
          name: isCurrentUser
            ? currentUser?.fullName || 'You'
            : namesByHostId.get(id) || 'Host',
          isCurrentUser,
          compositeScore: summary.compositeScore,
          badge: summary.badge
        };
      })
    );

    return {
      year: period.year,
      month: period.month,
      entries: entries
        .sort((a, b) => b.compositeScore - a.compositeScore)
        .map((entry, index) => ({ ...entry, rank: index + 1 }))
    };
  }
};
