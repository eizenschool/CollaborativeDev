// Module 6 FR-6.1/6.6: the catalogue's sweep regions, made explicit and
// testable. Until this file existed, only Kuala Lumpur's circle was ever
// written down - as index.ts's single DEFAULT_REGION, which additionally
// carried a real bug: `id: "kuala-lumpur"` paired with `state: "Selangor"`.
// Penang, Melaka and Selangor were ingested by hand against circles whose
// exact centres were never recorded anywhere machine-readable; only the
// ingestion log's resulting state distribution survives
// (docs/MODULE6-API-SETUP.md §6).
//
// The coordinates below are each state's own recognised hub, not a
// reconstruction of the undocumented historical centres - they are chosen so
// a weekly sweep keeps rediscovering the places already in the catalogue, not
// because they are provably identical to whatever circle first found them.
// Kedah and Negeri Sembilan hold no region of their own: both arrived only
// because Penang's and Selangor's circles happen to reach across a state
// border, and a scheduled sweep should keep behaving the same way rather than
// add two more circles to chase them deliberately.
//
// Imports nothing, so both Deno (this function) and Vitest (regions.test.js,
// reachable through vitest.config.js's fourth include glob) can load it - the
// same treatment classification.ts and address.ts already got, and for the
// reason the handover records: logic that cannot be imported cannot be
// tested.

export type Region = {
  id: string;
  state: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
};

// index.ts's own normalizeRegion() already clamps any caller-supplied radius
// to this same figure - kept here too so a region declared in this file can
// never silently exceed what a request-supplied one is allowed to reach.
const MAX_RADIUS_METERS = 50_000;

export const SWEEP_REGIONS: Region[] = [
  {
    id: "kuala-lumpur", state: "Kuala Lumpur",
    latitude: 3.139, longitude: 101.6869, radiusMeters: MAX_RADIUS_METERS,
  },
  {
    id: "penang", state: "Penang",
    latitude: 5.4141, longitude: 100.3288, radiusMeters: MAX_RADIUS_METERS,
  },
  {
    id: "melaka", state: "Melaka",
    latitude: 2.1896, longitude: 102.2501, radiusMeters: MAX_RADIUS_METERS,
  },
  {
    id: "selangor", state: "Selangor",
    latitude: 3.1073, longitude: 101.6067, radiusMeters: MAX_RADIUS_METERS,
  },
];

const EARTH_RADIUS_METERS = 6_371_000;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/**
 * Metres between two coordinates. Duplicated from geo.js's haversine formula
 * rather than imported across the src/ boundary: classification.ts and
 * address.ts set the precedent of this function directory importing nothing
 * outside itself, because a Deno deploy bundles this directory's own import
 * graph and reaching into `src/business-logic/` has no precedent here.
 */
function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * True when a coordinate falls inside at least one swept region's circle.
 *
 * This is what lifecycleDecay.ts's caller uses to decide which catalogue
 * places a sweep was even in a position to find. PlaceLifecycle.js's own rule
 * governs it: absence is only ever counted against a place a completed cycle
 * actually looked for. A catalogue place outside every circle this sweep drew
 * was never reachable by it, so its absence proves nothing and must not start
 * its demotion clock.
 */
export function isWithinSweptRegions(
  lat: number,
  lng: number,
  regions: Region[] = SWEEP_REGIONS,
): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return regions.some((region) =>
    distanceMeters(lat, lng, region.latitude, region.longitude) <= region.radiusMeters
  );
}
