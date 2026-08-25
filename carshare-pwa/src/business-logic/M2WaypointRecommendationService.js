// Module 2 adapter for the shared Module 6 destination catalogue.
// Presentation only receives confirmed waypoint-shaped data from this service.
import { PlaceQueryService } from './discovery/PlaceQueryService.js';

const RECOMMENDATION_CATEGORIES = new Set(['culinary', 'heritage']);
export const WAYPOINT_RECOMMENDATION_LIMIT = 6;
export const WAYPOINT_CORRIDOR_WIDTH_KM = 5;
export const DEFAULT_RECOMMENDED_STOP_MINUTES = 30;

function point(value) {
  const lat = Number(value?.lat ?? value?.latitude);
  const lng = Number(value?.lng ?? value?.longitude);
  return Number.isFinite(lat) && lat >= -90 && lat <= 90
    && Number.isFinite(lng) && lng >= -180 && lng <= 180
    ? { lat, lng }
    : null;
}

export async function queryWaypointRecommendations(routeQuote, selectedWaypoints = []) {
  const origin = point(routeQuote?.recommendationRoute?.origin);
  const destination = point(routeQuote?.recommendationRoute?.destination);
  if (!origin || !destination) return [];

  const selected = new Set((selectedWaypoints || []).map((item) => item?.placeId).filter(Boolean));
  const results = await PlaceQueryService.queryPlacesAlongRoute({ origin, destination, corridorWidthKm: WAYPOINT_CORRIDOR_WIDTH_KM });
  return results
    .filter((item) => RECOMMENDATION_CATEGORIES.has(String(item.category || '').toLowerCase()))
    .filter((item) => !selected.has(item.sourcePlaceId || item.placeId))
    .sort((left, right) => Number(left.routeProgress ?? 1) - Number(right.routeProgress ?? 1))
    .slice(0, WAYPOINT_RECOMMENDATION_LIMIT)
    .map((item) => ({
      name: item.name,
      description: item.category === 'culinary' ? 'Culinary stop along your route.' : 'Cultural stop along your route.',
      placeId: item.sourcePlaceId || item.placeId,
      stopMinutes: DEFAULT_RECOMMENDED_STOP_MINUTES,
      category: item.category,
      photoReference: item.photoReference,
      routeProgress: item.routeProgress,
      offsetKm: item.offsetKm,
      rating: item.rating,
      reviewCount: item.reviewCount
    }));
}

export const M2WaypointRecommendationService = { queryWaypointRecommendations };
