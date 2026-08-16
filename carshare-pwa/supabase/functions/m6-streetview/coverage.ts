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
 * - the entire reason FR-6.15 specifies a metadata call before an image one. */
export function buildMetadataUrl(lat: number, lng: number, apiKey: string): string {
  return `${METADATA_URL}?location=${lat},${lng}&key=${encodeURIComponent(apiKey)}`;
}

/** The billed image request, only ever built after metadata confirms coverage. */
export function buildImageUrl(
  lat: number, lng: number, width: number, height: number, apiKey: string,
): string {
  return `${IMAGE_URL}?location=${lat},${lng}&size=${width}x${height}&key=${encodeURIComponent(apiKey)}`;
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
