// ===== BUSINESS LOGIC LAYER (GeoVerification) =====
// UC6.3 VERIFY LOCATION - cross-check the Host's PIN confirmation against both
// parties' GPS position, within a 100 metre tolerance radius.
//
// The three-way result matters more than it first looks. "Unavailable" is NOT a
// failure: a phone with location services switched off is not evidence of fraud,
// so per UC6.3 A2 the trip is allowed to proceed on manual Host confirmation, and
// the dispute engine later treats that case as neutral rather than incriminating.

import { GPS_RESULT, GPS_TOLERANCE_M } from './constants.js';

const EARTH_RADIUS_M = 6371000;

const toRadians = (deg) => (deg * Math.PI) / 180;

function isValidCoord(c) {
  return (
    c &&
    Number.isFinite(c.lat) &&
    Number.isFinite(c.lng) &&
    Math.abs(c.lat) <= 90 &&
    Math.abs(c.lng) <= 180
  );
}

/**
 * Great-circle distance in metres between two {lat, lng} points.
 * Haversine rather than a flat-earth approximation because the tolerance being
 * tested is 100m - at that scale a naive degree-delta is wrong enough to matter.
 */
export function haversineDistanceM(a, b) {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * UC6.3 - returns the result recorded against the pickup event.
 * Exactly 100m passes: the proposal states the tolerance as a radius, so a point
 * sitting on the boundary is inside it.
 */
export function evaluateGpsCrossCheck(hostCoords, clientCoords) {
  if (!isValidCoord(hostCoords) || !isValidCoord(clientCoords)) {
    // A2: GPS service unreachable - record it, don't block the trip.
    return { result: GPS_RESULT.UNAVAILABLE, distanceM: null };
  }

  const distanceM = Math.round(haversineDistanceM(hostCoords, clientCoords));

  return {
    result: distanceM <= GPS_TOLERANCE_M ? GPS_RESULT.PASS : GPS_RESULT.MISMATCH,
    distanceM
  };
}

export const GeoVerification = {
  haversineDistanceM,
  evaluateGpsCrossCheck
};
