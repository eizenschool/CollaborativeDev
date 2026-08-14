export const ROUTE_QUOTE_TTL_MS = 5 * 60 * 1000;
export const ROUTE_DAILY_LIMIT = 250;
export const ROUTE_BUFFER_MINUTES = 30;

const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
const ROUTES_FIELD_MASK = [
  "routes.duration",
  "routes.distanceMeters",
  "routes.legs.startLocation",
  "routes.legs.endLocation",
].join(",");

type JsonObject = Record<string, unknown>;

export type ConfirmedLocation = {
  placeId?: string;
  latitude?: number;
  longitude?: number;
};

export type ConfirmedWaypoint = {
  name: string;
  description: string;
  placeId: string;
  order: number;
  stopMinutes: number;
};

export type NormalizedRide = {
  vehicleId: string;
  pickup: string;
  destination: string;
  pickupLocation: ConfirmedLocation;
  destinationLocation: ConfirmedLocation;
  pickupInstructions: string;
  departureAt: string;
  journeyScale: "Urban" | "Intercity";
  seatsTotal: number;
  contribution: string;
  restrictionTags: string[];
  waypoints: ConfirmedWaypoint[];
};

type LatLng = { latitude: number; longitude: number };

export type RouteComputation = {
  quoteId: string;
  quotedAt: string;
  expiresAt: string;
  distanceMeters: number;
  routeDurationSeconds: number;
  stopoverSeconds: number;
  estimatedArrivalAt: string;
  pickupAnchor: LatLng;
  destinationAnchor: LatLng;
};

type QuoteTokenPayload = RouteComputation & {
  version: 1;
  userId: string;
  fingerprint: string;
};

export class HttpError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function env(name: string): string {
  return Deno.env.get(name)?.trim() || "";
}

function namedKey(name: string, preferredName = "default"): string {
  const raw = env(name);
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const preferred = parsed[preferredName];
    if (typeof preferred === "string" && preferred.trim()) return preferred.trim();
    const first = Object.values(parsed).find((value) => typeof value === "string" && value.trim());
    return typeof first === "string" ? first.trim() : "";
  } catch {
    return "";
  }
}

export function supabasePublicKey(): string {
  return env("SUPABASE_ANON_KEY")
    || env("SUPABASE_PUBLISHABLE_KEY")
    || namedKey("SUPABASE_PUBLISHABLE_KEYS");
}

export function supabaseSecretKey(): string {
  return env("SUPABASE_SERVICE_ROLE_KEY")
    || env("SUPABASE_SECRET_KEY")
    || namedKey("SUPABASE_SECRET_KEYS");
}

export function corsHeaders(request: Request): HeadersInit {
  const configured = env("M2_ALLOWED_ORIGIN");
  const requestOrigin = request.headers.get("Origin") || "";
  const allowedOrigin = configured
    ? (configured.split(",").map((value) => value.trim()).includes(requestOrigin) ? requestOrigin : configured.split(",")[0].trim())
    : "*";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-m2-backfill-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

export function json(request: Request, data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function cleanString(value: unknown, field: string, maxLength = 500): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, "INVALID_RIDE", `${field} is required.`);
  }
  const result = value.trim();
  if (result.length > maxLength) throw new HttpError(400, "INVALID_RIDE", `${field} is too long.`);
  return result;
}

function optionalString(value: unknown, maxLength: number): string {
  const result = typeof value === "string" ? value.trim() : "";
  if (result.length > maxLength) throw new HttpError(400, "INVALID_RIDE", "A ride field is too long.");
  return result;
}

function coordinate(value: unknown, min: number, max: number): number | undefined {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) && numeric >= min && numeric <= max ? numeric : undefined;
}

function normalizeLocation(value: unknown, destination = false): ConfirmedLocation {
  const item = value && typeof value === "object" ? value as JsonObject : {};
  const placeId = typeof item.placeId === "string" ? item.placeId.trim() : "";
  const latitude = coordinate(item.latitude, -90, 90);
  const longitude = coordinate(item.longitude, -180, 180);
  const hasCoordinates = latitude !== undefined && longitude !== undefined;
  if (destination && !placeId) {
    throw new HttpError(400, "INVALID_ROUTE", "Choose a confirmed destination from Google suggestions.");
  }
  if (!placeId && !hasCoordinates) {
    throw new HttpError(400, "INVALID_ROUTE", "Choose a confirmed pickup location.");
  }
  return {
    ...(placeId ? { placeId } : {}),
    ...(hasCoordinates ? { latitude, longitude } : {}),
  };
}

export function normalizeRide(value: unknown, { requireOneHour = true } = {}): NormalizedRide {
  const ride = value && typeof value === "object" ? value as JsonObject : {};
  const departure = new Date(cleanString(ride.departureAt, "Departure time", 50));
  if (Number.isNaN(departure.getTime())) throw new HttpError(400, "INVALID_RIDE", "Enter a valid departure time.");
  if (requireOneHour && departure.getTime() - Date.now() < 60 * 60 * 1000) {
    throw new HttpError(400, "DEPARTURE_TOO_SOON", "Published rides must depart at least 1 hour from now.");
  }
  const journeyScale = ride.journeyScale;
  if (journeyScale !== "Urban" && journeyScale !== "Intercity") {
    throw new HttpError(400, "INVALID_RIDE", "Choose a journey scale.");
  }
  const seatsTotal = Number(ride.seatsTotal);
  if (!Number.isInteger(seatsTotal) || seatsTotal < 1 || seatsTotal > 8) {
    throw new HttpError(400, "INVALID_RIDE", "Seats available must be between 1 and 8.");
  }
  const pickupInstructions = optionalString(ride.pickupInstructions, 300);
  const rawWaypoints = Array.isArray(ride.waypoints) ? ride.waypoints : [];
  if (rawWaypoints.length > 10) throw new HttpError(400, "INVALID_ROUTE", "A ride can have at most 10 waypoints.");
  const waypoints = rawWaypoints.map((value, index): ConfirmedWaypoint => {
    const item = value && typeof value === "object" ? value as JsonObject : {};
    const stopMinutes = Number(item.stopMinutes);
    const placeId = typeof item.placeId === "string" ? item.placeId.trim() : "";
    if (!placeId) throw new HttpError(400, "INVALID_ROUTE", `Confirm waypoint ${index + 1} from Google suggestions.`);
    if (!Number.isInteger(stopMinutes) || stopMinutes < 0 || stopMinutes > 180) {
      throw new HttpError(400, "INVALID_ROUTE", `Waypoint ${index + 1} stop must be 0-180 minutes.`);
    }
    return {
      name: cleanString(item.name, `Waypoint ${index + 1}`, 300),
      description: optionalString(item.description, 500),
      placeId,
      order: index,
      stopMinutes,
    };
  });

  return {
    vehicleId: cleanString(ride.vehicleId, "Vehicle", 100),
    pickup: cleanString(ride.pickup, "Pickup point"),
    destination: cleanString(ride.destination, "Destination"),
    pickupLocation: normalizeLocation(ride.pickupLocation),
    destinationLocation: normalizeLocation(ride.destinationLocation, true),
    pickupInstructions,
    departureAt: departure.toISOString(),
    journeyScale,
    seatsTotal,
    contribution: optionalString(ride.contribution, 500),
    restrictionTags: Array.isArray(ride.restrictionTags)
      ? ride.restrictionTags.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean).slice(0, 20)
      : [],
    waypoints,
  };
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256(value: string): Promise<string> {
  return encodeBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

export async function rideFingerprint(ride: NormalizedRide, rideId: string | null): Promise<string> {
  return sha256(JSON.stringify({ rideId, ride }));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  const rawKey = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`m2-route-quote:${secret}`));
  return crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function signQuote(payload: QuoteTokenPayload, secret: string): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    await encryptionKey(secret),
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const signedValue = `${encodeBase64Url(nonce)}.${encodeBase64Url(new Uint8Array(cipher))}`;
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(signedValue));
  return `${signedValue}.${encodeBase64Url(new Uint8Array(signature))}`;
}

export async function verifyQuote(token: string, secret: string): Promise<QuoteTokenPayload> {
  const [encodedNonce, encodedCipher, encodedSignature, extra] = token.split(".");
  if (!encodedNonce || !encodedCipher || !encodedSignature || extra) throw new HttpError(400, "INVALID_QUOTE", "The route quote is invalid.");
  const signedValue = `${encodedNonce}.${encodedCipher}`;
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    decodeBase64Url(encodedSignature),
    new TextEncoder().encode(signedValue),
  );
  if (!valid) throw new HttpError(400, "INVALID_QUOTE", "The route quote signature is invalid.");
  try {
    const payload = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: decodeBase64Url(encodedNonce) },
      await encryptionKey(secret),
      decodeBase64Url(encodedCipher),
    );
    return JSON.parse(new TextDecoder().decode(payload)) as QuoteTokenPayload;
  } catch {
    throw new HttpError(400, "INVALID_QUOTE", "The route quote payload is invalid.");
  }
}

function waypoint(location: ConfirmedLocation): JsonObject {
  if (location.placeId) return { placeId: location.placeId };
  return {
    location: {
      latLng: { latitude: location.latitude, longitude: location.longitude },
    },
  };
}

function parseDuration(value: unknown): number {
  const match = typeof value === "string" ? value.match(/^([0-9]+(?:\.[0-9]+)?)s$/) : null;
  const seconds = match ? Math.ceil(Number(match[1])) : NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) throw new HttpError(502, "ROUTES_INVALID", "Google Routes returned an invalid duration.");
  return seconds;
}

function parseLatLng(value: unknown, label: string): LatLng {
  const item = value && typeof value === "object" ? value as JsonObject : {};
  const latitude = coordinate(item.latitude, -90, 90);
  const longitude = coordinate(item.longitude, -180, 180);
  if (latitude === undefined || longitude === undefined) {
    throw new HttpError(502, "ROUTES_INVALID", `Google Routes did not return the ${label} route anchor.`);
  }
  return { latitude, longitude };
}

export async function computeRoute(ride: NormalizedRide, googleKey: string): Promise<Omit<RouteComputation, "quoteId" | "quotedAt" | "expiresAt">> {
  const response = await fetch(ROUTES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": googleKey,
      "X-Goog-FieldMask": ROUTES_FIELD_MASK,
    },
    body: JSON.stringify({
      origin: waypoint(ride.pickupLocation),
      destination: waypoint(ride.destinationLocation),
      intermediates: ride.waypoints.map((item) => ({ placeId: item.placeId })),
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      departureTime: ride.departureAt,
      languageCode: "en",
      units: "METRIC",
    }),
  });
  const raw = await response.text();
  let body: JsonObject = {};
  try { body = raw ? JSON.parse(raw) as JsonObject : {}; } catch { body = {}; }
  if (!response.ok) {
    const googleMessage = (body.error as JsonObject | undefined)?.message;
    const quota = response.status === 429 || String(googleMessage || "").toLowerCase().includes("quota");
    throw new HttpError(
      quota ? 429 : 502,
      quota ? "ROUTES_QUOTA" : "ROUTES_FAILED",
      quota ? "The Routes API quota is exhausted. Try again later." : "Google Routes could not calculate this journey.",
    );
  }
  const route = Array.isArray(body.routes) ? body.routes[0] as JsonObject | undefined : undefined;
  const legs = route && Array.isArray(route.legs) ? route.legs as JsonObject[] : [];
  if (!route || !legs.length) throw new HttpError(422, "NO_ROUTE", "No drivable route was found for these confirmed locations.");
  const distanceMeters = Number(route.distanceMeters);
  if (!Number.isInteger(distanceMeters) || distanceMeters < 0) throw new HttpError(502, "ROUTES_INVALID", "Google Routes returned an invalid distance.");
  const routeDurationSeconds = parseDuration(route.duration);
  const stopoverSeconds = ride.waypoints.reduce((sum, item) => sum + item.stopMinutes * 60, 0);
  const estimatedArrivalAt = new Date(new Date(ride.departureAt).getTime() + (routeDurationSeconds + stopoverSeconds) * 1000).toISOString();
  const firstLeg = legs[0];
  const lastLeg = legs[legs.length - 1];
  return {
    distanceMeters,
    routeDurationSeconds,
    stopoverSeconds,
    estimatedArrivalAt,
    pickupAnchor: parseLatLng((firstLeg.startLocation as JsonObject | undefined)?.latLng, "pickup"),
    destinationAnchor: parseLatLng((lastLeg.endLocation as JsonObject | undefined)?.latLng, "destination"),
  };
}

function serverHeaders(secret: string): HeadersInit {
  return {
    apikey: secret,
    ...(secret.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${secret}` }),
    "Content-Type": "application/json",
  };
}

export async function serverRest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const baseUrl = env("SUPABASE_URL").replace(/\/$/, "");
  const secret = supabaseSecretKey();
  if (!baseUrl || !secret) throw new HttpError(503, "SERVER_CONFIG", "Supabase server credentials are not configured.");
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    ...init,
    headers: { ...serverHeaders(secret), ...(init.headers || {}) },
  });
  const raw = await response.text();
  if (!response.ok) throw new HttpError(502, "SUPABASE_FAILED", "The route backfill could not read active rides.");
  return (raw ? JSON.parse(raw) : null) as T;
}

export async function rpc<T>(name: string, args: JsonObject): Promise<T> {
  const baseUrl = env("SUPABASE_URL").replace(/\/$/, "");
  const secret = supabaseSecretKey();
  if (!baseUrl || !secret) throw new HttpError(503, "SERVER_CONFIG", "Supabase server credentials are not configured.");
  const response = await fetch(`${baseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: serverHeaders(secret),
    body: JSON.stringify(args),
  });
  const raw = await response.text();
  if (!response.ok) {
    let message = "The route operation could not be saved.";
    try { message = (JSON.parse(raw) as JsonObject).message as string || message; } catch { /* use safe default */ }
    const quota = message.toLowerCase().includes("daily routes api limit");
    throw new HttpError(quota ? 429 : 409, quota ? "ROUTES_QUOTA" : "RIDE_CONFLICT", message);
  }
  return (raw ? JSON.parse(raw) : null) as T;
}

export async function authenticatedUserId(request: Request): Promise<string> {
  const baseUrl = env("SUPABASE_URL").replace(/\/$/, "");
  const publicKey = supabasePublicKey();
  const authorization = request.headers.get("Authorization") || "";
  if (!baseUrl || !publicKey) throw new HttpError(503, "SERVER_CONFIG", "Supabase authentication is not configured.");
  if (!authorization.startsWith("Bearer ")) throw new HttpError(401, "AUTH_REQUIRED", "Sign in before calculating a route.");
  const response = await fetch(`${baseUrl}/auth/v1/user`, {
    headers: { apikey: publicKey, Authorization: authorization },
  });
  const raw = await response.text();
  if (!response.ok) throw new HttpError(401, "AUTH_REQUIRED", "Your session is no longer valid. Sign in again.");
  const user = JSON.parse(raw) as JsonObject;
  if (typeof user.id !== "string" || !user.id) throw new HttpError(401, "AUTH_REQUIRED", "Your session is no longer valid.");
  return user.id;
}

export function quotedRideRpcArgs(userId: string, mode: string, rideId: string | null, ride: NormalizedRide, quote: QuoteTokenPayload): JsonObject {
  return {
    p_host_id: userId,
    p_mode: mode,
    p_ride_id: rideId,
    p_vehicle_id: ride.vehicleId,
    p_pickup: ride.pickup,
    p_destination: ride.destination,
    p_departure_at: ride.departureAt,
    p_journey_scale: ride.journeyScale,
    p_seats_total: ride.seatsTotal,
    p_pickup_place_id: ride.pickupLocation.placeId || null,
    p_pickup_latitude: ride.pickupLocation.latitude ?? null,
    p_pickup_longitude: ride.pickupLocation.longitude ?? null,
    p_destination_place_id: ride.destinationLocation.placeId || null,
    p_pickup_instructions: ride.pickupInstructions,
    p_contribution: ride.contribution,
    p_restriction_tags: ride.restrictionTags,
    p_waypoints: ride.waypoints,
    p_route_quote_id: quote.quoteId,
    p_route_quoted_at: quote.quotedAt,
    p_route_quote_expires_at: quote.expiresAt,
    p_route_distance_meters: quote.distanceMeters,
    p_route_duration_seconds: quote.routeDurationSeconds,
    p_route_stopover_seconds: quote.stopoverSeconds,
    p_estimated_arrival_at: quote.estimatedArrivalAt,
    p_pickup_anchor_latitude: quote.pickupAnchor.latitude,
    p_pickup_anchor_longitude: quote.pickupAnchor.longitude,
    p_destination_anchor_latitude: quote.destinationAnchor.latitude,
    p_destination_anchor_longitude: quote.destinationAnchor.longitude,
  };
}

export function publicQuote(quote: RouteComputation, token: string) {
  return {
    token,
    quoteId: quote.quoteId,
    quotedAt: quote.quotedAt,
    expiresAt: quote.expiresAt,
    distanceMeters: quote.distanceMeters,
    routeDurationSeconds: quote.routeDurationSeconds,
    stopoverSeconds: quote.stopoverSeconds,
    totalDurationSeconds: quote.routeDurationSeconds + quote.stopoverSeconds,
    estimatedArrivalAt: quote.estimatedArrivalAt,
    attribution: `Powered by Google, ©${new Date().getUTCFullYear()} Google`,
  };
}
