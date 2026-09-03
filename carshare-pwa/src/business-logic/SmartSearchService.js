import { RideService } from './RideService.js';
import { calculateCompositeHostImpact } from './HostImpactEngine.js';
import { PlaceQueryService } from './discovery/PlaceQueryService.js';
import {
  findMultiLegJourneys,
  isMultiLegSearchEligible,
  sortMultiLegJourneys
} from './MultiLegJourneyEngine.js';
import {
  SPOKEN_LANGUAGE_OPTIONS,
  VEHICLE_TYPE_OPTIONS,
  normalizeSpokenLanguage,
  normalizeVehicleType
} from './CompatibilityOptions.js';

export const SMART_SEARCH_SORTS = Object.freeze({
  DEPARTURE: 'departure',
  HOST_IMPACT: 'impact'
});

export const SEARCH_RESTRICTION_OPTIONS = Object.freeze([
  'Pet-friendly',
  'No smoking',
  'Women-only',
  'Child seat available',
  'Luggage-friendly',
  'Toll contribution',
  'Music OK',
  'Quiet ride'
]);

export const SEARCH_PROXIMITY_RADII = Object.freeze([5, 10, 25]);
export const SEARCH_VEHICLE_TYPE_OPTIONS = VEHICLE_TYPE_OPTIONS;
export const SEARCH_LANGUAGE_OPTIONS = SPOKEN_LANGUAGE_OPTIONS;

const VALID_SCALES = new Set(['', 'Urban', 'Intercity']);
const VALID_SORTS = new Set(Object.values(SMART_SEARCH_SORTS));
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function numberOr(value, fallback) {
  if (value === '' || value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function localDateParts(instant = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(instant);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function rideDepartureValue(ride) {
  if (ride.departureAt) return new Date(ride.departureAt).getTime();
  if (ride.date && ride.time) return new Date(`${ride.date}T${ride.time}:00+08:00`).getTime();
  return Number.POSITIVE_INFINITY;
}

function toPublicSearchRide(ride) {
  const {
    pickupLocation,
    destinationLocation,
    pickupInstructions,
    waypoints,
    ...safeRide
  } = ride;
  return { ...safeRide, journeyType: 'direct' };
}

export function normalizeSmartSearchCriteria(criteria = {}) {
  const tags = Array.isArray(criteria.tags)
    ? [...new Set(criteria.tags.map(text).filter(Boolean))]
    : [];
  const journeyScale = text(criteria.journeyScale || criteria.scale);
  const sort = text(criteria.sort) || SMART_SEARCH_SORTS.DEPARTURE;
  const pickup = text(criteria.pickup || criteria.from);
  const destination = text(criteria.destination || criteria.to);
  const destinationPlaceId = text(criteria.destinationPlaceId);
  const pickupPlaceId = pickup ? text(criteria.pickupPlaceId) : '';
  const destinationSearchPlaceId = destination && !destinationPlaceId
    ? text(criteria.destinationSearchPlaceId)
    : '';
  const requestedProximity = numberOr(criteria.proximityKm, 10);
  const proximityKm = destinationPlaceId
    ? (SEARCH_PROXIMITY_RADII.includes(requestedProximity) ? requestedProximity : 10)
    : 0;

  return {
    pickup,
    pickupPlaceId,
    destination,
    destinationSearchPlaceId,
    destinationPlaceId,
    proximityKm,
    date: text(criteria.date),
    departAfter: text(criteria.departAfter),
    journeyScale: VALID_SCALES.has(journeyScale) ? journeyScale : '',
    minSeats: Math.trunc(numberOr(criteria.minSeats, 1)),
    tags,
    contribution: text(criteria.contribution),
    minRating: numberOr(criteria.minRating, 0),
    vehicleType: normalizeVehicleType(criteria.vehicleType),
    language: normalizeSpokenLanguage(criteria.language),
    sort: VALID_SORTS.has(sort) ? sort : SMART_SEARCH_SORTS.DEPARTURE
  };
}

export function applyManualDestinationText(criteria, destination, destinationSearchPlaceId = '') {
  return {
    ...criteria,
    destination,
    destinationSearchPlaceId,
    destinationPlaceId: '',
    proximityKm: 0
  };
}

export function expandProximityCriteria(criteria) {
  const normalized = normalizeSmartSearchCriteria(criteria);
  const currentIndex = SEARCH_PROXIMITY_RADII.indexOf(normalized.proximityKm);
  const nextRadius = SEARCH_PROXIMITY_RADII[currentIndex + 1];
  return normalizeSmartSearchCriteria(nextRadius
    ? { ...normalized, proximityKm: nextRadius }
    : {
        ...normalized,
        destinationSearchPlaceId: normalized.destinationPlaceId,
        destinationPlaceId: '',
        proximityKm: 0
      });
}

export function validateSmartSearchCriteria(criteria, { now = new Date() } = {}) {
  const normalized = normalizeSmartSearchCriteria(criteria);
  if (normalized.pickup && !normalized.pickupPlaceId) {
    throw new Error('Choose a pickup from the Google suggestions.');
  }
  if (normalized.destination && !normalized.destinationSearchPlaceId && !normalized.destinationPlaceId) {
    throw new Error('Choose a destination from the Google suggestions.');
  }
  if (normalized.date && !/^\d{4}-\d{2}-\d{2}$/.test(normalized.date)) {
    throw new Error('Enter a valid travel date.');
  }
  if (normalized.date && normalized.date < localDateParts(now)) {
    throw new Error('Travel date cannot be in the past.');
  }
  if (normalized.departAfter && !TIME_PATTERN.test(normalized.departAfter)) {
    throw new Error('Enter a valid departure time.');
  }
  if (!Number.isInteger(normalized.minSeats) || normalized.minSeats < 1 || normalized.minSeats > 8) {
    throw new Error('Seats must be between 1 and 8.');
  }
  if (normalized.minRating < 0 || normalized.minRating > 5) {
    throw new Error('Host rating must be between 0 and 5.');
  }
  return normalized;
}

export function filterAndSortRides(rides = [], criteria = {}) {
  const normalized = normalizeSmartSearchCriteria(criteria);
  const pickup = normalized.pickup.toLowerCase();
  const destination = normalized.destination.toLowerCase();
  const contribution = normalized.contribution.toLowerCase();

  return rides
    .filter((ride) => ride.status === 'Published' && Number(ride.seatsAvailable) > 0)
    .filter((ride) => normalized.pickupPlaceId || !pickup || ride.pickup?.toLowerCase().includes(pickup))
    .filter((ride) => normalized.destinationPlaceId
      || normalized.destinationSearchPlaceId
      || !destination
      || ride.destination?.toLowerCase().includes(destination))
    .filter((ride) => !normalized.date || ride.date === normalized.date)
    .filter((ride) => !normalized.departAfter || (ride.time || '') >= normalized.departAfter)
    .filter((ride) => !normalized.journeyScale || ride.journeyScale === normalized.journeyScale)
    .filter((ride) => Number(ride.seatsAvailable) >= normalized.minSeats)
    .filter((ride) => normalized.tags.every((tag) => ride.restrictionTags?.includes(tag)))
    .filter((ride) => !contribution || (ride.contribution || '').toLowerCase().includes(contribution))
    .filter((ride) => normalized.minRating === 0 || Number(ride.host?.rating || 0) >= normalized.minRating)
    .filter((ride) => !normalized.vehicleType || ride.vehicleType === normalized.vehicleType)
    .filter((ride) => !normalized.language || ride.host?.spokenLanguages?.includes(normalized.language))
    .sort((left, right) => {
      if (normalized.sort === SMART_SEARCH_SORTS.HOST_IMPACT) {
        const scoreDifference = calculateCompositeHostImpact(right.host) - calculateCompositeHostImpact(left.host);
        if (scoreDifference !== 0) return scoreDifference;
      }
      return rideDepartureValue(left) - rideDepartureValue(right);
    });
}

export function smartSearchCriteriaFromParams(input) {
  const params = input instanceof URLSearchParams ? input : new URLSearchParams(input || '');
  return normalizeSmartSearchCriteria({
    pickup: params.get('pickup'),
    pickupPlaceId: params.get('pickupPlaceId'),
    destination: params.get('destination'),
    destinationSearchPlaceId: params.get('destinationSearchPlaceId'),
    destinationPlaceId: params.get('destinationPlaceId'),
    proximityKm: params.get('proximityKm'),
    date: params.get('date'),
    departAfter: params.get('departAfter'),
    journeyScale: params.get('scale'),
    minSeats: params.get('minSeats'),
    tags: params.getAll('tag'),
    contribution: params.get('contribution'),
    minRating: params.get('minRating'),
    vehicleType: params.get('vehicleType'),
    language: params.get('language'),
    sort: params.get('sort')
  });
}

export function smartSearchCriteriaToParams(criteria) {
  const normalized = normalizeSmartSearchCriteria(criteria);
  const params = new URLSearchParams();
  if (normalized.pickup) params.set('pickup', normalized.pickup);
  if (normalized.pickupPlaceId) params.set('pickupPlaceId', normalized.pickupPlaceId);
  if (normalized.destination) params.set('destination', normalized.destination);
  if (normalized.destinationSearchPlaceId) params.set('destinationSearchPlaceId', normalized.destinationSearchPlaceId);
  if (normalized.destinationPlaceId) params.set('destinationPlaceId', normalized.destinationPlaceId);
  if (normalized.proximityKm) params.set('proximityKm', String(normalized.proximityKm));
  if (normalized.date) params.set('date', normalized.date);
  if (normalized.departAfter) params.set('departAfter', normalized.departAfter);
  if (normalized.journeyScale) params.set('scale', normalized.journeyScale);
  if (normalized.minSeats > 1) params.set('minSeats', String(normalized.minSeats));
  normalized.tags.forEach((tag) => params.append('tag', tag));
  if (normalized.contribution) params.set('contribution', normalized.contribution);
  if (normalized.minRating > 0) params.set('minRating', String(normalized.minRating));
  if (normalized.vehicleType) params.set('vehicleType', normalized.vehicleType);
  if (normalized.language) params.set('language', normalized.language);
  if (normalized.sort !== SMART_SEARCH_SORTS.DEPARTURE) params.set('sort', normalized.sort);
  return params;
}

export function legacyRideSearchUrlFromParams(input) {
  const params = input instanceof URLSearchParams ? input : new URLSearchParams(input || '');
  const hasLegacyCriteria = ['from', 'to', 'date'].some((key) => params.has(key));
  if (!hasLegacyCriteria) return null;

  const canonical = smartSearchCriteriaToParams({
    pickup: params.get('from'),
    destination: params.get('to'),
    date: params.get('date')
  });
  return `/search${canonical.toString() ? `?${canonical}` : ''}`;
}

export function buildSimilarSearchCriteria(ride, { now = new Date() } = {}) {
  const dateIsUsable = ride?.date && ride.date >= localDateParts(now);
  return normalizeSmartSearchCriteria({
    pickup: ride?.pickup,
    destination: ride?.destination,
    journeyScale: ride?.journeyScale,
    date: dateIsUsable ? ride.date : '',
    departAfter: dateIsUsable ? ride.time : ''
  });
}

export const SmartSearchService = {
  async search(criteria = {}) {
    const normalized = validateSmartSearchCriteria(criteria);
    let proximity = null;
    let proximityCentre = null;

    if (normalized.destinationPlaceId) {
      proximityCentre = await PlaceQueryService.getPlaceBySourcePlaceId(normalized.destinationPlaceId);
      if (!proximityCentre) {
        throw new Error('This recommended destination is no longer available. Choose another place.');
      }
      proximity = {
        destinationPlaceId: normalized.destinationPlaceId,
        radiusKm: normalized.proximityKm
      };
    }

    let candidates = await RideService.searchRides({
      from: normalized.pickup,
      to: proximity ? '' : normalized.destination,
      date: normalized.date,
      proximity,
      confirmedLocations: normalized.pickupPlaceId || normalized.destinationSearchPlaceId
        ? {
            pickupPlaceId: normalized.pickupPlaceId,
            destinationPlaceId: normalized.destinationSearchPlaceId
          }
        : null,
      compatibility: normalized.vehicleType || normalized.language
        ? { vehicleType: normalized.vehicleType, language: normalized.language }
        : null
    });

    if (RideService.backend === 'mock') {
      candidates = candidates.filter((ride) => {
        const pickupId = ride.pickupLocation?.placeId || ride.pickupPlaceId || ride.pickup_place_id || '';
        const destinationId = ride.destinationLocation?.placeId || ride.destinationPlaceId || ride.destination_place_id || '';
        const pickupMatches = !normalized.pickupPlaceId
          || pickupId === normalized.pickupPlaceId
          || (!pickupId && ride.pickup?.toLowerCase().includes(normalized.pickup.toLowerCase()));
        const destinationMatches = proximity
          || !normalized.destinationSearchPlaceId
          || destinationId === normalized.destinationSearchPlaceId
          || (!destinationId && ride.destination?.toLowerCase().includes(normalized.destination.toLowerCase()));
        return pickupMatches && destinationMatches;
      });
    }

    let distanceByPlaceId = new Map();
    let directCandidates = candidates;
    if (proximity && RideService.backend === 'mock') {
      const nearbyPlaces = await PlaceQueryService.queryPlacesNearPoint({
        lat: proximityCentre.lat,
        lng: proximityCentre.lng,
        radiusKm: proximity.radiusKm
      });
      distanceByPlaceId = new Map(nearbyPlaces.map((place) => [place.sourcePlaceId, place.distanceKm]));
      directCandidates = candidates
        .filter((ride) => distanceByPlaceId.has(ride.destinationLocation?.placeId))
        .map((ride) => ({
          ...ride,
          proximityDistanceKm: distanceByPlaceId.get(ride.destinationLocation.placeId)
        }));
    }

    const directResults = filterAndSortRides(directCandidates, normalized).map(toPublicSearchRide);
    if (directResults.length || !isMultiLegSearchEligible(normalized)) return directResults;

    if (RideService.backend !== 'mock') {
      if (typeof RideService.searchMultiLegRides !== 'function') return [];
      return sortMultiLegJourneys(await RideService.searchMultiLegRides(normalized), normalized.sort);
    }

    const [allRides, transferPoints] = await Promise.all([
      RideService.searchRides(),
      PlaceQueryService.getTransferPoints()
    ]);
    return findMultiLegJourneys({
      rides: allRides,
      transferPoints,
      destinationDistances: distanceByPlaceId,
      criteria: normalized
    });
  }
};
