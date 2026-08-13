import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "npm:@supabase/server";

const GOOGLE_PLACES_URL = "https://places.googleapis.com/v1";
const GOOGLE_FIELD_MASK = "places.id,places.types,places.location,places.photos";
// `primaryType` is the place's own single classification, as opposed to the
// unordered bag in `types`. It costs nothing extra: Places API (New) prices a
// request at the highest tier present, and `reviews` already puts this one at
// Enterprise + Atmosphere.
const DETAILS_FIELD_MASK =
  "displayName,rating,userRatingCount,reviews,photos,types,primaryType,location";
const DEFAULT_INCLUDED_TYPES = ["restaurant", "tourist_attraction", "museum", "park"];
const DEFAULT_REGION = {
  id: "kuala-lumpur",
  state: "Selangor",
  latitude: 3.139,
  longitude: 101.6869,
  radiusMeters: 50_000,
};

// Carried by almost every landmark, park and theme park Google returns, so
// these say "this is somewhere worth visiting" and nothing about which of the
// four categories it belongs to. They are matched last, never first.
const GENERIC_TYPES = ["tourist_attraction", "point_of_interest", "establishment"];

const CATEGORY_TYPES: Record<string, string[]> = {
  culinary: [
    "restaurant", "cafe", "bakery", "bar", "meal_takeaway", "meal_delivery",
    "food", "ice_cream_shop", "coffee_shop",
  ],
  nature: [
    "park", "natural_feature", "national_park", "state_park", "beach",
    "campground", "hiking_area", "zoo", "aquarium",
  ],
  heritage: [
    "museum", "tourist_attraction", "historical_landmark", "castle",
    "church", "mosque", "hindu_temple", "buddhist_temple", "place_of_worship",
  ],
  event: [
    "event_venue", "amusement_park", "performing_arts_theater", "stadium",
  ],
};

type Region = {
  id: string;
  state: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
};

type NearbyPlace = {
  id?: string;
  types?: string[];
  location?: { latitude?: number; longitude?: number };
};

type PlaceDetails = {
  id?: string;
  displayName?: { text?: string };
  rating?: number;
  userRatingCount?: number;
  reviews?: Array<{
    text?: { text?: string };
    authorAttribution?: { displayName?: string };
  }>;
  photos?: Array<{
    name?: string;
    authorAttributions?: Array<{ displayName?: string }>;
  }>;
  types?: string[];
  primaryType?: string;
  location?: { latitude?: number; longitude?: number };
};

type ExistingPlace = {
  source_place_id: string;
  lifecycle_state: string;
  state_before_demotion: string | null;
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function env(name: string): string {
  return Deno.env.get(name)?.trim() || "";
}

function supabaseSecretKeys(): string[] {
  const keys: string[] = [];
  const direct = env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SECRET_KEY");
  if (direct) keys.push(direct);

  // Newer hosted projects expose named secret keys as a JSON object. The
  // ingestion function only needs one server-side key to write through REST.
  const named = env("SUPABASE_SECRET_KEYS");
  if (named) {
    try {
      const parsed = JSON.parse(named) as Record<string, unknown>;
      for (const value of Object.values(parsed)) {
        if (typeof value === "string" && value.trim()) keys.push(value.trim());
      }
    } catch {
      // Fall through to the explicit missing-secret response.
    }
  }
  return [...new Set(keys)];
}

function supabaseSecretKey(): string {
  return supabaseSecretKeys()[0] || "";
}

function validCoordinate(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function normalizeRegion(input: unknown, index: number): Region | null {
  if (!input || typeof input !== "object") return null;
  const candidate = input as Record<string, unknown>;
  const latitude = candidate.latitude;
  const longitude = candidate.longitude;
  const radiusMeters = candidate.radiusMeters;
  const state = typeof candidate.state === "string" ? candidate.state.trim() : "";
  if (!validCoordinate(latitude, -90, 90) || !validCoordinate(longitude, -180, 180)) return null;
  if (typeof radiusMeters !== "number" || !Number.isFinite(radiusMeters) || radiusMeters <= 0) return null;
  if (!state) return null;
  return {
    id: typeof candidate.id === "string" && candidate.id.trim() ? candidate.id.trim() : `region-${index + 1}`,
    state,
    latitude,
    longitude,
    radiusMeters: Math.min(radiusMeters, 50_000),
  };
}

// Classification used to scan a fixed order - culinary, heritage, nature, event -
// and return the first category holding any of the place's types. Because
// `tourist_attraction` sat in the heritage list and nearly everything carries
// it, heritage swallowed the catalogue: KLCC Park, the botanical gardens, the
// bird park and a theme park all came back heritage, and nature and event were
// permanently empty. Menara KL went the other way and came back culinary,
// because it has a restaurant and culinary was checked first of all.
//
// So: trust Google's own primary classification first, consider only the
// specific types second, and let the generic ones decide nothing but the
// fallback.
function specificTypes(category: string): string[] {
  return CATEGORY_TYPES[category].filter((type) => !GENERIC_TYPES.includes(type));
}

function categoryFor(types: string[] = [], primaryType = ""): string {
  const categories = ["nature", "event", "culinary", "heritage"];

  if (primaryType) {
    for (const category of categories) {
      if (specificTypes(category).includes(primaryType)) return category;
    }
    // A place whose own primary type is merely "tourist attraction" is a
    // destination rather than a business, whatever else sits in its type bag.
    // This is what keeps a landmark with a restaurant in it out of culinary.
    if (GENERIC_TYPES.includes(primaryType)) return "heritage";
  }

  for (const category of categories) {
    if (types.some((type) => specificTypes(category).includes(type))) return category;
  }

  return types.some((type) => GENERIC_TYPES.includes(type)) ? "heritage" : "event";
}

function sentence(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  return /[.!?]$/.test(compact) ? compact : `${compact}.`;
}

function descriptionFor(name: string, category: string, details: PlaceDetails) {
  const reviews = details.reviews || [];
  const reviewText = reviews.length >= 3 ? sentence(reviews[0]?.text?.text || "") : "";
  if (reviewText) return { description: reviewText, description_is_template: false };
  return {
    description: `${name} is a ${category} destination in Malaysia.`,
    description_is_template: true,
  };
}

function photoReferences(details: PlaceDetails) {
  return (details.photos || []).slice(0, 5).flatMap((photo) => {
    if (!photo.name) return [];
    const attribution = (photo.authorAttributions || [])
      .map((entry) => entry.displayName?.trim())
      .filter(Boolean)
      .join(", ");
    return [{
      reference: photo.name,
      attribution: attribution || "Google Maps",
    }];
  });
}

function requestUrl(path: string): string {
  return `${GOOGLE_PLACES_URL}${path}`;
}

async function googleRequest<T>(
  input: RequestInfo | URL,
  init: RequestInit,
  googleKey: string,
): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      ...(init.headers || {}),
      "X-Goog-Api-Key": googleKey,
    },
  });
  const body = await response.text();
  let parsed: unknown = null;
  try {
    parsed = body ? JSON.parse(body) : null;
  } catch {
    parsed = body;
  }
  if (!response.ok) {
    const detail = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
    throw new Error(`Google Places ${response.status}: ${detail.slice(0, 500)}`);
  }
  return parsed as T;
}

async function nearby(region: Region, includedTypes: string[], maxResultCount: number, googleKey: string) {
  const body = {
    includedTypes,
    maxResultCount,
    locationRestriction: {
      circle: {
        center: { latitude: region.latitude, longitude: region.longitude },
        radius: region.radiusMeters,
      },
    },
  };
  const result = await googleRequest<{ places?: NearbyPlace[] }>(
    requestUrl("/places:searchNearby"),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-FieldMask": GOOGLE_FIELD_MASK,
      },
      body: JSON.stringify(body),
    },
    googleKey,
  );
  return result.places || [];
}

async function details(placeId: string, googleKey: string): Promise<PlaceDetails> {
  return googleRequest<PlaceDetails>(
    requestUrl(`/places/${encodeURIComponent(placeId)}`),
    {
      method: "GET",
      headers: { "X-Goog-FieldMask": DETAILS_FIELD_MASK },
    },
    googleKey,
  );
}

function restHeaders(key: string): HeadersInit {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

async function supabaseRequest<T>(
  baseUrl: string,
  key: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    ...init,
    headers: { ...restHeaders(key), ...(init.headers || {}) },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase REST ${response.status}: ${body.slice(0, 500)}`);
  return (body ? JSON.parse(body) : null) as T;
}

function inFilter(values: string[]): string {
  return `in.(${values.map((value) => `"${value.replace(/"/g, '""')}"`).join(",")})`;
}

async function knownPlaces(baseUrl: string, key: string, sourceIds: string[]) {
  if (!sourceIds.length) return new Map<string, ExistingPlace>();
  const query = `places?select=source_place_id,lifecycle_state,state_before_demotion&source_place_id=${encodeURIComponent(inFilter(sourceIds))}`;
  const rows = await supabaseRequest<ExistingPlace[]>(baseUrl, key, query);
  return new Map((rows || []).map((row) => [row.source_place_id, row]));
}

async function upsertPlaces(baseUrl: string, key: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  await supabaseRequest<unknown>(
    baseUrl,
    key,
    "places?on_conflict=source_place_id",
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows),
    },
  );
}

async function markSeen(baseUrl: string, key: string, sourceId: string, existing: ExistingPlace) {
  const lifecycle = existing.lifecycle_state === "Stale"
    ? existing.state_before_demotion || "Active"
    : existing.lifecycle_state;
  await supabaseRequest<unknown>(
    baseUrl,
    key,
    `places?source_place_id=eq.${encodeURIComponent(sourceId)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        absence_counter: 0,
        lifecycle_state: lifecycle,
        state_before_demotion: null,
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    },
  );
}

async function runIngestion(request: Request) {
  const googleKey = env("GOOGLE_PLACES_SERVER_KEY");
  const baseUrl = env("SUPABASE_URL").replace(/\/$/, "");
  const databaseKey = supabaseSecretKey();
  if (!googleKey) return json({ error: "GOOGLE_PLACES_SERVER_KEY is not configured" }, 503);
  if (!baseUrl || !databaseKey) return json({ error: "Supabase server credentials are not configured" }, 503);

  let input: Record<string, unknown> = {};
  try {
    input = request.method === "POST" ? ((await request.json()) as Record<string, unknown>) : {};
  } catch {
    return json({ error: "Request body must be valid JSON" }, 400);
  }

  const rawRegions = Array.isArray(input.regions) ? input.regions : [DEFAULT_REGION];
  const regions = rawRegions.map(normalizeRegion).filter((region): region is Region => Boolean(region));
  if (!regions.length) return json({ error: "At least one valid region is required" }, 400);

  const includedTypes = Array.isArray(input.includedTypes)
    ? input.includedTypes.filter((value): value is string => typeof value === "string").slice(0, 50)
    : DEFAULT_INCLUDED_TYPES;
  const maxResultCount = typeof input.maxResultCount === "number"
    ? Math.max(1, Math.min(20, Math.floor(input.maxResultCount)))
    : 20;
  const maxDetails = typeof input.maxDetails === "number"
    ? Math.max(0, Math.min(50, Math.floor(input.maxDetails)))
    : 50;
  const dryRun = input.dryRun === true;

  const discovered = new Map<string, { nearby: NearbyPlace; region: Region }>();
  for (const region of regions) {
    const places = await nearby(region, includedTypes, maxResultCount, googleKey);
    for (const place of places) {
      if (place.id && place.location?.latitude !== undefined && place.location?.longitude !== undefined) {
        discovered.set(place.id, { nearby: place, region });
      }
    }
  }

  const sourceIds = [...discovered.keys()];
  const existing = dryRun ? new Map<string, ExistingPlace>() : await knownPlaces(baseUrl, databaseKey, sourceIds);
  const upserts: Record<string, unknown>[] = [];
  const failures: Array<{ placeId: string; error: string }> = [];
  let enriched = 0;
  let refreshed = 0;

  for (const [placeId, item] of discovered) {
    const alreadyKnown = existing.get(placeId);
    if (alreadyKnown && !dryRun) {
      await markSeen(baseUrl, databaseKey, placeId, alreadyKnown);
      refreshed += 1;
      continue;
    }
    if (enriched >= maxDetails) break;
    try {
      const detail = await details(placeId, googleKey);
      const types = detail.types?.length ? detail.types : item.nearby.types || [];
      const category = categoryFor(types, detail.primaryType || "");
      const name = detail.displayName?.text?.trim() || placeId;
      const description = descriptionFor(name, category, detail);
      const location = detail.location || item.nearby.location || {};
      const reviewCount = Number.isFinite(detail.userRatingCount) ? Number(detail.userRatingCount) : 0;
      const photos = photoReferences(detail);
      upserts.push({
        source_place_id: placeId,
        name,
        category,
        ...description,
        rating: typeof detail.rating === "number" ? detail.rating : null,
        review_count: reviewCount,
        lat: location.latitude,
        lng: location.longitude,
        state: item.region.state,
        photo_references: photos,
        lifecycle_state: reviewCount >= 3 && photos.length ? "Active" : "Provisional",
        state_before_demotion: null,
        absence_counter: 0,
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      enriched += 1;
    } catch (error) {
      failures.push({ placeId, error: error instanceof Error ? error.message : String(error) });
    }
  }

  if (!dryRun) await upsertPlaces(baseUrl, databaseKey, upserts);
  return json({
    dryRun,
    regions: regions.map((region) => region.id),
    discovered: sourceIds.length,
    enriched,
    refreshed,
    upserted: dryRun ? 0 : upserts.length,
    failures,
  });
}

export default {
  fetch: withSupabase({ auth: "secret" }, async (request) => {
    if (request.method !== "POST") return json({ error: "POST required" }, 405);
    try {
      return await runIngestion(request);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  })
};
