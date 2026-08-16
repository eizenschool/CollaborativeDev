// ===== BUSINESS LOGIC (Street View proxy inputs) =====
//
// Extracted for the same reason classification.ts was: this Edge Function's
// entry point imports `jsr:` specifiers Vitest cannot resolve, so anything with
// a decision to get wrong needs to live somewhere importable. There is not much
// decision logic here - mostly request parsing - but "not much" is exactly what
// made classification.ts's original bug easy to skip testing, and it shipped
// broken twice. Nothing here imports anything, so Deno bundles it unchanged.

// Google's documented ceiling for the Street View Static free tier.
export const MAX_DIMENSION = 640;

// How far from the requested coordinate Google may snap to find a panorama.
// Left unbounded, a dense shoplot strip can return imagery from a neighbouring
// address - close enough to report coverage, far enough that the place in
// frame is not the one asked for. Found live: several places returned imagery
// whose storefront signage named a different business. 50m keeps the search to
// "this building or its immediate frontage", not "somewhere on this street".
export const RADIUS_METERS = 50;

const METADATA_URL = "https://maps.googleapis.com/maps/api/streetview/metadata";
const IMAGE_URL = "https://maps.googleapis.com/maps/api/streetview";

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

/**
 * A requested image dimension, clamped to what Google's free tier actually
 * serves. Never `null` - unlike coordinates, a bad or absent size is not a
 * reason to refuse the request, just a reason to fall back to a sane default.
 */
export function clampDimension(value: string | null, fallback: number): number {
  const n = Number(value);
  const usable = Number.isFinite(n) && n > 0 ? n : fallback;
  return Math.max(1, Math.min(MAX_DIMENSION, Math.round(usable)));
}

/** The free, unmetered metadata request. Always built and always called first
 * - the entire reason FR-6.15 specifies a metadata call before an image one.
 * `source=outdoor` excludes indoor 360 photospheres (shopping malls, museum
 * interiors), which are real Street View coverage but not "what this place
 * looks like from the street" - the thing this frame promises to show. */
export function buildMetadataUrl(lat: number, lng: number, apiKey: string): string {
  return `${METADATA_URL}?location=${lat},${lng}&radius=${RADIUS_METERS}`
    + `&source=outdoor&key=${encodeURIComponent(apiKey)}`;
}

/**
 * The billed image request, only ever built after metadata confirms coverage.
 *
 * `heading` points the camera, in compass degrees, at whatever it is passed -
 * normally the bearing from the panorama's own location toward the requested
 * coordinate (see `computeHeading`), so the frame shows the place rather than
 * whichever direction the capture vehicle happened to be facing. Omitted
 * entirely rather than defaulted to 0: an unheaded request lets Google pick,
 * which is still better than a wrong guess when the panorama's own location
 * could not be determined.
 */
export function buildImageUrl(
  lat: number, lng: number, width: number, height: number, apiKey: string,
  heading?: number,
): string {
  const headingParam = Number.isFinite(heading) ? `&heading=${heading}` : "";
  return `${IMAGE_URL}?location=${lat},${lng}&size=${width}x${height}`
    + `&radius=${RADIUS_METERS}&source=outdoor${headingParam}&key=${encodeURIComponent(apiKey)}`;
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
 * place. `null` when the response carries no usable location, which is the
 * signal to skip heading rather than compute one from garbage.
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
 * The compass bearing (0-360, 0 = north) from one coordinate to another, by
 * the standard great-circle initial-bearing formula. Used to turn the camera
 * from where Street View actually found a panorama toward the place that was
 * asked for, rather than leaving it facing whichever way the capture vehicle
 * was pointed - usually straight down the road, which is why an unheaded
 * request often shows an empty street with the destination out of frame or
 * behind the camera.
 *
 * Degenerate case: identical coordinates resolve to 0 (north) rather than
 * throwing - a panorama landing exactly on the requested point has no
 * meaningful direction to turn toward it, and "look north" is as reasonable a
 * default as any other.
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
