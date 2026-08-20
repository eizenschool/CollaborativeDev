import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  HttpError,
  computeRoute,
  corsHeaders,
  env,
  json,
  normalizeRide,
  rpc,
  serverRest,
} from "../_shared/m2Routes.ts";

type RideRow = {
  id: string;
  vehicle_id: string;
  pickup: string;
  destination: string;
  pickup_place_id: string | null;
  pickup_latitude: number | null;
  pickup_longitude: number | null;
  destination_place_id: string | null;
  pickup_instructions: string | null;
  departure_at: string;
  journey_scale: "Urban" | "Intercity";
  seats_total: number;
  contribution: string | null;
  restriction_tags: string[];
  waypoints: unknown[];
};

function safeEqual(left: string, right: string): boolean {
  if (!left || left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}

function ridePayload(row: RideRow) {
  return {
    vehicleId: row.vehicle_id,
    pickup: row.pickup,
    destination: row.destination,
    pickupLocation: {
      placeId: row.pickup_place_id,
      latitude: row.pickup_latitude,
      longitude: row.pickup_longitude,
    },
    destinationLocation: { placeId: row.destination_place_id },
    pickupInstructions: row.pickup_instructions || "",
    departureAt: row.departure_at,
    journeyScale: row.journey_scale,
    seatsTotal: row.seats_total,
    contribution: row.contribution || "",
    restrictionTags: row.restriction_tags || [],
    waypoints: row.waypoints || [],
  };
}

async function handle(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return json(request, { error: "POST required" }, 405);
  const expectedSecret = env("M2_ROUTE_BACKFILL_SECRET");
  const suppliedSecret = request.headers.get("x-m2-backfill-secret") || "";
  if (!expectedSecret || expectedSecret.length < 32 || !safeEqual(expectedSecret, suppliedSecret)) {
    throw new HttpError(401, "AUTH_REQUIRED", "Backfill authorization failed.");
  }
  const googleKey = env("GOOGLE_ROUTES_SERVER_KEY");
  if (!googleKey) throw new HttpError(503, "SERVER_CONFIG", "Google Routes is not configured.");

  let body: { limit?: number } = {};
  try { body = await request.json() as { limit?: number }; } catch { /* default limit */ }
  const limit = Math.max(1, Math.min(25, Math.floor(Number(body.limit) || 10)));
  const select = [
    "id", "vehicle_id", "pickup", "destination", "pickup_place_id",
    "pickup_latitude", "pickup_longitude", "destination_place_id",
    "pickup_instructions", "departure_at", "journey_scale", "seats_total",
    "contribution", "restriction_tags", "waypoints",
  ].join(",");
  const rows = await serverRest<RideRow[]>(
    `rides?select=${select}&status=in.(Published,Matched)&departure_at=gt.${encodeURIComponent(new Date().toISOString())}&estimated_arrival_at=is.null&order=departure_at.asc&limit=${limit}`,
  );

  const completed: string[] = [];
  const requiresDriverConfirmation: Array<{ rideId: string; reason: string }> = [];
  for (const row of rows || []) {
    try {
      const ride = normalizeRide(ridePayload(row), { requireOneHour: false });
      const requestId = crypto.randomUUID();
      await rpc<number>("consume_m2_route_quota", { p_request_id: requestId });
      const route = await computeRoute(ride, googleKey);
      await rpc<string>("backfill_quoted_ride", {
        p_ride_id: row.id,
        p_route_quote_id: requestId,
        p_route_quoted_at: new Date().toISOString(),
        p_route_distance_meters: route.distanceMeters,
        p_route_duration_seconds: route.routeDurationSeconds,
        p_route_stopover_seconds: route.stopoverSeconds,
        p_estimated_arrival_at: route.estimatedArrivalAt,
        p_pickup_anchor_latitude: route.pickupAnchor.latitude,
        p_pickup_anchor_longitude: route.pickupAnchor.longitude,
        p_destination_anchor_latitude: route.destinationAnchor.latitude,
        p_destination_anchor_longitude: route.destinationAnchor.longitude,
      });
      completed.push(row.id);
    } catch (error) {
      requiresDriverConfirmation.push({
        rideId: row.id,
        reason: error instanceof Error ? error.message : "Route confirmation is required.",
      });
      if (error instanceof HttpError && error.status === 429) break;
    }
  }

  return json(request, { scanned: rows?.length || 0, completed, requiresDriverConfirmation });
}

Deno.serve(async (request) => {
  try { return await handle(request); }
  catch (error) {
    if (error instanceof HttpError) return json(request, { error: error.message, code: error.code }, error.status);
    console.error(error);
    return json(request, { error: "Route backfill failed.", code: "BACKFILL_FAILED" }, 500);
  }
});
