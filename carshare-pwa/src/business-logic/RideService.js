// ===== BUSINESS LOGIC LAYER (RideService) =====
import { supabase, isSupabaseConfigured } from '../data-access/supabaseClient.js';
import { mockDb } from '../data-access/mockDataStore.js';

const JOURNEY_SCALES = ['Urban', 'Intercity'];
const RIDE_SELECT = '*, host:profiles(id, full_name, profile_photo_url, host_impact_stats(completed_trips, co2_saved_kg, reputation_score, rating))';

function normalizeWaypoints(waypoints = []) {
  return waypoints
    .map((item) => typeof item === 'string' ? { name: item, description: '' } : item)
    .filter((item) => item?.name?.trim())
    .map((item) => ({
      name: item.name.trim(),
      description: item.description?.trim() || ''
    }));
}

export function mapRideRow(row) {
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
    waypoints: normalizeWaypoints(row.waypoints),
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

export function validateRideDraft(rideData) {
  if (!rideData.pickup?.trim()) throw new Error('Pickup point is required.');
  if (!rideData.destination?.trim()) throw new Error('Destination is required.');
  if (!rideData.date) throw new Error('Departure date is required.');
  if (!rideData.time) throw new Error('Departure time is required.');
  if (!JOURNEY_SCALES.includes(rideData.journeyScale)) throw new Error('Choose a journey scale.');
  if (!rideData.vehicleId) throw new Error('Choose one of your vehicles.');
  const seats = Number(rideData.seatsTotal);
  if (!Number.isInteger(seats) || seats < 1 || seats > 8) {
    throw new Error('Seats available must be between 1 and 8.');
  }
}

export function buildRideInsert(hostId, rideData, status) {
  const seats = Number(rideData.seatsTotal);
  return {
    host_id: hostId,
    pickup: rideData.pickup.trim(),
    destination: rideData.destination.trim(),
    date: rideData.date,
    time: rideData.time,
    journey_scale: rideData.journeyScale,
    vehicle_id: rideData.vehicleId || null,
    seats_total: seats,
    seats_available: seats,
    contribution: rideData.contribution?.trim() || '',
    restriction_tags: rideData.restrictionTags || [],
    waypoints: normalizeWaypoints(rideData.waypoints),
    status
  };
}

export function buildRidePatch(patch) {
  const values = {};
  if (patch.pickup !== undefined) values.pickup = patch.pickup.trim();
  if (patch.destination !== undefined) values.destination = patch.destination.trim();
  if (patch.date !== undefined) values.date = patch.date;
  if (patch.time !== undefined) values.time = patch.time;
  if (patch.contribution !== undefined) values.contribution = patch.contribution.trim();
  if (patch.journeyScale !== undefined) values.journey_scale = patch.journeyScale;
  if (patch.vehicleId !== undefined) values.vehicle_id = patch.vehicleId || null;
  if (patch.seatsTotal !== undefined) values.seats_total = Number(patch.seatsTotal);
  if (patch.seatsAvailable !== undefined) values.seats_available = Number(patch.seatsAvailable);
  if (patch.restrictionTags !== undefined) values.restriction_tags = patch.restrictionTags;
  if (patch.waypoints !== undefined) values.waypoints = normalizeWaypoints(patch.waypoints);
  if (patch.status !== undefined) values.status = patch.status;
  return values;
}

export const RideService = {
  backend: isSupabaseConfigured ? 'supabase' : 'mock',
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
      return { hosting: data.map(mapRideRow), joining: [] };
    }
    return mockDb.listMyRides(userId);
  },

  async getRide(rideId) {
    if (isSupabaseConfigured) {
      const { data, error } = await supabase.from('rides').select(RIDE_SELECT).eq('id', rideId).maybeSingle();
      if (error) throw error;
      return data ? mapRideRow(data) : null;
    }
    return mockDb.getRide(rideId);
  },

  async updateRide(rideId, patch) {
    if (isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('rides')
        .update(buildRidePatch(patch))
        .eq('id', rideId)
        .select(RIDE_SELECT)
        .single();
      if (error) throw error;
      return mapRideRow(data);
    }
    return mockDb.updateRide(rideId, patch);
  },

  async publishRide(hostId, rideData, status = 'Published') {
    if (!['Draft', 'Published'].includes(status)) throw new Error('Unsupported ride status.');
    validateRideDraft(rideData);

    if (isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('rides')
        .insert(buildRideInsert(hostId, rideData, status))
        .select(RIDE_SELECT)
        .single();
      if (error) throw error;
      return mapRideRow(data);
    }

    return mockDb.createRide(hostId, { ...rideData, waypoints: normalizeWaypoints(rideData.waypoints) }, status);
  }
};
