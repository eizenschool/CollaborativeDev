import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "npm:@supabase/server";
import { classifyPlace, resolveCategory } from "./classification.ts";
import { stateFromAddress } from "./address.ts";
import { SWEEP_REGIONS, type Region } from "./regions.ts";
import { travelAttributesFor } from "./travelAttributes.ts";

const GOOGLE_PLACES_URL = "https://places.googleapis.com/v1";
const GOOGLE_FIELD_MASK = "places.id,places.types,places.location,places.photos";
// `primaryType` is the place's own single classification, as opposed to the
// unordered bag in `types`. It costs nothing extra: Places API (New) prices a
// request at the highest tier present, and `reviews` already puts this one at
// Enterprise + Atmosphere.
//
// `addressComponents` is free for the same reason - it is a Pro-tier field and
// this request is already priced above that. It replaces the sweep region's
// configured state, which was wrong for every place a region's circle reached
// outside its own state; see address.ts.
const DETAILS_FIELD_MASK =
  "displayName,rating,userRatingCount,reviews,photos,types,primaryType,location," +
  "addressComponents,priceLevel,regularOpeningHours,goodForChildren,goodForGroups," +
  "restroom,parkingOptions,accessibilityOptions,outdoorSeating";
const DEFAULT_INCLUDED_TYPES = ["restaurant", "tourist_attraction", "museum", "park"];

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
    rating?: number;
    authorAttribution?: { displayName?: string };
  }>;
  photos?: Array<{
    name?: string;
    authorAttributions?: Array<{ displayName?: string }>;
  }>;
  types?: string[];
  primaryType?: string;
  location?: { latitude?: number; longitude?: number };
  addressComponents?: Array<{
    longText?: string;
    shortText?: string;
    types?: string[];
  }>;
  priceLevel?: string;
  regularOpeningHours?: Record<string, unknown>;
  goodForChildren?: boolean;
  goodForGroups?: boolean;
  restroom?: boolean;
  parkingOptions?: Record<string, boolean>;
  accessibilityOptions?: Record<string, boolean>;
  outdoorSeating?: boolean;
};

type ExistingPlace = {
  id: string;
  source_place_id: string;
  lifecycle_state: string;
  state_before_demotion: string | null;
  // Read so an unclassifiable known place can keep the answer the catalogue
  // already holds instead of being discarded - see resolveCategory.
  category: string;
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

function sentence(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  return /[.!?]$/.test(compact) ? compact : `${compact}.`;
}

// The description used to be the first review's text, written in verbatim and
// unattributed as though the application had written it. Nothing trimmed it to
// a sentence either - `sentence()` only collapses whitespace - so whole reviews
// became descriptions: "Awesome and amazing and better than expectation!!!" for
// Central Market, and one for Merdeka Square naming the hotel its author stayed
// in. FR-6.8 asks for a generated sentence, and a review is somebody's opinion
// rather than a description of the place.
//
// Reviews now go to `reviews`, with their authors, and are shown as reviews.
function descriptionFor(name: string, category: string, state: string) {
  const where = state?.trim() ? ` in ${state.trim()}` : " in Malaysia";
  return {
    description: `${name} is a ${category} destination${where}.`,
    description_is_template: true,
  };
}

// Up to five, matching what Place Details returns and what the detail screen
// renders. Author attribution is not optional: it is the condition under which
// this content may be displayed at all, so a review without one is dropped
// rather than shown anonymously.
function reviewsFor(details: PlaceDetails) {
  return (details.reviews || []).slice(0, 5).flatMap((review) => {
    const text = sentence(review.text?.text || "");
    const author = review.authorAttribution?.displayName?.trim() || "";
    if (!text || !author) return [];
    return [{
      author,
      rating: typeof review.rating === "number" ? review.rating : null,
      text,
    }];
  });
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
  const query = `places?select=id,source_place_id,lifecycle_state,state_before_demotion,category&source_place_id=${encodeURIComponent(inFilter(sourceIds))}`;
  const rows = await supabaseRequest<ExistingPlace[]>(baseUrl, key, query);
  return new Map((rows || []).map((row) => [row.source_place_id, row]));
}

async function upsertTravelAttributes(
  baseUrl: string,
  key: string,
  rows: Array<{ sourcePlaceId: string; attributes: Record<string, unknown> }>,
) {
  if (!rows.length) return 0;
  const places = await knownPlaces(baseUrl, key, rows.map((row) => row.sourcePlaceId));
  const payload = rows.flatMap((row) => {
    const placeId = places.get(row.sourcePlaceId)?.id;
    return placeId ? [{ place_id: placeId, ...row.attributes }] : [];
  });
  if (!payload.length) return 0;
  await supabaseRequest<unknown>(
    baseUrl,
    key,
    "place_travel_attributes?on_conflict=place_id",
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(payload),
    },
  );
  return payload.length;
}

type CatalogueRequest = {
  id: string;
  normalized_name: string;
  requested_name: string;
  support_count: number;
};

async function textSearch(requestedName: string, googleKey: string) {
  const result = await googleRequest<{ places?: NearbyPlace[] }>(
    requestUrl("/places:searchText"),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-FieldMask": GOOGLE_FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery: requestedName,
        regionCode: "MY",
        languageCode: "en",
        maxResultCount: 1,
        locationRestriction: {
          rectangle: {
            low: { latitude: 0.8, longitude: 99.6 },
            high: { latitude: 7.5, longitude: 119.4 },
          },
        },
      }),
    },
    googleKey,
  );
  return result.places?.[0] || null;
}

function isMalaysiaAddress(components: PlaceDetails["addressComponents"]) {
  return Boolean(components?.some((component) =>
    component.types?.includes("country")
      && (component.shortText?.toUpperCase() === "MY" || component.longText?.toLowerCase() === "malaysia")
  ));
}

async function updateCatalogueRequests(
  baseUrl: string,
  key: string,
  normalizedName: string,
  values: Record<string, unknown>,
) {
  await supabaseRequest<unknown>(
    baseUrl,
    key,
    `place_catalogue_requests?normalized_name=eq.${encodeURIComponent(normalizedName)}&status=in.(pending,processing)`,
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ ...values, updated_at: new Date().toISOString() }),
    },
  );
}

async function processCatalogueRequests(
  baseUrl: string,
  databaseKey: string,
  googleKey: string,
  maximum: number,
  dryRun: boolean,
) {
  const pending = await supabaseRequest<CatalogueRequest[]>(
    baseUrl,
    databaseKey,
    "place_catalogue_requests?select=id,normalized_name,requested_name,support_count&status=eq.pending&order=support_count.desc,created_at.asc&limit=100",
  );
  const unique = [...new Map((pending || []).map((row) => [row.normalized_name, row])).values()]
    .sort((a, b) => b.support_count - a.support_count)
    .slice(0, maximum);
  if (dryRun) return { dryRun: true, selected: unique, processed: [] };

  const processed: Array<Record<string, unknown>> = [];
  for (const request of unique) {
    await updateCatalogueRequests(baseUrl, databaseKey, request.normalized_name, { status: "processing" });
    try {
      const match = await textSearch(request.requested_name, googleKey);
      if (!match?.id) {
        await updateCatalogueRequests(baseUrl, databaseKey, request.normalized_name, {
          status: "rejected", rejection_reason: "not_found", resolved_at: new Date().toISOString(),
        });
        processed.push({ name: request.requested_name, status: "rejected", reason: "not_found" });
        continue;
      }

      const detail = await details(match.id, googleKey);
      if (!isMalaysiaAddress(detail.addressComponents)) {
        await updateCatalogueRequests(baseUrl, databaseKey, request.normalized_name, {
          status: "rejected", rejection_reason: "not_in_malaysia", resolved_at: new Date().toISOString(),
        });
        processed.push({ name: request.requested_name, status: "rejected", reason: "not_in_malaysia" });
        continue;
      }
      const types = detail.types?.length ? detail.types : match.types || [];
      const primaryType = detail.primaryType || "";
      const category = classifyPlace(types, primaryType);
      if (!category) {
        await updateCatalogueRequests(baseUrl, databaseKey, request.normalized_name, {
          status: "rejected", rejection_reason: "unsupported_category", resolved_at: new Date().toISOString(),
        });
        processed.push({ name: request.requested_name, status: "rejected", reason: "unsupported_category" });
        continue;
      }
      const location = detail.location || match.location || {};
      if (!validCoordinate(location.latitude, -90, 90) || !validCoordinate(location.longitude, -180, 180)) {
        await updateCatalogueRequests(baseUrl, databaseKey, request.normalized_name, {
          status: "rejected", rejection_reason: "insufficient_source_data", resolved_at: new Date().toISOString(),
        });
        processed.push({ name: request.requested_name, status: "rejected", reason: "insufficient_source_data" });
        continue;
      }

      const known = await knownPlaces(baseUrl, databaseKey, [match.id]);
      const existingCataloguePlaceId = known.get(match.id)?.id || null;
      if (existingCataloguePlaceId) {
        await updateCatalogueRequests(baseUrl, databaseKey, request.normalized_name, {
          status: "rejected", rejection_reason: "duplicate_place",
          resolved_place_id: existingCataloguePlaceId, resolved_at: new Date().toISOString(),
        });
        processed.push({
          name: request.requested_name, status: "rejected",
          reason: "duplicate_place", placeId: existingCataloguePlaceId,
        });
        continue;
      }

      const observedAt = new Date().toISOString();
      const name = detail.displayName?.text?.trim() || request.requested_name;
      const state = stateFromAddress(detail.addressComponents, "Malaysia");
      const reviewCount = Number.isFinite(detail.userRatingCount) ? Number(detail.userRatingCount) : 0;
      const photos = photoReferences(detail);
      await upsertPlaces(baseUrl, databaseKey, [{
        source_place_id: match.id, name, category, types, primary_type: primaryType || null,
        ...descriptionFor(name, category, state),
        rating: typeof detail.rating === "number" ? detail.rating : null,
        review_count: reviewCount, reviews: reviewsFor(detail),
        lat: location.latitude, lng: location.longitude, state,
        photo_references: photos,
        lifecycle_state: reviewCount >= 3 && photos.length ? "Active" : "Provisional",
        state_before_demotion: null, absence_counter: 0,
        last_seen_at: observedAt, updated_at: observedAt,
      }]);
      const created = await knownPlaces(baseUrl, databaseKey, [match.id]);
      const cataloguePlaceId = created.get(match.id)?.id || null;
      await upsertTravelAttributes(baseUrl, databaseKey, [{
        sourcePlaceId: match.id,
        attributes: travelAttributesFor(detail, observedAt),
      }]);
      if (!cataloguePlaceId) throw new Error("Accepted place was not returned after enrichment.");

      await updateCatalogueRequests(baseUrl, databaseKey, request.normalized_name, {
        status: "accepted", rejection_reason: null,
        resolved_place_id: cataloguePlaceId, resolved_at: new Date().toISOString(),
      });
      processed.push({ name: request.requested_name, status: "accepted", placeId: cataloguePlaceId });
    } catch (error) {
      // Provider or database outages are retryable. They do not become a false
      // product rejection and therefore do not notify the requester.
      await updateCatalogueRequests(baseUrl, databaseKey, request.normalized_name, {
        status: "pending", rejection_reason: null,
      });
      processed.push({
        name: request.requested_name, status: "retry",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { dryRun: false, selected: unique.length, processed };
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

  if (input.catalogueRequests === true) {
    const maximum = typeof input.maxCatalogueRequests === "number"
      ? Math.max(1, Math.min(5, Math.floor(input.maxCatalogueRequests)))
      : 5;
    return json(await processCatalogueRequests(
      baseUrl, databaseKey, googleKey, maximum, input.dryRun === true,
    ));
  }

  // A manual call that omits `regions` used to sweep only Kuala Lumpur; it now
  // sweeps every region the catalogue actually holds. See regions.ts for why
  // these coordinates are each state's hub rather than a reconstruction of
  // whatever undocumented circle first found these places.
  const rawRegions = Array.isArray(input.regions) ? input.regions : SWEEP_REGIONS;
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
  // Off by default: re-enriching costs one Place Details request per place, so
  // it has to be asked for rather than happening on every sweep.
  const refreshDetails = input.refreshDetails === true;

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
  const travelAttributeRows: Array<{ sourcePlaceId: string; attributes: Record<string, unknown> }> = [];
  const failures: Array<{ placeId: string; error: string }> = [];
  // Places the sweep found and enrichment paid for, but which classification
  // rejected as not being destinations - hotels and shopping malls, mostly. The
  // Details request is already spent by the time that is known, so this is
  // reported rather than hidden: a region that skips most of what it discovers
  // is a sign the sweep's `includedTypes` are wrong for it.
  // Carries the classification inputs, not just the name. A skip is a judgement
  // about a real place made from data the caller cannot otherwise see - and the
  // first version of this list, which reported only names, hid the fact that
  // Cheong Fatt Tze - The Blue Mansion was being turned away by the very rule
  // written to keep it. A rejection has to be arguable from its own output.
  const skipped: Array<{
    placeId: string;
    name: string;
    primaryType: string;
    types: string[];
  }> = [];
  // Known places the rules could not classify, which kept the category the
  // catalogue already held. A growing list here means the rules are drifting
  // away from what the catalogue actually contains, so it is reported rather
  // than handled silently.
  const retained: Array<{
    placeId: string;
    name: string;
    primaryType: string;
    category: string;
  }> = [];
  // A region's circle is trusted to sit inside Malaysia, but a 50km radius
  // from a border state's hub does not always stay there: Labuan's circle
  // reaches into Brunei, Perlis's reaches into Thailand. processCatalogueRequests
  // already guards its own single-place lookups with isMalaysiaAddress; the
  // sweep enrichment loop below fetches the same addressComponents field but
  // never checked it, so a border region silently upserted places from
  // another country into the Malaysian catalogue.
  const outOfCountry: Array<{ placeId: string; name: string }> = [];
  let enriched = 0;
  let refreshed = 0;
  // The `maxDetails` budget counts requests made, not rows written. A place
  // rejected by classification has still cost a Place Details call, so spending
  // has to be tracked separately from `enriched` or a region full of hotels
  // would keep buying Details until it found twenty it liked.
  let detailsSpent = 0;

  for (const [placeId, item] of discovered) {
    const alreadyKnown = existing.get(placeId);
    // A known place is normally only touched, never re-enriched, because Place
    // Details is the expensive half of ingestion. `refreshDetails` re-enriches
    // it in place: the upsert matches on source_place_id, so the row keeps its
    // id and the interest and notification rows pointing at it survive. That is
    // the difference between this and deleting the catalogue and re-ingesting.
    if (alreadyKnown && !dryRun && !refreshDetails) {
      await markSeen(baseUrl, databaseKey, placeId, alreadyKnown);
      refreshed += 1;
      continue;
    }
    if (detailsSpent >= maxDetails) break;
    try {
      const detail = await details(placeId, googleKey);
      detailsSpent += 1;
      const name = detail.displayName?.text?.trim() || placeId;
      if (!isMalaysiaAddress(detail.addressComponents)) {
        outOfCountry.push({ placeId, name });
        continue;
      }
      const types = detail.types?.length ? detail.types : item.nearby.types || [];
      const primaryType = detail.primaryType || "";
      const resolved = resolveCategory(
        classifyPlace(types, primaryType),
        alreadyKnown?.category,
      );
      // Not a destination, and not something the catalogue has already judged -
      // somewhere to sleep or shop that the sweep's `includedTypes` could not
      // help returning. Enrichment has already been paid for, but writing it in
      // would put a hotel in front of someone asking where to go.
      if (!resolved) {
        skipped.push({ placeId, name, primaryType, types });
        continue;
      }
      const category = resolved.category;
      if (resolved.retained) retained.push({ placeId, name, primaryType, category });
      // A retained place keeps its lifecycle state as well as its category.
      // Without this, refreshing the catalogue would quietly restore the four
      // hotels and the columbarium that 032 retired: the upsert below decides
      // Active or Provisional from review and photo counts alone, and every one
      // of them has plenty of both.
      const lifecycle = resolved.retained
        ? alreadyKnown!.lifecycle_state
        : null;
      const location = detail.location || item.nearby.location || {};
      // Where the place actually is, not which sweep happened to find it. The
      // region's own state is the fallback for a response that omits the
      // component entirely.
      const state = stateFromAddress(detail.addressComponents, item.region.state);
      const description = descriptionFor(name, category, state);
      const reviewCount = Number.isFinite(detail.userRatingCount) ? Number(detail.userRatingCount) : 0;
      const photos = photoReferences(detail);
      const enrichedAt = new Date().toISOString();
      upserts.push({
        source_place_id: placeId,
        name,
        category,
        // Stored so a future classification fix can be re-applied without
        // buying enrichment again - see 031_m6_place_types.sql. Both are
        // Essentials-tier fields already present in this response.
        types,
        primary_type: primaryType || null,
        ...description,
        rating: typeof detail.rating === "number" ? detail.rating : null,
        review_count: reviewCount,
        reviews: reviewsFor(detail),
        lat: location.latitude,
        lng: location.longitude,
        state,
        photo_references: photos,
        lifecycle_state: lifecycle || (reviewCount >= 3 && photos.length ? "Active" : "Provisional"),
        state_before_demotion: null,
        absence_counter: 0,
        last_seen_at: enrichedAt,
        updated_at: enrichedAt,
      });
      travelAttributeRows.push({
        sourcePlaceId: placeId,
        attributes: travelAttributesFor(detail, enrichedAt),
      });
      enriched += 1;
    } catch (error) {
      failures.push({ placeId, error: error instanceof Error ? error.message : String(error) });
    }
  }

  if (!dryRun) await upsertPlaces(baseUrl, databaseKey, upserts);
  const travelAttributesUpserted = dryRun
    ? 0
    : await upsertTravelAttributes(baseUrl, databaseKey, travelAttributeRows);

  // FR-6.3/6.4/6.5 automatic decay is disabled for now, not merely unused -
  // do not re-enable this without fixing the reason it was turned off.
  // "Not found in this sweep's Nearby Search" is not a trustworthy absence
  // signal: (a) Nearby Search (New) hard-caps at maxResultCount<=20 results
  // per call with no pagination, while Penang alone already holds 43
  // catalogued places, so a single sweep structurally cannot see the whole
  // region regardless of how many times it runs; (b) it only ever searches
  // `includedTypes` (default restaurant/tourist_attraction/museum/park), so a
  // catalogued mosque, beach, zoo, water park, or hawker stall would never
  // appear in `discovered` no matter how many times this ran, guaranteeing a
  // false absence rather than an occasional one. Both failures are biased
  // against exactly the quieter, less-reviewed places this module argues
  // should be favoured, not against ones that genuinely disappeared - the
  // opposite of what FR-6.3/6.4/6.5 is for. regions.ts's isWithinSweptRegions
  // and lifecycleDecay.ts's applyAbsentCycle are left in place, tested, and
  // ready for a caller with a trustworthy per-place signal (e.g. a Place
  // Details businessStatus check by known place ID, which has no result-count
  // or type-filter ceiling) - that caller does not exist yet.
  const absent = 0;
  const demoted = 0;
  const retired = 0;

  return json({
    dryRun,
    refreshDetails,
    regions: regions.map((region) => region.id),
    discovered: sourceIds.length,
    enriched,
    refreshed,
    detailsSpent,
    skipped,
    retained,
    outOfCountry,
    absent,
    demoted,
    retired,
    upserted: dryRun ? 0 : upserts.length,
    travelAttributesUpserted,
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
