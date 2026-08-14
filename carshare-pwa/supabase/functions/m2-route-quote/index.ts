import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  HttpError,
  ROUTE_QUOTE_TTL_MS,
  authenticatedUserId,
  computeRoute,
  corsHeaders,
  env,
  json,
  normalizeRide,
  publicQuote,
  quotedRideRpcArgs,
  rideFingerprint,
  rpc,
  signQuote,
  verifyQuote,
} from "../_shared/m2Routes.ts";

type Input = {
  action?: string;
  mode?: string;
  rideId?: string | null;
  ride?: unknown;
  quoteToken?: string;
};

async function handle(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return json(request, { error: "POST required", code: "METHOD_NOT_ALLOWED" }, 405);

  const userId = await authenticatedUserId(request);
  let input: Input;
  try { input = await request.json() as Input; }
  catch { throw new HttpError(400, "INVALID_JSON", "Request body must be valid JSON."); }

  const rideId = typeof input.rideId === "string" && input.rideId ? input.rideId : null;
  const ride = normalizeRide(input.ride);
  const fingerprint = await rideFingerprint(ride, rideId);
  const signingSecret = env("M2_ROUTE_QUOTE_SECRET");
  if (!signingSecret || signingSecret.length < 32) {
    throw new HttpError(503, "SERVER_CONFIG", "Route quote signing is not configured.");
  }

  if (input.action === "quote") {
    const googleKey = env("GOOGLE_ROUTES_SERVER_KEY");
    if (!googleKey) throw new HttpError(503, "SERVER_CONFIG", "Google Routes is not configured.");
    await rpc<void>("preflight_m2_route_quote", {
      p_host_id: userId,
      p_vehicle_id: ride.vehicleId,
      p_seats_total: ride.seatsTotal,
      p_ride_id: rideId,
    });
    const requestId = crypto.randomUUID();
    await rpc<number>("consume_m2_route_quota", { p_request_id: requestId });
    const route = await computeRoute(ride, googleKey);
    const quotedAt = new Date();
    const quote = {
      quoteId: requestId,
      quotedAt: quotedAt.toISOString(),
      expiresAt: new Date(quotedAt.getTime() + ROUTE_QUOTE_TTL_MS).toISOString(),
      ...route,
    };
    const token = await signQuote({ version: 1, userId, fingerprint, ...quote }, signingSecret);
    return json(request, { quote: publicQuote(quote, token) });
  }

  if (input.action === "publish") {
    const mode = input.mode || (rideId ? "update" : "create");
    if (!["create", "update", "publish_draft"].includes(mode)) {
      throw new HttpError(400, "INVALID_MODE", "Unsupported publish operation.");
    }
    if (typeof input.quoteToken !== "string" || !input.quoteToken) {
      throw new HttpError(400, "QUOTE_REQUIRED", "Calculate a fresh route before publishing.");
    }
    const quote = await verifyQuote(input.quoteToken, signingSecret);
    if (quote.version !== 1 || quote.userId !== userId || quote.fingerprint !== fingerprint) {
      throw new HttpError(409, "QUOTE_STALE", "Ride details changed. Calculate the route again.");
    }
    if (new Date(quote.expiresAt).getTime() <= Date.now()) {
      throw new HttpError(409, "QUOTE_EXPIRED", "The route quote expired. Calculate the route again.");
    }
    const persistedRideId = await rpc<string>("persist_quoted_ride", quotedRideRpcArgs(userId, mode, rideId, ride, quote));
    return json(request, { rideId: persistedRideId });
  }

  throw new HttpError(400, "INVALID_ACTION", "Action must be quote or publish.");
}

Deno.serve(async (request) => {
  try {
    return await handle(request);
  } catch (error) {
    if (error instanceof HttpError) return json(request, { error: error.message, code: error.code }, error.status);
    console.error(error);
    return json(request, { error: "The route service is temporarily unavailable.", code: "ROUTE_SERVICE_FAILED" }, 500);
  }
});
