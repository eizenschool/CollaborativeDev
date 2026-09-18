import { describe, expect, it } from 'vitest'
import {
  INTERCITY_MIN_TRANSFER_MINUTES,
  findMultiLegJourneys,
  isMultiLegSearchEligible
} from '../MultiLegJourneyEngine.js'

const host = (score = 1, overrides = {}) => ({
  completedTrips: score,
  co2SavedKg: score,
  reputationScore: score,
  rating: 4.8,
  spokenLanguages: ['english'],
  ...overrides
})

const ride = (id, overrides = {}) => ({
  id,
  pickup: 'KL Sentral',
  destination: 'Transfer Point',
  pickupLocation: { placeId: `pickup-${id}` },
  destinationLocation: { placeId: 'transfer-heritage' },
  departureAt: '2026-09-10T00:00:00.000Z',
  estimatedArrivalAt: '2026-09-10T02:00:00.000Z',
  journeyScale: 'Urban',
  seatsAvailable: 3,
  contribution: 'Share toll',
  restrictionTags: ['No smoking'],
  vehicleType: 'suv',
  status: 'Published',
  host: host(),
  pickupInstructions: 'Private detail',
  waypoints: [{ placeId: 'private-waypoint' }],
  ...overrides
})

const transferPoints = [
  { sourcePlaceId: 'transfer-heritage', name: 'Old Town Museum', category: 'heritage' },
  { sourcePlaceId: 'transfer-nature', name: 'Nature Park', category: 'nature' },
  { sourcePlaceId: 'transfer-rest', name: 'Seremban R&R', category: 'culinary' }
]

const criteria = {
  pickup: 'KL', destination: 'Ipoh', destinationPlaceId: '',
  date: '2026-09-10', departAfter: '07:30', journeyScale: '',
  minSeats: 2, tags: ['No smoking'], contribution: 'toll', minRating: 4.5,
  vehicleType: 'suv', language: 'english', sort: 'departure'
}

describe('Module 4 multi-leg journey engine', () => {
  it('requires an origin and an exact or recommended destination', () => {
    expect(isMultiLegSearchEligible({ pickup: 'KL', destination: 'Ipoh' })).toBe(true)
    expect(isMultiLegSearchEligible({ pickup: 'KL', destinationPlaceId: 'place' })).toBe(true)
    expect(isMultiLegSearchEligible({ destination: 'Ipoh' })).toBe(false)
  })

  it('matches two urban rides through an approved cultural transfer point', () => {
    const first = ride('first')
    const second = ride('second', {
      pickup: 'Old Town Museum',
      pickupLocation: { placeId: 'transfer-heritage' },
      destination: 'Ipoh Station',
      destinationLocation: { placeId: 'ipoh' },
      departureAt: '2026-09-10T02:30:00.000Z',
      estimatedArrivalAt: '2026-09-10T04:00:00.000Z'
    })

    const [journey] = findMultiLegJourneys({ rides: [first, second], transferPoints, criteria })

    expect(journey).toMatchObject({
      id: 'multileg:first:second', journeyType: 'multi-leg', waitMinutes: 30,
      transferPoint: { name: 'Old Town Museum', category: 'heritage' },
      seatsAvailable: 3, estimatedArrivalAt: second.estimatedArrivalAt
    })
    expect(journey.legs).toHaveLength(2)
    expect(journey.legs[0]).not.toHaveProperty('pickupLocation')
    expect(journey.legs[0]).not.toHaveProperty('pickupInstructions')
    expect(journey.legs[0]).not.toHaveProperty('waypoints')
  })

  it('requires a three-hour transfer when either leg is intercity', () => {
    const first = ride('first', { journeyScale: 'Intercity' })
    const tooSoon = ride('soon', {
      pickupLocation: { placeId: 'transfer-heritage' }, destination: 'Ipoh',
      departureAt: '2026-09-10T04:59:00.000Z', estimatedArrivalAt: '2026-09-10T06:00:00.000Z',
      journeyScale: 'Intercity'
    })
    const boundary = ride('boundary', {
      pickupLocation: { placeId: 'transfer-heritage' }, destination: 'Ipoh',
      departureAt: '2026-09-10T05:00:00.000Z', estimatedArrivalAt: '2026-09-10T06:30:00.000Z',
      journeyScale: 'Intercity'
    })

    const results = findMultiLegJourneys({ rides: [first, tooSoon, boundary], transferPoints, criteria: { ...criteria, journeyScale: 'Intercity' } })
    expect(INTERCITY_MIN_TRANSFER_MINUTES).toBe(180)
    expect(results.map((item) => item.id)).toEqual(['multileg:first:boundary'])
  })

  it('accepts a catalogue rest stop but rejects an unapproved transfer category', () => {
    const firstRest = ride('first-rest', { destinationLocation: { placeId: 'transfer-rest' } })
    const secondRest = ride('second-rest', {
      pickupLocation: { placeId: 'transfer-rest' }, destination: 'Ipoh',
      departureAt: '2026-09-10T02:30:00.000Z', estimatedArrivalAt: '2026-09-10T04:00:00.000Z'
    })
    const firstNature = ride('first-nature', { destinationLocation: { placeId: 'transfer-nature' } })
    const secondNature = ride('second-nature', {
      pickupLocation: { placeId: 'transfer-nature' }, destination: 'Ipoh',
      departureAt: '2026-09-10T02:30:00.000Z', estimatedArrivalAt: '2026-09-10T04:00:00.000Z'
    })

    const results = findMultiLegJourneys({ rides: [firstRest, secondRest, firstNature, secondNature], transferPoints, criteria })
    expect(results.map((item) => item.id)).toEqual(['multileg:first-rest:second-rest'])
  })

  it('applies compatibility and all existing filters to both legs', () => {
    const first = ride('first')
    const second = ride('second', {
      pickupLocation: { placeId: 'transfer-heritage' }, destination: 'Ipoh',
      departureAt: '2026-09-10T02:30:00.000Z', estimatedArrivalAt: '2026-09-10T04:00:00.000Z'
    })
    const checks = [
      { seatsAvailable: 1 }, { restrictionTags: [] }, { contribution: 'Cash only' },
      { vehicleType: 'sedan' }, { host: host(1, { rating: 4, spokenLanguages: ['tamil'] }) },
      { status: 'Matched' }
    ]

    for (const failedPatch of checks) {
      expect(findMultiLegJourneys({ rides: [first, { ...second, ...failedPatch }], transferPoints, criteria })).toEqual([])
    }
  })

  it('matches the final leg against a proximity set and sorts deterministically', () => {
    const first = ride('first', { host: host(20) })
    const high = ride('high', {
      pickupLocation: { placeId: 'transfer-heritage' }, destination: 'Nearby A', destinationLocation: { placeId: 'near-a' },
      departureAt: '2026-09-10T03:00:00.000Z', estimatedArrivalAt: '2026-09-10T04:00:00.000Z', host: host(50)
    })
    const low = ride('low', {
      pickupLocation: { placeId: 'transfer-heritage' }, destination: 'Nearby B', destinationLocation: { placeId: 'near-b' },
      departureAt: '2026-09-10T02:30:00.000Z', estimatedArrivalAt: '2026-09-10T04:30:00.000Z', host: host(1)
    })
    const destinationDistances = new Map([['near-a', 3.2], ['near-b', 4.9]])
    const results = findMultiLegJourneys({
      rides: [first, low, high], transferPoints, destinationDistances,
      criteria: { ...criteria, destination: 'Recommended place', destinationPlaceId: 'centre', sort: 'impact' }
    })

    expect(results.map((item) => item.id)).toEqual(['multileg:first:high', 'multileg:first:low'])
    expect(results[0].proximityDistanceKm).toBe(3.2)
  })
})
