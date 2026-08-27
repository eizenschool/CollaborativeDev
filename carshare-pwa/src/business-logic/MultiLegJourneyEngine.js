import { calculateCompositeHostImpact } from './HostImpactEngine.js'

const MALAYSIA_TIME_ZONE = 'Asia/Kuala_Lumpur'
export const INTERCITY_MIN_TRANSFER_MINUTES = 180

function departureParts(value) {
  if (!value) return { date: '', time: '' }
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: MALAYSIA_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(value)).map((part) => [part.type, part.value]))
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` }
}

function instant(value) {
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

function lower(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function confirmedPlaceId(ride, endpoint) {
  return ride?.[`${endpoint}Location`]?.placeId
    || ride?.[`${endpoint}PlaceId`]
    || ride?.[`${endpoint}_place_id`]
    || ''
}

function commonRideMatches(ride, criteria) {
  const contribution = lower(criteria.contribution)
  return ride?.status === 'Published'
    && Number(ride.seatsAvailable) >= criteria.minSeats
    && (!criteria.journeyScale || ride.journeyScale === criteria.journeyScale)
    && (criteria.tags || []).every((tag) => ride.restrictionTags?.includes(tag))
    && (!contribution || lower(ride.contribution).includes(contribution))
    && (!criteria.minRating || Number(ride.host?.rating || 0) >= criteria.minRating)
    && (!criteria.vehicleType || ride.vehicleType === criteria.vehicleType)
    && (!criteria.language || ride.host?.spokenLanguages?.includes(criteria.language))
}

function safeLeg(ride) {
  const {
    pickupLocation,
    destinationLocation,
    pickupInstructions,
    waypoints,
    destinationPhotoPlaceId,
    ...safeRide
  } = ride
  return { ...safeRide, journeyType: 'direct' }
}

function journeyImpact(journey) {
  if (!journey.legs?.length) return 0
  return journey.legs.reduce((sum, leg) => sum + calculateCompositeHostImpact(leg.host), 0)
    / journey.legs.length
}

export function isMultiLegSearchEligible(criteria = {}) {
  return Boolean(lower(criteria.pickup) && (lower(criteria.destination) || lower(criteria.destinationPlaceId)))
}

export function sortMultiLegJourneys(journeys, sort = 'departure') {
  return [...journeys].sort((left, right) => {
    if (sort === 'impact') {
      const impactDifference = journeyImpact(right) - journeyImpact(left)
      if (impactDifference !== 0) return impactDifference
    }
    const departureDifference = instant(left.departureAt) - instant(right.departureAt)
    return departureDifference || left.id.localeCompare(right.id)
  })
}

export function findMultiLegJourneys({
  rides = [],
  transferPoints = [],
  destinationDistances = new Map(),
  criteria = {}
} = {}) {
  if (!isMultiLegSearchEligible(criteria)) return []

  const transferBySourceId = new Map(transferPoints
    .filter((place) => place?.sourcePlaceId && (
      place.category === 'heritage'
      || /(?:^|\b)(?:r\s*&\s*r|rest\s+(?:area|stop)|hentian)(?:\b|$)/i.test(place.name || '')
    ))
    .map((place) => [place.sourcePlaceId, place]))
  const pickup = lower(criteria.pickup)
  const destination = lower(criteria.destination)
  const candidates = rides.filter((ride) => commonRideMatches(ride, criteria))
  const results = []

  for (const first of candidates) {
    const firstParts = departureParts(first.departureAt)
    if (!lower(first.pickup).includes(pickup)) continue
    if (criteria.date && firstParts.date !== criteria.date) continue
    if (criteria.departAfter && firstParts.time < criteria.departAfter) continue

    const transferId = confirmedPlaceId(first, 'destination')
    const transfer = transferBySourceId.get(transferId)
    if (!transfer || !Number.isFinite(instant(first.estimatedArrivalAt))) continue

    for (const second of candidates) {
      if (second.id === first.id || confirmedPlaceId(second, 'pickup') !== transferId) continue
      if (!Number.isFinite(instant(second.estimatedArrivalAt))) continue

      const destinationId = confirmedPlaceId(second, 'destination')
      const proximityDistanceKm = destinationDistances.get(destinationId)
      if (criteria.destinationPlaceId) {
        if (!Number.isFinite(Number(proximityDistanceKm))) continue
      } else if (destination && !lower(second.destination).includes(destination)) {
        continue
      }

      const waitMinutes = Math.round((instant(second.departureAt) - instant(first.estimatedArrivalAt)) / 60000)
      const isIntercity = first.journeyScale === 'Intercity' || second.journeyScale === 'Intercity'
      if (waitMinutes < (isIntercity ? INTERCITY_MIN_TRANSFER_MINUTES : 0)) continue

      results.push({
        id: `multileg:${first.id}:${second.id}`,
        journeyType: 'multi-leg',
        pickup: first.pickup,
        destination: second.destination,
        departureAt: first.departureAt,
        estimatedArrivalAt: second.estimatedArrivalAt,
        journeyScale: isIntercity ? 'Intercity' : 'Urban',
        seatsAvailable: Math.min(Number(first.seatsAvailable), Number(second.seatsAvailable)),
        transferPoint: { name: transfer.name, category: transfer.category },
        waitMinutes,
        proximityDistanceKm: Number.isFinite(Number(proximityDistanceKm)) ? Number(proximityDistanceKm) : null,
        legs: [safeLeg(first), safeLeg(second)]
      })
    }
  }

  return sortMultiLegJourneys(results, criteria.sort)
}
