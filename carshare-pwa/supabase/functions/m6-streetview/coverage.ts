// ===== BUSINESS LOGIC (Street View coverage check) =====
//
// Extracted for the same reason classification.ts was: this Edge Function's
// entry point imports `jsr:` specifiers Vitest cannot resolve, so anything
// with a decision to get wrong needs to live somewhere importable. Nothing
// here imports anything, so Deno bundles it unchanged.
//
// This function used to also serve the Street View image itself, proxying
// bytes from Google's Static API. That is retired: the interactive embed
// (Maps Embed API, rendered client-side with Module 2's existing
// VITE_GOOGLE_MAPS_EMBED_API_KEY) needs no server-side proxying at all, so
// the only job left here is the one thing that still genuinely needs
// GOOGLE_PLACES_SERVER_KEY - the coverage check, which requires Street View
// Static API authorisation the embed key does not and should not carry.

// How far from the requested coordinate Google may snap to find a panorama.
// Left unbounded, a dense shoplot strip can return imagery from a neighbouring
// address - close enough to report coverage, far enough that the place in
// frame is not the one asked for.
export const RADIUS_METERS = 50;

const METADATA_URL = "https://maps.googleapis.com/maps/api/streetview/metadata";

/**
 * A request coordinate, or `null` if it is missing, not a number, or outside
 * the valid range for its axis. `URLSearchParams.get` returns `null` for an
 * absent param and a string otherwise, so both "not provided" and "provided
 * but garbage" collapse to the same answer: refuse the request.
 */
export function parseCoordinate(value: string | null, min: number, max: number): number | null {
  if (value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/** The free, unmetered metadata request. `source=outdoor` excludes indoor 360
 * photospheres (shopping malls, museum interiors) - real Street View coverage,
 * but not "what this place looks like from the street". */
export function buildMetadataUrl(lat: number, lng: number, apiKey: string): string {
  return `${METADATA_URL}?location=${lat},${lng}&radius=${RADIUS_METERS}`
    + `&source=outdoor&key=${encodeURIComponent(apiKey)}`;
}

/** Google's metadata response uses `"status": "OK"` for genuine coverage and
 * various other strings (`ZERO_RESULTS`, `NOT_FOUND`, ...) for everything else.
 * Treated as a closed set on purpose: an unrecognised or malformed status is
 * not evidence of coverage, so it is refused the same as an explicit "no". */
export function hasCoverage(metadataBody: unknown): boolean {
  return Boolean(
    metadataBody
    && typeof metadataBody === "object"
    && (metadataBody as { status?: unknown }).status === "OK",
  );
}

/**
 * The panorama's own location from a metadata response - not necessarily the
 * requested coordinate. Street View snaps to the nearest point it actually
 * has imagery for, which is usually a few metres into the road rather than on
 * top of the building itself, and that gap is exactly what makes an unheaded
 * request point wherever the capture vehicle was facing rather than at the
 * place. `null` when the response carries no usable location.
 */
export function extractPanoramaLocation(
  metadataBody: unknown,
): { lat: number; lng: number } | null {
  if (!metadataBody || typeof metadataBody !== "object") return null;
  const location = (metadataBody as { location?: { lat?: unknown; lng?: unknown } }).location;
  if (!location || typeof location !== "object") return null;
  const lat = Number(location.lat);
  const lng = Number(location.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

/**
 * Street View's own capture date from a metadata response, e.g. `"2019-08"`.
 * Not every panorama carries one - Google does not document it as guaranteed
 * - so `null` means "unknown", not "very old". Surfaced to the viewer rather
 * than judged here: a hard age cutoff would silently reject imagery for
 * reasons a caller cannot see, and "how old is too old" is a call this
 * function is not in a position to make on someone else's behalf.
 */
export function extractCaptureDate(metadataBody: unknown): string | null {
  if (!metadataBody || typeof metadataBody !== "object") return null;
  const date = (metadataBody as { date?: unknown }).date;
  return typeof date === "string" && date.trim() ? date.trim() : null;
}

/**
 * The compass bearing (0-360, 0 = north) from one coordinate to another, by
 * the standard great-circle initial-bearing formula. Used to turn the camera
 * from where Street View actually found a panorama toward the place that was
 * asked for, rather than leaving it facing whichever way the capture vehicle
 * was pointed.
 *
 * Degenerate case: identical coordinates resolve to 0 (north) rather than
 * throwing - a panorama landing exactly on the requested point has no
 * meaningful direction to turn toward it.
 */
export function computeHeading(
  fromLat: number, fromLng: number, toLat: number, toLng: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const phi1 = toRad(fromLat);
  const phi2 = toRad(toLat);
  const deltaLambda = toRad(toLng - fromLng);

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2)
    - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  const bearing = (Math.atan2(y, x) * 180) / Math.PI;

  return Math.round((bearing + 360) % 360);
}
