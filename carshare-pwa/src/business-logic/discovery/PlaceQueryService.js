// ===== BUSINESS LOGIC LAYER (PlaceQueryService) =====
// UC6.14 - the place query interface Modules 2 and 4 consume.
// FR-6.36 places within a radius of a coordinate, for Module 4's proximity
// filtering. FR-6.37 places within a corridor of a route, for Module 2's
// waypoint tagging.
//
// This exists so neither module has to build a place catalogue of its own. One
// catalogue, refreshed once, serves all three - which is also why Retired places
// are excluded here rather than by each caller: a withholding rule enforced in
// three places is a withholding rule that will eventually be forgotten in one.
//
// The return shape is deliberately narrow and source-independent. Callers get a
// stable contract rather than whatever Google happens to return, so swapping the
// fixture catalogue for the live one changes nothing on their side.

import { discoveryDb } from '../../data-access/discoveryStore.js';
import { distanceKm, isUsablePoint } from './geo.js';
import { selectRecommendable } from './PlaceLifecycle.js';

/**
 * The contract Modules 2 and 4 code against. Everything else the catalogue holds
 * - lifecycle state, absence counters, review text - is Module 6's business and
 * is not exposed.
 */
function toContract(place, extra = {}) {
  return {
    placeId: place.id,
    sourcePlaceId: place.sourcePlaceId,
    name: place.name,
    category: place.category,
    lat: place.lat,
    lng: place.lng,
    state: place.state,
    rating: place.rating ?? null,
    reviewCount: place.reviewCount ?? 0,
    photoReference: place.photoReferences?.[0]?.reference ?? null,
    photoAttribution: place.photoReferences?.[0]?.attribution ?? null,
    ...extra
  };
}

/**
 * Perpendicular distance from a point to the great-circle segment origin->end,
 * in kilometres, plus how far along that segment the nearest point falls.
 *
 * Uses a local equirectangular projection rather than full spherical geometry:
 * over a corridor of a few kilometres on a route of a few hundred, the error is
 * far below the corridor width the caller is choosing anyway, and the simpler
 * form stays readable. `t` is clamped so a place beyond either end measures from
 * the endpoint rather than from an imaginary extension of the route.
 */
function corridorPosition(origin, end, point) {
  const toXY = (p) => ({
    x: p.lng * Math.cos((origin.lat * Math.PI) / 180),
    y: p.lat
  });

  const a = toXY(origin);
  const b = toXY(end);
  const p = toXY(point);

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;

  // A zero-length route has no corridor; every candidate measures from its origin.
  if (lengthSquared === 0) {
    return { offsetKm: distanceKm(origin, point), progress: 0 };
  }

  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  const nearest = {
    lat: origin.lat + t * (end.lat - origin.lat),
    lng: origin.lng + t * (end.lng - origin.lng)
  };

  return { offsetKm: distanceKm(nearest, point), progress: t };
}

export const PlaceQueryService = {
  /** Resolve the public Google/source hint carried by Module 6 Search links. */
  async getPlaceBySourcePlaceId(sourcePlaceId) {
    const wanted = typeof sourcePlaceId === 'string' ? sourcePlaceId.trim() : '';
    if (!wanted) return null;

    const place = selectRecommendable(await discoveryDb.listPlaces())
      .find((candidate) => candidate.sourcePlaceId === wanted);
    return place ? toContract(place) : null;
  },

  /**
   * FR-6.36 - places within `radiusKm` of a coordinate, optionally one category.
   *
   * Module 4 uses this for "rides passing near a landmark" without maintaining
   * its own landmark data. Mirrors `places_near_point()` in
   * `024_m6_destination_discovery.sql`, so the answer is the same whether it is
   * computed here against the fixture catalogue or in Postgres against the live
   * one.
   */
  async queryPlacesNearPoint({ lat, lng, radiusKm, category = null } = {}) {
    const centre = { lat, lng };
    if (!isUsablePoint(centre) || !Number.isFinite(radiusKm) || radiusKm <= 0) return [];

    const places = selectRecommendable(await discoveryDb.listPlaces());

    return places
      .filter((place) => !category || place.category === category)
      .map((place) => ({ place, km: distanceKm(centre, { lat: place.lat, lng: place.lng }) }))
      .filter(({ km }) => Number.isFinite(km) && km <= radiusKm)
      .sort((a, b) => a.km - b.km)
      .map(({ place, km }) => toContract(place, { distanceKm: Math.round(km * 10) / 10 }));
  },

  /**
   * FR-6.37 - places within `corridorWidthKm` either side of the line between
   * two points, ordered by position along the route.
   *
   * Module 2 uses this to offer a Host culinary and cultural stops along a route
   * they are already publishing. Ordering by progress rather than by distance is
   * the point: a Host wants the stops in the order they will pass them, not the
   * nearest one first.
   */
  async queryPlacesAlongRoute({ origin, destination, corridorWidthKm = 5, category = null } = {}) {
    if (!isUsablePoint(origin) || !isUsablePoint(destination)) return [];
    if (!Number.isFinite(corridorWidthKm) || corridorWidthKm <= 0) return [];

    const places = selectRecommendable(await discoveryDb.listPlaces());

    return places
      .filter((place) => !category || place.category === category)
      .map((place) => ({
        place,
        ...corridorPosition(origin, destination, { lat: place.lat, lng: place.lng })
      }))
      .filter(({ offsetKm }) => Number.isFinite(offsetKm) && offsetKm <= corridorWidthKm)
      .sort((a, b) => a.progress - b.progress)
      .map(({ place, offsetKm, progress }) => toContract(place, {
        offsetKm: Math.round(offsetKm * 10) / 10,
        routeProgress: Math.round(progress * 100) / 100
      }));
  }
};
