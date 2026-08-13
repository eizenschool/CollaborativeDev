import { beforeEach, describe, expect, it } from 'vitest';
import {
  routeChangeRequiresConfirmation,
  validateConfirmedRoute,
  validateRideDraft
} from '../RideService.js';
import { validateRideRequest } from '../RideRequestService.js';
import { validateRideReview } from '../RideReviewService.js';
import {
  departureParts,
  isAtLeastHoursAway,
  klDayRange,
  toDepartureAt
} from '../rideDateTime.js';
import { mockDb } from '../../data-access/mockDataStore.js';
import {
  buildDirectionsEmbedUrl,
  buildGoogleMapsDirectionsUrl,
  buildPlaceEmbedUrl,
  buildViewEmbedUrl
} from '../GoogleMapsEmbedService.js';
import { hasRegisteredVehicle } from '../VehicleService.js';

const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, value),
  removeItem: (key) => memory.delete(key),
  clear: () => memory.clear()
};

describe('Module 2 ride workflow contracts', () => {
  beforeEach(() => memory.clear());

  it('stores Malaysia local schedule as one UTC instant and derives compatible parts', () => {
    const departureAt = toDepartureAt('2026-08-20', '09:30');
    expect(departureAt).toBe('2026-08-20T01:30:00.000Z');
    expect(departureParts(departureAt)).toEqual({ date: '2026-08-20', time: '09:30' });
    expect(klDayRange('2026-08-20')).toEqual({
      start: '2026-08-19T16:00:00.000Z',
      end: '2026-08-20T16:00:00.000Z'
    });
  });

  it('enforces the exact five-hour publication boundary', () => {
    const now = new Date('2026-08-20T00:00:00.000Z');
    expect(isAtLeastHoursAway('2026-08-20T05:00:00.000Z', 5, now)).toBe(true);
    expect(isAtLeastHoursAway('2026-08-20T04:59:59.999Z', 5, now)).toBe(false);
    expect(() => validateRideDraft({
      pickup: 'KL Sentral', destination: 'Ipoh', date: '2026-08-20', time: '12:59',
      journeyScale: 'Intercity', vehicleId: 'v_1', seatsTotal: 2
    }, { publishing: true, now })).toThrow('at least 5 hours');
  });

  it('rejects seat counts above the selected vehicle capacity', () => {
    expect(() => validateRideDraft({
      pickup: 'KL Sentral', destination: 'Ipoh', date: '2026-08-21', time: '09:30',
      journeyScale: 'Intercity', vehicleId: 'v_1', vehicleCapacity: 3, seatsTotal: 4
    })).toThrow('vehicle capacity');
  });

  it('requires confirmed Google route selections for newly saved rides', () => {
    expect(() => validateConfirmedRoute({
      pickupLocation: null,
      destinationLocation: { placeId: 'destination-id' }
    })).toThrow('confirmed pickup');
    expect(() => validateConfirmedRoute({
      pickupLocation: { placeId: 'pickup-id' },
      destinationLocation: null
    })).toThrow('confirmed destination');
    expect(() => validateConfirmedRoute({
      pickupLocation: { latitude: 3.139, longitude: 101.6869 },
      destinationLocation: { placeId: 'destination-id' }
    })).not.toThrow();
  });

  it('limits public pickup instructions to 300 characters', () => {
    expect(() => validateRideDraft({
      pickup: 'KL Sentral', destination: 'Ipoh', date: '2026-08-21', time: '09:30',
      journeyScale: 'Intercity', vehicleId: 'v_1', seatsTotal: 2,
      pickupInstructions: 'x'.repeat(301)
    })).toThrow('300 characters');
  });

  it('requires one companion name for every additional requested seat', () => {
    expect(validateRideRequest({ seatsRequested: 3, companionNames: ['Aina', 'Daniel'] })).toEqual({
      seatsRequested: 3,
      companionNames: ['Aina', 'Daniel']
    });
    expect(() => validateRideRequest({ seatsRequested: 3, companionNames: ['Aina'] })).toThrow('2 companion names');
  });

  it('validates review stars and the 500-character limit', () => {
    expect(validateRideReview({ rating: 5, comment: ' Great ride ' })).toEqual({ rating: 5, comment: 'Great ride' });
    expect(() => validateRideReview({ rating: 0 })).toThrow('1 to 5');
    expect(() => validateRideReview({ rating: 4, comment: 'x'.repeat(501) })).toThrow('500');
  });

  it('builds a Maps Embed directions URL with encoded Malaysia route data', () => {
    const url = new URL(buildDirectionsEmbedUrl({
      pickup: 'KL Sentral, Kuala Lumpur',
      destination: 'George Town, Penang',
      waypoints: [{ name: 'Ipoh Old Town' }, 'Taiping'],
      apiKey: 'test-browser-key'
    }));
    expect(`${url.origin}${url.pathname}`).toBe('https://www.google.com/maps/embed/v1/directions');
    expect(url.searchParams.get('origin')).toBe('KL Sentral, Kuala Lumpur');
    expect(url.searchParams.get('destination')).toBe('George Town, Penang');
    expect(url.searchParams.get('waypoints')).toBe('Ipoh Old Town|Taiping');
    expect(url.searchParams.get('region')).toBe('my');
  });

  it('does not create an Embed request without a restricted key and offers a keyless external route link', () => {
    expect(buildDirectionsEmbedUrl({ pickup: 'KL Sentral', destination: 'Ipoh', apiKey: '' })).toBeNull();
    const external = new URL(buildGoogleMapsDirectionsUrl({ pickup: 'KL Sentral', destination: 'Ipoh' }));
    expect(external.searchParams.get('api')).toBe('1');
    expect(external.searchParams.get('travelmode')).toBe('driving');
  });

  it('prefers Place IDs or device coordinates for route previews', () => {
    const placeRoute = new URL(buildDirectionsEmbedUrl({
      pickup: 'KL Sentral', pickupLocation: { placeId: 'pickup-id' },
      destination: 'Ipoh', destinationLocation: { placeId: 'destination-id' },
      apiKey: 'test-browser-key'
    }));
    expect(placeRoute.searchParams.get('origin')).toBe('place_id:pickup-id');
    expect(placeRoute.searchParams.get('destination')).toBe('place_id:destination-id');

    const gpsRoute = new URL(buildDirectionsEmbedUrl({
      pickup: 'Current location', pickupLocation: { latitude: 3.139, longitude: 101.6869 },
      destination: 'Ipoh', destinationLocation: { placeId: 'destination-id' },
      apiKey: 'test-browser-key'
    }));
    expect(gpsRoute.searchParams.get('origin')).toBe('3.139,101.6869');
  });

  it('builds a free Embed view centred on the one-shot GPS preview', () => {
    const view = new URL(buildViewEmbedUrl({
      location: { latitude: 3.139, longitude: 101.6869 },
      apiKey: 'test-browser-key'
    }));
    expect(`${view.origin}${view.pathname}`).toBe('https://www.google.com/maps/embed/v1/view');
    expect(view.searchParams.get('center')).toBe('3.139,101.6869');
    expect(view.searchParams.get('zoom')).toBe('15');
    expect(buildViewEmbedUrl({ location: { latitude: null, longitude: null }, apiKey: 'test-browser-key' })).toBeNull();
    expect(buildViewEmbedUrl({ location: { latitude: 91, longitude: 101.6869 }, apiKey: 'test-browser-key' })).toBeNull();
  });

  it('builds a Place Embed marker for the Publish Ride current-location preview', () => {
    const marker = new URL(buildPlaceEmbedUrl({
      latitude: 3.139,
      longitude: 101.6869,
      apiKey: 'test-browser-key'
    }));
    expect(`${marker.origin}${marker.pathname}`).toBe('https://www.google.com/maps/embed/v1/place');
    expect(marker.searchParams.get('q')).toBe('3.139,101.6869');
    expect(marker.searchParams.get('zoom')).toBe('16');
  });

  it('allows the Publish Ride flow only when the Host has a registered vehicle', () => {
    expect(hasRegisteredVehicle([])).toBe(false);
    expect(hasRegisteredVehicle(null)).toBe(false);
    expect(hasRegisteredVehicle([{ id: 'vehicle-1' }])).toBe(true);
  });

  it('lazily expires due Published rides and their Pending requests in the mock adapter', async () => {
    await mockDb.processRideLifecycle(new Date('2026-08-16T00:00:00.000Z'));
    const ride = await mockDb.getRide('r_1');
    const requests = await mockDb.listMyRideRequests('u_demo_1');
    expect(ride.status).toBe('Expired');
    expect(requests.find((request) => request.rideId === 'r_1').status).toBe('Expired');
  });

  it('exposes accepted-request edit locks in the mock ride adapter', async () => {
    const ride = await mockDb.getRide('r_5');
    expect(ride.hasAcceptedRequests).toBe(true);
    await expect(mockDb.updateRide('r_5', { pickupInstructions: 'Changed' }))
      .rejects.toThrow('accepted requests');
  });

  it('lets legacy rides edit non-route fields but requires references for route changes', () => {
    const legacy = {
      pickup: 'Legacy pickup', destination: 'Legacy destination',
      pickupLocation: null, destinationLocation: null
    };
    expect(routeChangeRequiresConfirmation(legacy, { pickupInstructions: 'Meet at Gate A' })).toBe(false);
    expect(routeChangeRequiresConfirmation(legacy, { pickup: 'Changed pickup' })).toBe(true);
  });
});
