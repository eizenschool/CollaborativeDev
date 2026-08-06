// ===== BUSINESS LOGIC LAYER (RideService) =====
import { supabase, isSupabaseConfigured } from '../data-access/supabaseClient.js';
import { mockDb } from '../data-access/mockDataStore.js';

// Backs the Ride Hub (Find a Ride / My Rides) and Publish a Ride flow. GUI
// components call these methods only - never Supabase or mockDataStore directly.
// This is Create + Read (publish + browse/search) for FR-2.1/2.3/2.5/2.6; ride
// editing and cancellation (FR-2.8/2.11 - Update/Delete) are Screens 6/7 from
// the design spec and aren't wired up in this pass yet.

const JOURNEY_SCALES = ['Urban', 'Intercity'];

// rides/profiles/host_impact_stats are snake_case in Postgres (see docs/SUPABASE-SETUP.md),
// same convention as VehicleService and HostImpactEngine. This mapper is the one place
// that translates a Supabase row into the camelCase shape RideCard/PublishRide already
// use against the mock backend, so every component works unchanged on either backend.
function mapRideRow(row) {
  const host = row.host;
  const stats = host?.host_impact_stats?.[0] || host?.host_impact_stats || null;
  return {
    id: row.id,
    hostId: row.host_id,
    pickup: row.pickup,
    destination: row.destination,
    date: row.date,
    time: row.time,
    journeyScale: row.journey_scale,
    vehicleId: row.vehicle_id,
    seatsTotal: row.seats_total,
    seatsAvailable: row.seats_available,
    contribution: row.contribution,
    restrictionTags: row.restriction_tags || [],
    status: row.status,
    createdAt: row.created_at,
    host: host
      ? {
          id: host.id,
          fullName: host.full_name,
          profilePhotoUrl: host.profile_photo_url,
          completedTrips: stats?.completed_trips ?? 0,
          co2SavedKg: stats?.co2_saved_kg ?? 0,
          reputationScore: stats?.reputation_score ?? 0,
          rating: stats?.rating ?? null
        }
      : null
  };
}

// The embedded-resource select used by both search and listMyRides below - keep
// these in one place so the two queries can't drift out of sync with mapRideRow.
const RIDE_SELECT = '*, host:profiles(id, full_name, profile_photo_url, host_impact_stats(completed_trips, co2_saved_kg, reputation_score, rating))';

function validateRideDraft(rideData) {
  if (!rideData.pickup?.trim()) throw new Error('Pickup point is required.');
  if (!rideData.destination?.trim()) throw new Error('Destination is required.');
  if (!rideData.date) throw new Error('Departure date is required.');
  if (!rideData.time) throw new Error('Departure time is required.');
  if (!JOURNEY_SCALES.includes(rideData.journeyScale)) throw new Error('Choose a journey scale.');
  const seats = Number(rideData.seatsTotal);
  if (!seats || seats < 1 || seats > 8) throw new Error('Seats available must be between 1 and 8.');
}

export const RideService = {
  journeyScales: JOURNEY_SCALES,

  async searchRides({ from, to, date } = {}) {
    if (isSupabaseConfigured) {
      let query = supabase.from('rides').select(RIDE_SELECT).eq('status', 'Published');
      if (from) query = query.ilike('pickup', `%${from}%`);
      if (to) query = query.ilike('destination', `%${to}%`);
      if (date) query = query.eq('date', date);
      const { data, error } = await query.order('date', { ascending: true });
      if (error) throw error;
      return data.map(mapRideRow);
    }
    return mockDb.listRides({ from, to, date });
  },

  async listMyRides(userId) {
    if (isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('rides')
        .select(RIDE_SELECT)
        .eq('host_id', userId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      // Ride Request Component (join flow) isn't built in this pass - "Joining"
      // is wired up and ready for Screen 4/5's request flow to populate later.
      return { hosting: data.map(mapRideRow), joining: [] };
    }
    return mockDb.listMyRides(userId);
  },

  // status is 'Draft' (Save as Draft, Step 5) or 'Published' (Publish Ride, Step 5).
  async publishRide(hostId, rideData, status = 'Published') {
    if (status === 'Published') validateRideDraft(rideData);
    else if (!rideData.pickup?.trim() && !rideData.destination?.trim()) {
      throw new Error('Add at least a pickup point or destination before saving a draft.');
    }

    if (isSupabaseConfigured) {
      const seats = Number(rideData.seatsTotal) || 1;
      const { data, error } = await supabase
        .from('rides')
        .insert({
          host_id: hostId,
          pickup: rideData.pickup,
          destination: rideData.destination,
          date: rideData.date,
          time: rideData.time,
          journey_scale: rideData.journeyScale,
          vehicle_id: rideData.vehicleId || null,
          seats_total: seats,
          seats_available: seats,
          contribution: rideData.contribution || '',
          restriction_tags: rideData.restrictionTags || [],
          status
        })
        .select(RIDE_SELECT)
        .single();
      if (error) throw error;
      return mapRideRow(data);
    }

    return mockDb.createRide(hostId, rideData, status);
  }
};
