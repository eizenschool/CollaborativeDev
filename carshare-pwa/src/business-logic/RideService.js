// ===== BUSINESS LOGIC LAYER (RideService) =====
import { supabase, isSupabaseConfigured } from '../data-access/supabaseClient.js';
import { mockDb } from '../data-access/mockDataStore.js';
import {
  departureParts,
  isAtLeastHoursAway,
  klDayRange,
  REQUEST_CUTOFF_HOURS,
  toDepartureAt
} from './rideDateTime.js';
import {
  getCurrentPosition,
  isConfirmedLocation,
  MAX_GPS_ACCURACY_METRES
} from './GooglePlacesService.js';

const JOURNEY_SCALES = ['Urban', 'Intercity'];
const PUBLIC_RIDE_SELECT = `
  id, host_id, pickup, destination,
  departure_at, journey_scale,
  seats_total, seats_available, contribution, restriction_tags,
  status, estimated_arrival_at,
  host:profiles!rides_host_id_fkey(id, full_name, profile_photo_url,
    host_impact_stats(completed_trips, co2_saved_kg, reputation_score, rating)
  )
`;
const LEGACY_PUBLIC_RIDE_SELECT = `
  id, host_id, pickup, destination,
  departure_at, journey_scale,
  seats_total, seats_available, contribution, restriction_tags,
  status,
  host:profiles!rides_host_id_fkey(id, full_name, profile_photo_url,
    host_impact_stats(completed_trips, co2_saved_kg, reputation_score, rating)
  )
`;
const LEGACY_HOST_RIDE_SELECT = `
  *,
  host:profiles!rides_host_id_fkey(id, full_name, profile_photo_url,
    host_impact_stats(completed_trips, co2_saved_kg, reputation_score, rating)
  )
`;

function isUndeployedModule2Upgrade(error) {
  const detail = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`;
  return error?.code === '42703'
    || error?.code === 'PGRST202'
    || /estimated_arrival_at|get_participant_ride_detail/i.test(detail);
}

export function normalizeWaypoints(waypoints = []) {
  return waypoints
    .map((item) => typeof item === 'string'
      ? { name: item, description: '', placeId: null, stopMinutes: 0, legacy: true }
      : item)
    .filter((item) => item?.name?.trim())
    .map((item, index) => ({
      name: item.name.trim(),
      description: typeof item.description === 'string' ? item.description.trim() : '',
      placeId: typeof item.placeId === 'string' ? item.placeId.trim() || null : null,
      order: index,
      stopMinutes: Number.isInteger(Number(item.stopMinutes)) ? Number(item.stopMinutes) : 0,
      ...(!(typeof item.placeId === 'string' && item.placeId.trim()) ? { legacy: true } : {})
    }));
}

export function validateConfirmedWaypoints(waypoints = []) {
  const normalized = normalizeWaypoints(waypoints);
  if (normalized.length > 10) throw new Error('A ride can have at most 10 waypoints.');
  normalized.forEach((waypoint, index) => {
    if (!waypoint.placeId) throw new Error(`Choose waypoint ${index + 1} from Google suggestions.`);
    if (!Number.isInteger(waypoint.stopMinutes) || waypoint.stopMinutes < 0 || waypoint.stopMinutes > 180) {
      throw new Error(`Waypoint ${index + 1} stop must be between 0 and 180 minutes.`);
    }
  });
  return normalized;
}

function rpcError(error) {
  if (!error) return null;
  const message = error.message?.replace(/^.*?: /, '') || 'The ride could not be updated.';
  return Object.assign(new Error(message), { code: error.code });
}

async function functionError(error, data, fallback) {
  let payload = data;
  const response = error?.context;
  if ((!payload || typeof payload !== 'object') && response?.clone) {
    try { payload = await response.clone().json(); } catch { /* keep fallback */ }
  }
  const message = payload?.error || error?.message || fallback;
  return Object.assign(new Error(message), { code: payload?.code || error?.code });
}

async function invokeRouteFunction(body) {
  const { data, error } = await supabase.functions.invoke('m2-route-quote', { body });
  if (error || data?.error) throw await functionError(error, data, 'The route service is temporarily unavailable.');
  return data;
}

async function accuratePosition() {
  const position = await getCurrentPosition();
  const { latitude, longitude, accuracy } = position.coords;
  if (!Number.isFinite(accuracy) || accuracy > MAX_GPS_ACCURACY_METRES) {
    throw new Error(`GPS accuracy must be ${MAX_GPS_ACCURACY_METRES} metres or better.`);
  }
  return { latitude, longitude, accuracy };
}

function normalizeLocation(location) {
  if (!location || typeof location !== 'object') return null;
  const placeId = typeof location.placeId === 'string' ? location.placeId.trim() : '';
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  const hasCoordinates = location.latitude !== null && location.latitude !== undefined && location.latitude !== ''
    && location.longitude !== null && location.longitude !== undefined && location.longitude !== ''
    && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
  if (!placeId && !hasCoordinates) return null;
  return {
    source: hasCoordinates ? 'device' : 'place',
    ...(placeId ? { placeId } : {}),
    ...(hasCoordinates ? { latitude, longitude } : {})
  };
}

function rowLocation(row, prefix) {
  return normalizeLocation({
    placeId: row[`${prefix}_place_id`] ?? row[`${prefix}PlaceId`] ?? null,
    latitude: row[`${prefix}_latitude`] ?? row[`${prefix}Latitude`] ?? null,
    longitude: row[`${prefix}_longitude`] ?? row[`${prefix}Longitude`] ?? null
  });
}

export function validateConfirmedRoute(rideData) {
  if (!isConfirmedLocation(rideData.pickupLocation)) {
    throw new Error('Choose a confirmed pickup location.');
  }
  if (!rideData.destinationLocation?.placeId?.trim()) {
    throw new Error('Choose a confirmed destination from Google suggestions.');
  }
}

export function routeChangeRequiresConfirmation(current, patch) {
  const routeChanged = (patch.pickup !== undefined && patch.pickup.trim() !== current.pickup.trim())
    || (patch.destination !== undefined && patch.destination.trim() !== current.destination.trim());
  return Boolean(current.pickupLocation || current.destinationLocation || routeChanged);
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
    pickupLocation: rowLocation(row, 'pickup'),
    destinationLocation: rowLocation(row, 'destination'),
    pickupInstructions: row.pickup_instructions ?? row.pickupInstructions ?? '',
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
    startedAt: row.started_at ?? row.startedAt ?? null,
    estimatedArrivalAt: row.estimated_arrival_at ?? row.estimatedArrivalAt ?? null,
    routeDistanceMeters: row.route_distance_meters ?? row.routeDistanceMeters ?? null,
    routeDurationSeconds: row.route_duration_seconds ?? row.routeDurationSeconds ?? null,
    routeStopoverSeconds: row.route_stopover_seconds ?? row.routeStopoverSeconds ?? null,
    scheduleBufferUntil: row.schedule_buffer_until ?? row.scheduleBufferUntil ?? null,
    driverArrivedAt: row.driver_arrived_at ?? row.driverArrivedAt ?? null,
    passengerConfirmationDueAt: row.passenger_confirmation_due_at ?? row.passengerConfirmationDueAt ?? null,
    completedAt: row.completed_at ?? row.completedAt ?? null,
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

export function validateRideDraft(rideData, {
  publishing = false,
  requireConfirmedLocations = false,
  requireConfirmedWaypoints = publishing,
  now = new Date()
} = {}) {
  if (!rideData.pickup?.trim()) throw new Error('Pickup point is required.');
  if (!rideData.destination?.trim()) throw new Error('Destination is required.');
  if (requireConfirmedLocations) validateConfirmedRoute(rideData);
  if (requireConfirmedWaypoints) validateConfirmedWaypoints(rideData.waypoints);
  if ((rideData.pickupInstructions?.length || 0) > 300) throw new Error('Pickup instructions must be 300 characters or fewer.');
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
  if (publishing && !isAtLeastHoursAway(departureAt, REQUEST_CUTOFF_HOURS, now)) {
    throw new Error('Published rides must depart at least 1 hour from now.');
  }
  return departureAt;
}

export function buildRideInsert(hostId, rideData, status) {
  const seats = Number(rideData.seatsTotal);
  const pickupLocation = normalizeLocation(rideData.pickupLocation);
  const destinationLocation = normalizeLocation(rideData.destinationLocation);
  return {
    host_id: hostId,
    pickup: rideData.pickup.trim(),
    destination: rideData.destination.trim(),
    pickup_place_id: pickupLocation?.placeId || null,
    pickup_latitude: pickupLocation?.latitude ?? null,
    pickup_longitude: pickupLocation?.longitude ?? null,
    destination_place_id: destinationLocation?.placeId || null,
    pickup_instructions: rideData.pickupInstructions?.trim() || '',
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
  if (patch.pickupLocation !== undefined) {
    const location = normalizeLocation(patch.pickupLocation);
    values.pickup_place_id = location?.placeId || null;
    values.pickup_latitude = location?.latitude ?? null;
    values.pickup_longitude = location?.longitude ?? null;
  }
  if (patch.destinationLocation !== undefined) {
    values.destination_place_id = normalizeLocation(patch.destinationLocation)?.placeId || null;
  }
  if (patch.pickupInstructions !== undefined) values.pickup_instructions = patch.pickupInstructions.trim();
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

export function buildRideRpcArgs(rideData) {
  const pickupLocation = normalizeLocation(rideData.pickupLocation);
  const destinationLocation = normalizeLocation(rideData.destinationLocation);
  return {
    p_vehicle_id: rideData.vehicleId,
    p_pickup: rideData.pickup.trim(),
    p_destination: rideData.destination.trim(),
    p_pickup_place_id: pickupLocation?.placeId || null,
    p_pickup_latitude: pickupLocation?.latitude ?? null,
    p_pickup_longitude: pickupLocation?.longitude ?? null,
    p_destination_place_id: destinationLocation?.placeId || null,
    p_pickup_instructions: rideData.pickupInstructions?.trim() || '',
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
      const run = (select) => {
        let query = supabase.from('rides').select(select).eq('status', 'Published');
        if (from) query = query.ilike('pickup', `%${from}%`);
        if (to) query = query.ilike('destination', `%${to}%`);
        if (date) {
          const range = klDayRange(date);
          query = query.gte('departure_at', range.start).lt('departure_at', range.end);
        }
        return query.order('departure_at', { ascending: true });
      };
      let { data, error } = await run(PUBLIC_RIDE_SELECT);
      if (error && isUndeployedModule2Upgrade(error)) ({ data, error } = await run(LEGACY_PUBLIC_RIDE_SELECT));
      if (error) throw rpcError(error);
      return data.map(mapRideRow);
    }
    return mockDb.listRides({ from, to, date });
  },

  async listMyRides(userId) {
    if (isSupabaseConfigured) {
      const run = (select) => supabase.from('rides').select(select)
        .eq('host_id', userId).order('departure_at', { ascending: false });
      let { data, error } = await run(PUBLIC_RIDE_SELECT);
      if (error && isUndeployedModule2Upgrade(error)) ({ data, error } = await run(LEGACY_PUBLIC_RIDE_SELECT));
      if (error) throw rpcError(error);
      return { hosting: data.map(mapRideRow), joining: [] };
    }
    return mockDb.listMyRides(userId);
  },

  async getRide(rideId) {
    if (isSupabaseConfigured) {
      const { data: sessionData } = await supabase.auth.getSession();
      const run = (select) => supabase.from('rides').select(select).eq('id', rideId).maybeSingle();
      let { data, error } = await run(PUBLIC_RIDE_SELECT);
      if (error && isUndeployedModule2Upgrade(error)) ({ data, error } = await run(LEGACY_PUBLIC_RIDE_SELECT));
      if (error) throw rpcError(error);
      if (!data) return null;
      if (sessionData.session) {
        const { data: privateData, error: privateError } = await supabase.rpc('get_participant_ride_detail', { p_ride_id: rideId });
        if (privateError && !isUndeployedModule2Upgrade(privateError)) throw rpcError(privateError);
        if (privateData) return mapRideRow({ ...privateData, host: data.host });
        if (privateError && data.host_id === sessionData.session.user.id) {
          const { data: legacyHostData, error: legacyHostError } = await run(LEGACY_HOST_RIDE_SELECT);
          if (legacyHostError) throw rpcError(legacyHostError);
          if (legacyHostData) return mapRideRow(legacyHostData);
        }
      }
      return mapRideRow(data);
    }
    return mockDb.getRide(rideId);
  },

  async updateRide(rideId, patch) {
    const current = await this.getRide(rideId);
    if (!current) throw new Error('Ride not found.');
    const merged = { ...current, ...patch };
    validateRideDraft(merged, {
      publishing: current.status === 'Published',
      requireConfirmedLocations: routeChangeRequiresConfirmation(current, patch),
      requireConfirmedWaypoints: patch.waypoints !== undefined || current.status === 'Published'
    });
    if (isSupabaseConfigured) {
      if (current.status === 'Published') {
        if (!patch.routeQuote?.token) throw new Error('Calculate a fresh route before saving a Published ride.');
        const result = await invokeRouteFunction({
          action: 'publish',
          mode: 'update',
          rideId,
          ride: buildRoutePayload(merged),
          quoteToken: patch.routeQuote.token
        });
        return this.getRide(result.rideId);
      }
      const { error } = await supabase.rpc('update_ride', { p_ride_id: rideId, ...buildRideRpcArgs(merged) });
      if (error) throw rpcError(error);
      return this.getRide(rideId);
    }
    return mockDb.updateRide(rideId, patch);
  },

  async publishRide(hostId, rideData, status = 'Published') {
    if (!['Draft', 'Published'].includes(status)) throw new Error('Unsupported ride status.');
    validateRideDraft(rideData, {
      publishing: status === 'Published',
      requireConfirmedLocations: true,
      requireConfirmedWaypoints: true
    });

    if (isSupabaseConfigured) {
      if (status === 'Published') {
        if (!rideData.routeQuote?.token) throw new Error('Calculate a fresh route before publishing.');
        const result = await invokeRouteFunction({
          action: 'publish',
          mode: 'create',
          rideId: null,
          ride: buildRoutePayload(rideData),
          quoteToken: rideData.routeQuote.token
        });
        return this.getRide(result.rideId);
      }
      const { data: rideId, error } = await supabase.rpc('create_ride', {
        ...buildRideRpcArgs(rideData),
        p_publish: false
      });
      if (error) throw rpcError(error);
      return this.getRide(rideId);
    }

    return mockDb.createRide(hostId, { ...rideData, waypoints: normalizeWaypoints(rideData.waypoints) }, status);
  },

  async quoteRide(rideData, { rideId = null } = {}) {
    validateRideDraft(rideData, {
      publishing: true,
      requireConfirmedLocations: true,
      requireConfirmedWaypoints: true
    });
    if (isSupabaseConfigured) {
      const result = await invokeRouteFunction({ action: 'quote', rideId, ride: buildRoutePayload(rideData) });
      return result.quote;
    }
    return mockDb.quoteRide(rideData, { rideId });
  },

  async publishDraft(rideId, routeQuote = null) {
    if (isSupabaseConfigured) {
      const ride = await this.getRide(rideId);
      if (!ride || ride.status !== 'Draft') throw new Error('Only a Draft ride can be published.');
      if (!routeQuote?.token) throw new Error('Calculate a fresh route before publishing.');
      const result = await invokeRouteFunction({
        action: 'publish', mode: 'publish_draft', rideId,
        ride: buildRoutePayload(ride), quoteToken: routeQuote.token
      });
      return this.getRide(result.rideId);
    }
    return mockDb.publishDraft(rideId, routeQuote);
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
  },

  async getLifecycleContext(rideId) {
    if (isSupabaseConfigured) {
      const { data, error } = await supabase.rpc('get_ride_lifecycle_context', { p_ride_id: rideId });
      if (error) throw rpcError(error);
      const row = Array.isArray(data) ? data[0] : data;
      return row ? {
        driverArrivedAt: row.driver_arrived_at ?? null,
        passengerConfirmationDueAt: row.passenger_confirmation_due_at ?? null,
        completedAt: row.completed_at ?? null
      } : null;
    }
    return mockDb.getRideLifecycleContext(rideId);
  },

  async startRide(rideId) {
    if (isSupabaseConfigured) {
      const result = await invokeRouteFunction({ action: 'start', rideId });
      return this.getRide(result.rideId);
    }
    return mockDb.startRide(rideId);
  },

  async confirmDriverArrival(rideId) {
    const position = await accuratePosition();
    if (isSupabaseConfigured) {
      const { error } = await supabase.rpc('confirm_driver_arrival', {
        p_ride_id: rideId,
        p_latitude: position.latitude,
        p_longitude: position.longitude,
        p_accuracy_meters: position.accuracy
      });
      if (error) throw rpcError(error);
      return this.getRide(rideId);
    }
    return mockDb.confirmDriverArrival(rideId, position);
  }
};

export function buildRoutePayload(rideData) {
  return {
    vehicleId: rideData.vehicleId,
    pickup: rideData.pickup?.trim(),
    destination: rideData.destination?.trim(),
    pickupLocation: normalizeLocation(rideData.pickupLocation),
    destinationLocation: normalizeLocation(rideData.destinationLocation),
    pickupInstructions: rideData.pickupInstructions?.trim() || '',
    departureAt: rideData.departureAt || toDepartureAt(rideData.date, rideData.time),
    journeyScale: rideData.journeyScale,
    seatsTotal: Number(rideData.seatsTotal),
    contribution: rideData.contribution?.trim() || '',
    restrictionTags: rideData.restrictionTags || [],
    waypoints: validateConfirmedWaypoints(rideData.waypoints)
  };
}

export function isRouteQuoteFresh(quote, now = new Date()) {
  return Boolean(quote?.token && quote?.expiresAt && new Date(quote.expiresAt).getTime() > now.getTime());
}
