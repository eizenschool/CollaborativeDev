import { CATEGORY } from '../m6-discovery/discovery/constants.js';

export const SEARCH_RECOMMENDATION_SECTIONS = Object.freeze([
  { key: 'recommended', label: 'Recommended for you', source: 'primary' },
  { key: 'unserved', label: 'Places needing a ride', source: 'unserved' },
  { key: 'more', label: 'More destinations', source: 'withheld' }
]);

export const SEARCH_RECOMMENDATION_CATEGORIES = Object.freeze(['all', ...Object.values(CATEGORY)]);

export const SEARCH_NEARBY_RADIUS_KM = 25;

export function isWithinSearchNearbyRadius(distanceKm) {
  if (distanceKm === null || distanceKm === undefined || distanceKm === '') return false;
  const distance = Number(distanceKm);
  return Number.isFinite(distance) && distance >= 0 && distance <= SEARCH_NEARBY_RADIUS_KM;
}

function usableOrigin(origin) {
  const lat = Number(origin?.lat);
  const lng = Number(origin?.lng);
  if (!Number.isFinite(lat) || Math.abs(lat) > 90
    || !Number.isFinite(lng) || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

export function buildSearchRecommendationRequest({ userId, travelDate, origin } = {}) {
  const request = { userId, travelDate };
  const nearbyOrigin = usableOrigin(origin);
  if (!nearbyOrigin) return request;
  return {
    ...request,
    origin: nearbyOrigin,
    maxDistanceKm: SEARCH_NEARBY_RADIUS_KM
  };
}

export async function loadNearbySearchRecommendations({
  userId,
  travelDate,
  locate,
  search
} = {}) {
  const position = await locate();
  const origin = { lat: Number(position.latitude), lng: Number(position.longitude) };
  const result = await search(buildSearchRecommendationRequest({ userId, travelDate, origin }));
  return {
    origin,
    candidates: collectSearchRecommendations(result).filter((candidate) => (
      isWithinSearchNearbyRadius(candidate.distanceKm)
    ))
  };
}

export function recommendationDistanceText(distanceKm) {
  if (distanceKm === null || distanceKm === undefined || distanceKm === '') return '';
  const distance = Number(distanceKm);
  if (!Number.isFinite(distance) || distance < 0) return '';
  if (distance < 0.1) return '< 0.1 km away';
  return `${distance.toFixed(1)} km away`;
}

export function nearbyLocationErrorText(error) {
  switch (error?.code) {
    case 'PERMISSION_DENIED':
      return 'Location permission is off. You can keep browsing all recommendations or allow access and try again.';
    case 'TIMEOUT':
      return 'Getting your location took too long. You can keep browsing all recommendations or try again.';
    case 'UNSUPPORTED':
      return 'This browser cannot provide your location. You can still browse all recommendations.';
    case 'POSITION_UNAVAILABLE':
      return 'Your current location is unavailable. You can keep browsing all recommendations or try again.';
    default:
      return 'Nearby recommendations could not be loaded. Your current recommendations are still available.';
  }
}

export function recommendationReasonText(reason) {
  return typeof reason === 'string' ? reason : reason?.text || '';
}

export function collectSearchRecommendations(result) {
  const seen = new Set();
  return SEARCH_RECOMMENDATION_SECTIONS.flatMap((section) => (result?.[section.source] || []).map((candidate) => ({
    ...candidate,
    sectionKey: section.key,
    sectionLabel: section.label
  }))).filter((candidate) => {
    const sourcePlaceId = candidate.place?.sourcePlaceId?.trim();
    if (!sourcePlaceId || seen.has(sourcePlaceId)) return false;
    seen.add(sourcePlaceId);
    return true;
  });
}

export function filterSearchRecommendations(candidates, { query = '', category = 'all' } = {}) {
  const wanted = query.trim().toLowerCase();
  return candidates.filter((candidate) => {
    const place = candidate.place;
    const categoryMatches = category === 'all' || place?.category === category;
    const textMatches = !wanted || [
      place?.name,
      place?.state,
      ...(candidate.reasons || []).map(recommendationReasonText)
    ]
      .some((value) => String(value || '').toLowerCase().includes(wanted));
    return categoryMatches && textMatches;
  });
}
