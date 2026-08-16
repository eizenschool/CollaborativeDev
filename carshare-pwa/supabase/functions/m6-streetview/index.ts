import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  buildImageUrl, buildMetadataUrl, clampDimension, computeHeading, extractPanoramaLocation,
  hasCoverage, parseCoordinate,
} from "./coverage.ts";

// FR-6.15 Street View proxy. Serves imagery for a coordinate using
// GOOGLE_PLACES_SERVER_KEY, the same Supabase secret m6-ingest holds, so the
// credential never reaches the browser - the whole reason this key carries no
// VITE_ prefix (docs/MODULE6-API-SETUP.md §2). A browser Street View key is not
// needed at all with this design: `<img src>` points here, not at Google.
//
// Metadata-first, same as everywhere else FR-6.15 applies: the free, unmetered
// check always runs before the billed image request. No coverage answers with
// a plain 404, which is exactly the signal an `<img onError>` already reacts to
// for every other image tier this module has (see PlaceImage.jsx) - so the
// client needs no bespoke handling for "this place has no Street View".
//
// Deployed with --no-verify-jwt. This only ever returns a coordinate's public
// Street View imagery or a 404, information /discover already shows an
// anonymous visitor (D017/D018's public-first browsing). Requiring a Supabase
// auth header here would mean embedding the anon key in every <img src>, for a
// caller that gains nothing from it.

const DEFAULT_WIDTH = 600;
const DEFAULT_HEIGHT = 400;

// A coordinate's Street View imagery does not change between two screens
// opening seconds apart, and rarely changes at all - so a repeat view is
// served from cache rather than spending a second request. Same mitigation
// MODULE6-API-SETUP.md §3.3 already documents for Place Photos.
const IMAGE_CACHE_CONTROL = "public, max-age=604800";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function env(name: string): string {
  return Deno.env.get(name)?.trim() || "";
}

async function fetchMetadataStatus(url: string): Promise<unknown> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function handle(request: Request): Promise<Response> {
  const apiKey = env("GOOGLE_PLACES_SERVER_KEY");
  if (!apiKey) return json({ error: "GOOGLE_PLACES_SERVER_KEY is not configured" }, 503);

  const params = new URL(request.url).searchParams;
  const lat = parseCoordinate(params.get("lat"), -90, 90);
  const lng = parseCoordinate(params.get("lng"), -180, 180);
  if (lat === null || lng === null) {
    return json({ error: "lat and lng are required and must be valid coordinates" }, 400);
  }
  const width = clampDimension(params.get("w"), DEFAULT_WIDTH);
  const height = clampDimension(params.get("h"), DEFAULT_HEIGHT);

  const metadataBody = await fetchMetadataStatus(buildMetadataUrl(lat, lng, apiKey));
  if (!hasCoverage(metadataBody)) {
    // No coverage - not an error, just a "no". The caller's <img onError>
    // already knows what to do with this.
    return new Response(null, { status: 404 });
  }

  // Point the camera at the place rather than wherever the panorama's default
  // orientation happens to face. The bearing is computed from the panorama's
  // own location - not the requested coordinate - because Street View snaps
  // to the nearest point it has imagery for, which is rarely on top of the
  // building itself.
  const panoramaLocation = extractPanoramaLocation(metadataBody);
  const heading = panoramaLocation
    ? computeHeading(panoramaLocation.lat, panoramaLocation.lng, lat, lng)
    : undefined;

  const imageResponse = await fetch(buildImageUrl(lat, lng, width, height, apiKey, heading));
  if (!imageResponse.ok || !imageResponse.body) {
    return new Response(null, { status: 502 });
  }

  return new Response(imageResponse.body, {
    status: 200,
    headers: {
      "Content-Type": imageResponse.headers.get("Content-Type") || "image/jpeg",
      "Cache-Control": IMAGE_CACHE_CONTROL,
      // Diagnostic only, not read by any client code. A mismatch report can be
      // checked from the browser's network tab - where the panorama actually
      // was and which way the camera was told to look - without redeploying
      // anything to add temporary logging.
      ...(panoramaLocation ? {
        "X-Streetview-Panorama": `${panoramaLocation.lat},${panoramaLocation.lng}`,
        "X-Streetview-Heading": String(heading),
      } : {}),
    },
  });
}

export default {
  fetch: async (request: Request) => {
    if (request.method !== "GET") return json({ error: "GET required" }, 405);
    try {
      return await handle(request);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  },
};
