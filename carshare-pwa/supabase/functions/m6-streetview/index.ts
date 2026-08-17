import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  buildMetadataUrl, computeHeading, extractCaptureDate, extractPanoramaLocation,
  hasCoverage, parseCoordinate,
} from "./coverage.ts";

// FR-6.15 Street View coverage check. Answers whether a coordinate has Street
// View imagery, which way to point the camera, and how old the capture is -
// so the browser can decide whether to offer the interactive embed at all,
// and how to frame it.
//
// This function no longer serves image bytes. It used to proxy the Street
// View Static image directly, holding GOOGLE_PLACES_SERVER_KEY server-side so
// the browser never saw a Google key at all. That is superseded: the
// interactive embed (Maps Embed API) is rendered client-side with Module 2's
// existing VITE_GOOGLE_MAPS_EMBED_API_KEY regardless of anything this
// function does, so there is no image left to proxy. What genuinely still
// needs the server key is the coverage check itself - it requires Street View
// Static API authorisation, which the embed key does not carry and should not
// be widened to carry just for this.
//
// Deployed with --no-verify-jwt. This only ever answers "is there public
// Street View imagery here", the same class of information /discover already
// shows an anonymous visitor (D017/D018's public-first browsing).

// This is called with fetch() directly from the browser, unlike the image
// proxy it replaced - a plain <img src> is never subject to CORS, but a JSON
// response read by client JS is. Wildcarded rather than restricted to the
// app's own origin: the response carries nothing but a coordinate's public
// coverage/heading/date, the same class of information /discover already
// shows an anonymous visitor, and no cookies or credentials travel with this
// request for an origin restriction to protect.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...CORS_HEADERS,
    },
  });
}

function env(name: string): string {
  return Deno.env.get(name)?.trim() || "";
}

async function fetchMetadata(url: string): Promise<unknown> {
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

  const metadataBody = await fetchMetadata(buildMetadataUrl(lat, lng, apiKey));
  if (!hasCoverage(metadataBody)) {
    return json({ covered: false });
  }

  const panoramaLocation = extractPanoramaLocation(metadataBody);
  const heading = panoramaLocation
    ? computeHeading(panoramaLocation.lat, panoramaLocation.lng, lat, lng)
    : null;

  return json({
    covered: true,
    heading,
    capturedAt: extractCaptureDate(metadataBody),
  });
}

export default {
  fetch: async (request: Request) => {
    // A plain GET with no custom headers should not trigger a CORS preflight
    // at all, but a browser is free to send one anyway - answered here rather
    // than trusted not to happen.
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (request.method !== "GET") return json({ error: "GET required" }, 405);
    try {
      return await handle(request);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  },
};
