// Real driving-route estimates for the Guide's get_route_estimate tool,
// reusing Module 2's already-audited Google Routes integration
// (_shared/m2Routes.ts::computeRoute) instead of asking an LLM to guess a
// travel time. Deliberately does NOT modify m2Routes.ts - Module 2 owns it
// and its tests assert on its call sites by source text.
//
// This never throws: every failure mode (no budget, no Google quota, no
// drivable route, Routes disabled) degrades to a straight-line distance
// computed first, so the caller always has something real to say.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { computeRoute, HttpError, type NormalizedRide } from "../_shared/m2Routes.ts";
import { haversineKm } from "./retrieval.ts";

type AdminClient = SupabaseClient;

export type RouteSourceKind = "google_routes" | "straight_line" | "unavailable";
export type RouteDegradedReason =
  | null | "guide_budget_exhausted" | "global_quota_exhausted"
  | "routes_unconfigured" | "routes_failed" | "no_route" | "no_origin";

export type GuideRouteEstimate = {
  kind: RouteSourceKind;
  originLabel: string;
  destinationName: string;
  destinationState: string;
  distanceMeters: number | null;
  durationSeconds: number | null;
  straightLineKm: number | null;
  degradedReason: RouteDegradedReason;
  checkedAt: string;
};

function classifyQuotaError(message: string): RouteDegradedReason {
  if (/M6_GUIDE_ROUTE_BUDGET/.test(message)) return "guide_budget_exhausted";
  if (/Daily Routes API limit reached/i.test(message)) return "global_quota_exhausted";
  return "routes_failed";
}

export async function estimateGuideRoute(args: {
  admin: AdminClient;
  origin: { lat: number; lng: number } | null;
  originPlaceId: string | null;
  originLabel: string;
  destination: { lat: number; lng: number; name: string; state: string };
  departureAt?: string;
  googleKey?: string;
  routesEnabled?: boolean;
  traceId?: string;
}): Promise<GuideRouteEstimate> {
  const {
    admin, origin, originPlaceId, originLabel, destination,
    departureAt = new Date(Date.now() + 2 * 60_000).toISOString(),
    googleKey = Deno.env.get("GOOGLE_ROUTES_SERVER_KEY")?.trim() || "",
    routesEnabled = Deno.env.get("M6_GUIDE_ROUTES_ENABLED") === "true",
    traceId = ""
  } = args;

  const checkedAt = new Date().toISOString();
  const base = {
    originLabel, destinationName: destination.name, destinationState: destination.state, checkedAt
  };

  if (!origin && !originPlaceId) {
    return { ...base, kind: "unavailable", distanceMeters: null, durationSeconds: null,
      straightLineKm: null, degradedReason: "no_origin" };
  }

  // Compute this first so every degraded path below already holds a real
  // number instead of nothing.
  const straightLineKm = origin
    ? haversineKm(origin, { lat: destination.lat, lng: destination.lng })
    : null;

  const degrade = (reason: RouteDegradedReason): GuideRouteEstimate => ({
    ...base, kind: "straight_line", distanceMeters: null, durationSeconds: null,
    straightLineKm, degradedReason: reason
  });

  if (!routesEnabled || !googleKey) return degrade("routes_unconfigured");

  const requestId = crypto.randomUUID();
  const { error: quotaError } = await admin.rpc("consume_m6_guide_route_quota", { p_request_id: requestId });
  if (quotaError) {
    console.warn(JSON.stringify({ event: "m6_guide_route_quota_denied", traceId, reason: quotaError.message }));
    return degrade(classifyQuotaError(String(quotaError.message || "")));
  }

  const ride = {
    vehicleId: "", pickup: originLabel, destination: destination.name,
    pickupLocation: origin ? { latitude: origin.lat, longitude: origin.lng } : { placeId: originPlaceId as string },
    destinationLocation: { latitude: destination.lat, longitude: destination.lng },
    pickupInstructions: "", departureAt,
    journeyScale: "Intercity", seatsTotal: 1, contribution: "0",
    restrictionTags: [], waypoints: []
  } as NormalizedRide;

  try {
    const computed = await computeRoute(ride, googleKey);
    return {
      ...base, kind: "google_routes", distanceMeters: computed.distanceMeters,
      durationSeconds: computed.routeDurationSeconds, straightLineKm, degradedReason: null
    };
  } catch (error) {
    const code = error instanceof HttpError ? error.code : "ROUTES_FAILED";
    console.warn(JSON.stringify({ event: "m6_guide_route_compute_failure", traceId, code,
      message: error instanceof Error ? error.message : String(error) }));
    return degrade(code === "NO_ROUTE" ? "no_route" : "routes_failed");
  }
}
