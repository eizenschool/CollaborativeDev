// ===== BUSINESS LOGIC LAYER (RideService) =====
import { supabase, isSupabaseConfigured } from '../data-access/supabaseClient.js';
import { mockDb } from '../data-access/mockDataStore.js';
import {
  departureParts,
  isAtLeastHoursAway,
  klDayRange,
  toDepartureAt
} from './rideDateTime.js';

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

function rpcError(error) {
  if (!error) return null;
  const message = error.message?.replace(/^.*?: /, '') || 'The ride could not be updated.';
  return Object.assign(new Error(message), { code: error.code });
}

export function mapRideRow(row) {
  const host = row.host;
  const stats = host?.host_impact_stats?.[0] || host?.host_impact_stats || null;
  const departureAt = row.departure_at || row.departureAt || toDepartureAt(row.date, row.time);
  const legacyParts = departureParts(departureAt);
  return {
    id: row.id,
    hostId: row.host_id ?? row.hostId,
    pickup: row.pickup,
    destination: row.destination,
    departureAt,
    date: legacyParts.date,
    time: legacyParts.time,
    journeyScale: row.journey_scale ?? row.journeyScale,
    vehicleId: row.vehicle_id ?? row.vehicleId,
    seatsTotal: row.seats_total ?? row.seatsTotal,
    seatsAvailable: row.seats_available ?? row.seatsAvailable,
    contribution: row.contribution,
    restrictionTags: row.restriction_tags || row.restrictionTags || [],
    waypoints: normalizeWaypoints(row.waypoints),
    status: row.status,
    publishedAt: row.published_at ?? row.publishedAt ?? null,
    recruitmentClosedAt: row.recruitment_closed_at ?? row.recruitmentClosedAt ?? null,
    cancelReason: row.cancel_reason ?? row.cancelReason ?? null,
    expiredAt: row.expired_at ?? row.expiredAt ?? null,
    createdAt: row.created_at ?? row.createdAt,
    updatedAt: row.updated_at ?? row.updatedAt ?? null,
    hasAcceptedRequests: (row.seats_available ?? row.seatsAvailable) < (row.seats_total ?? row.seatsTotal),
    host: host
      ? {
          id: host.id,
          fullName: host.full_name ?? host.fullName,
          profilePhotoUrl: host.profile_photo_url ?? host.profilePhotoUrl,
          completedTrips: stats?.completed_trips ?? stats?.completedTrips ?? 0,
          co2SavedKg: stats?.co2_saved_kg ?? stats?.co2SavedKg ?? 0,
          reputationScore: stats?.reputation_score ?? stats?.reputationScore ?? 0,
          rating: stats?.rating ?? null
        }
      : row.host ?? null
  };
}

export function validateRideDraft(rideData, { publishing = false, now = new Date() } = {}) {
  if (!rideData.pickup?.trim()) throw new Error('Pickup point is required.');
  if (!rideData.destination?.trim()) throw new Error('Destination is required.');
  if (!rideData.date && !rideData.departureAt) throw new Error('Departure date is required.');
  if (!rideData.time && !rideData.departureAt) throw new Error('Departure time is required.');
  if (!JOURNEY_SCALES.includes(rideData.journeyScale)) throw new Error('Choose a journey scale.');
  if (!rideData.vehicleId) throw new Error('Choose one of your vehicles.');
  const seats = Number(rideData.seatsTotal);
  if (!Number.isInteger(seats) || seats < 1 || seats > 8) {
    throw new Error('Seats available must be between 1 and 8.');
  }
  if (rideData.vehicleCapacity && seats > Number(rideData.vehicleCapacity)) {
    throw new Error('Available seats cannot exceed the selected vehicle capacity.');
  }
  const departureAt = rideData.departureAt || toDepartureAt(rideData.date, rideData.time);
  if (publishing && !isAtLeastHoursAway(departureAt, 5, now)) {
    throw new Error('Published rides must depart at least 5 hours from now.');
  }
  return departureAt;
}

export function buildRideInsert(hostId, rideData, status) {
  const seats = Number(rideData.seatsTotal);
  return {
    host_id: hostId,
    pickup: rideData.pickup.trim(),
    destination: rideData.destination.trim(),
    departure_at: rideData.departureAt || toDepartureAt(rideData.date, rideData.time),
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
  if (patch.date !== undefined || patch.time !== undefined || patch.departureAt !== undefined) {
    values.departure_at = patch.departureAt || toDepartureAt(patch.date, patch.time);
  }
  if (patch.contribution !== undefined) values.contribution = patch.contribution.trim();
  if (patch.journeyScale !== undefined) values.journey_scale = patch.journeyScale;
  if (patch.vehicleId !== undefined) values.vehicle_id = patch.vehicleId || null;
  if (patch.seatsTotal !== undefined) values.seats_total = Number(patch.seatsTotal);
  if (patch.restrictionTags !== undefined) values.restriction_tags = patch.restrictionTags;
  if (patch.waypoints !== undefined) values.waypoints = normalizeWaypoints(patch.waypoints);
  return values;
}

function rideRpcArgs(rideData) {
  return {
    p_vehicle_id: rideData.vehicleId,
    p_pickup: rideData.pickup.trim(),
    p_destination: rideData.destination.trim(),
    p_departure_at: rideData.departureAt || toDepartureAt(rideData.date, rideData.time),
    p_journey_scale: rideData.journeyScale,
    p_seats_total: Number(rideData.seatsTotal),
    p_contribution: rideData.contribution?.trim() || '',
    p_restriction_tags: rideData.restrictionTags || [],
    p_waypoints: normalizeWaypoints(rideData.waypoints)
  };
}

export const RideService = {
  backend: isSupabaseConfigured ? 'supabase' : 'mock',
  journeyScales: JOURNEY_SCALES,

  async searchRides({ from, to, date } = {}) {
    if (isSupabaseConfigured) {
      let query = supabase.from('rides').select(RIDE_SELECT).eq('status', 'Published');
      if (from) query = query.ilike('pickup', `%${from}%`);
      if (to) query = query.ilike('destination', `%${to}%`);
      if (date) {
        const range = klDayRange(date);
        query = query.gte('departure_at', range.start).lt('departure_at', range.end);
      }
      const { data, error } = await query.order('departure_at', { ascending: true });
      if (error) throw rpcError(error);
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
      if (error) throw rpcError(error);
      return { hosting: data.map(mapRideRow), joining: [] };
    }
    return mockDb.listMyRides(userId);
  },

  async getRide(rideId) {
    if (isSupabaseConfigured) {
      const { data, error } = await supabase.from('rides').select(RIDE_SELECT).eq('id', rideId).maybeSingle();
      if (error) throw rpcError(error);
      return data ? mapRideRow(data) : null;
    }
    return mockDb.getRide(rideId);
  },

  async updateRide(rideId, patch) {
    const current = await this.getRide(rideId);
    if (!current) throw new Error('Ride not found.');
    const merged = { ...current, ...patch };
    validateRideDraft(merged, { publishing: current.status === 'Published' });
    if (isSupabaseConfigured) {
      const { error } = await supabase.rpc('update_ride', { p_ride_id: rideId, ...rideRpcArgs(merged) });
      if (error) throw rpcError(error);
      return this.getRide(rideId);
    }
    return mockDb.updateRide(rideId, patch);
  },

  async publishRide(hostId, rideData, status = 'Published') {
    if (!['Draft', 'Published'].includes(status)) throw new Error('Unsupported ride status.');
    validateRideDraft(rideData, { publishing: status === 'Published' });

    if (isSupabaseConfigured) {
      const { data: rideId, error } = await supabase.rpc('create_ride', {
        ...rideRpcArgs(rideData),
        p_publish: status === 'Published'
      });
      if (error) throw rpcError(error);
      return this.getRide(rideId);
    }

    return mockDb.createRide(hostId, { ...rideData, waypoints: normalizeWaypoints(rideData.waypoints) }, status);
  },

  async publishDraft(rideId) {
    if (isSupabaseConfigured) {
      const { error } = await supabase.rpc('publish_ride', { p_ride_id: rideId });
      if (error) throw rpcError(error);
      return this.getRide(rideId);
    }
    return mockDb.publishDraft(rideId);
  },

  async deleteDraft(rideId) {
    if (isSupabaseConfigured) {
      const { error } = await supabase.rpc('delete_draft_ride', { p_ride_id: rideId });
      if (error) throw rpcError(error);
      return true;
    }
    return mockDb.deleteDraft(rideId);
  },

  async cancelRide(rideId, reason) {
    if (isSupabaseConfigured) {
      const { error } = await supabase.rpc('cancel_ride', { p_ride_id: rideId, p_reason: reason });
      if (error) throw rpcError(error);
      return this.getRide(rideId);
    }
    return mockDb.cancelRide(rideId, reason);
  },

  async closeRecruitment(rideId) {
    if (isSupabaseConfigured) {
      const { error } = await supabase.rpc('close_ride_recruitment', { p_ride_id: rideId });
      if (error) throw rpcError(error);
      return this.getRide(rideId);
    }
    return mockDb.closeRideRecruitment(rideId);
  },

  async reopenRecruitment(rideId) {
    if (isSupabaseConfigured) {
      const { error } = await supabase.rpc('reopen_ride_recruitment', { p_ride_id: rideId });
      if (error) throw rpcError(error);
      return this.getRide(rideId);
    }
    return mockDb.reopenRideRecruitment(rideId);
  }
};
