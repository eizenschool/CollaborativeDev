// ===== BUSINESS LOGIC LAYER (discovery/geo) =====
// Great-circle distance for the journey-cost signal.
//
// Module 2's GeoVerification.js has an equivalent function, but this module does
// not import it: that file belongs to Module 2 now, and taking a cross-module
// dependency for eight lines of trigonometry would couple Destination Discovery
// to a file whose owner may reshape it. The same formula also appears in
// `places_near_point()` in 021, where it has to be SQL rather than JavaScript.

const EARTH_RADIUS_KM = 6371;
const toRadians = (degrees) => (degrees * Math.PI) / 180;

const isCoordinate = (value, limit) => Number.isFinite(Number(value)) && Math.abs(Number(value)) <= limit;

/** True when a point is usable as a latitude/longitude pair. */
export function isUsablePoint(point) {
  return Boolean(point) && isCoordinate(point.lat, 90) && isCoordinate(point.lng, 180);
}

/**
 * Kilometres between two points, or null where either is unusable.
 *
 * Null rather than 0, deliberately: a missing origin means the distance is
 * unknown, and scoring it as "right here" would push every candidate to the top
 * of the journey-cost axis on the strength of absent information.
 */
export function distanceKm(from, to) {
  if (!isUsablePoint(from) || !isUsablePoint(to)) return null;

  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(from.lat)) * Math.cos(toRadians(to.lat)) * Math.sin(dLng / 2) ** 2;

  return EARTH_RADIUS_KM * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * The greatest distance in a set, used as the denominator of the journey-cost
 * signal. Unknown distances are skipped rather than counted as zero.
 */
export function maxDistanceKm(distances = []) {
  const usable = distances.filter((d) => Number.isFinite(d) && d > 0);
  return usable.length ? Math.max(...usable) : 0;
}

export const Geo = { isUsablePoint, distanceKm, maxDistanceKm };
