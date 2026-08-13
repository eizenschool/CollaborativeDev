import { RideService } from './RideService.js';
import { calculateCompositeHostImpact } from './HostImpactEngine.js';

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

export function normalizeSmartSearchCriteria(criteria = {}) {
  const tags = Array.isArray(criteria.tags)
    ? [...new Set(criteria.tags.map(text).filter(Boolean))]
    : [];
  const journeyScale = text(criteria.journeyScale || criteria.scale);
  const sort = text(criteria.sort) || SMART_SEARCH_SORTS.DEPARTURE;

  return {
    pickup: text(criteria.pickup || criteria.from),
    destination: text(criteria.destination || criteria.to),
    destinationPlaceId: text(criteria.destinationPlaceId),
    date: text(criteria.date),
    departAfter: text(criteria.departAfter),
    journeyScale: VALID_SCALES.has(journeyScale) ? journeyScale : '',
    minSeats: Math.trunc(numberOr(criteria.minSeats, 1)),
    tags,
    contribution: text(criteria.contribution),
    minRating: numberOr(criteria.minRating, 0),
    sort: VALID_SORTS.has(sort) ? sort : SMART_SEARCH_SORTS.DEPARTURE
  };
}

export function validateSmartSearchCriteria(criteria, { now = new Date() } = {}) {
  const normalized = normalizeSmartSearchCriteria(criteria);
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
    .filter((ride) => !pickup || ride.pickup?.toLowerCase().includes(pickup))
    .filter((ride) => !destination || ride.destination?.toLowerCase().includes(destination))
    .filter((ride) => !normalized.date || ride.date === normalized.date)
    .filter((ride) => !normalized.departAfter || (ride.time || '') >= normalized.departAfter)
    .filter((ride) => !normalized.journeyScale || ride.journeyScale === normalized.journeyScale)
    .filter((ride) => Number(ride.seatsAvailable) >= normalized.minSeats)
    .filter((ride) => normalized.tags.every((tag) => ride.restrictionTags?.includes(tag)))
    .filter((ride) => !contribution || (ride.contribution || '').toLowerCase().includes(contribution))
    .filter((ride) => normalized.minRating === 0 || Number(ride.host?.rating || 0) >= normalized.minRating)
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
    destination: params.get('destination'),
    destinationPlaceId: params.get('destinationPlaceId'),
    date: params.get('date'),
    departAfter: params.get('departAfter'),
    journeyScale: params.get('scale'),
    minSeats: params.get('minSeats'),
    tags: params.getAll('tag'),
    contribution: params.get('contribution'),
    minRating: params.get('minRating'),
    sort: params.get('sort')
  });
}

export function smartSearchCriteriaToParams(criteria) {
  const normalized = normalizeSmartSearchCriteria(criteria);
  const params = new URLSearchParams();
  if (normalized.pickup) params.set('pickup', normalized.pickup);
  if (normalized.destination) params.set('destination', normalized.destination);
  if (normalized.destinationPlaceId) params.set('destinationPlaceId', normalized.destinationPlaceId);
  if (normalized.date) params.set('date', normalized.date);
  if (normalized.departAfter) params.set('departAfter', normalized.departAfter);
  if (normalized.journeyScale) params.set('scale', normalized.journeyScale);
  if (normalized.minSeats > 1) params.set('minSeats', String(normalized.minSeats));
  normalized.tags.forEach((tag) => params.append('tag', tag));
  if (normalized.contribution) params.set('contribution', normalized.contribution);
  if (normalized.minRating > 0) params.set('minRating', String(normalized.minRating));
  if (normalized.sort !== SMART_SEARCH_SORTS.DEPARTURE) params.set('sort', normalized.sort);
  return params;
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
    const candidates = await RideService.searchRides({
      from: normalized.pickup,
      to: normalized.destination,
      date: normalized.date
    });
    return filterAndSortRides(candidates, normalized);
  }
};
