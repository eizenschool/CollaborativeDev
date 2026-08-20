import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isRouteQuoteFresh,
  routeChangeRequiresConfirmation,
  validateConfirmedRoute,
  validateConfirmedWaypoints,
  validateRideDraft
} from '../RideService.js';
import { validateRideRequest } from '../RideRequestService.js';
import { validateRideReview } from '../RideReviewService.js';
import {
  departureParts,
  formatMalaysiaDeparture,
  isAtLeastHoursAway,
  klDayRange,
  rideIntervalsOverlap,
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
import { canNavigateToPublishStep, getPublishStepError } from '../../presentation/components/ride/publishRideSteps.js';

const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, value),
  removeItem: (key) => memory.delete(key),
  clear: () => memory.clear()
};

describe('Module 2 ride workflow contracts', () => {
  beforeEach(() => {
    memory.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-08-14T00:00:00.000Z'));
  });

  afterEach(() => vi.useRealTimers());

  it('stores Malaysia local schedule as one UTC instant and derives compatible parts', () => {
    const departureAt = toDepartureAt('2026-08-20', '09:30');
    expect(departureAt).toBe('2026-08-20T01:30:00.000Z');
    expect(departureParts(departureAt)).toEqual({ date: '2026-08-20', time: '09:30' });
    expect(klDayRange('2026-08-20')).toEqual({
      start: '2026-08-19T16:00:00.000Z',
      end: '2026-08-20T16:00:00.000Z'
    });
  });

  it('enforces the exact one-hour publication boundary', () => {
    const now = new Date('2026-08-20T00:00:00.000Z');
    expect(isAtLeastHoursAway('2026-08-20T01:00:00.000Z', 1, now)).toBe(true);
    expect(isAtLeastHoursAway('2026-08-20T00:59:59.999Z', 1, now)).toBe(false);
    expect(() => validateRideDraft({
      pickup: 'KL Sentral', destination: 'Ipoh', departureAt: '2026-08-20T00:59:59.999Z',
      journeyScale: 'Intercity', vehicleId: 'v_1', seatsTotal: 2
    }, { publishing: true, now })).toThrow('at least 1 hour');
  });

  it('explains an invalid schedule with an unambiguous Malaysia AM/PM time', () => {
    const form = { date: '2026-08-14', time: '02:33' };
    const now = new Date('2026-08-14T01:37:00.000Z');
    expect(formatMalaysiaDeparture(form.date, form.time)).toContain('2:33 am');
    expect(getPublishStepError(form, 1, { now })).toMatch(/2:33 am.*Malaysia time.*at least 1 hour/i);
  });

  it('requires ordered confirmed waypoints with bounded stop time', () => {
    expect(validateConfirmedWaypoints([
      { name: 'Tapah', placeId: 'tapah-place', stopMinutes: 10 },
      { name: 'Gopeng', placeId: 'gopeng-place', stopMinutes: 25 }
    ])).toMatchObject([
      { name: 'Tapah', placeId: 'tapah-place', order: 0, stopMinutes: 10 },
      { name: 'Gopeng', placeId: 'gopeng-place', order: 1, stopMinutes: 25 }
    ]);
    expect(() => validateConfirmedWaypoints([{ name: 'Legacy stop', stopMinutes: 5 }])).toThrow('Google suggestions');
    expect(() => validateConfirmedWaypoints([{ name: 'Long stop', placeId: 'long-stop', stopMinutes: 181 }])).toThrow('0 and 180');
  });

  it('unlocks publish steps sequentially and relocks them when prior data becomes invalid', () => {
    const complete = {
      pickupLocation: { placeId: 'pickup-place' },
      destinationLocation: { placeId: 'destination-place' },
      date: '2026-08-20',
      time: '09:30',
      vehicleId: 'vehicle-1'
    };
    const now = new Date('2026-08-14T00:00:00.000Z');
    expect(canNavigateToPublishStep({ targetStep: 1, currentStep: 0, furthestStep: 0, form: complete, now })).toBe(false);
    expect(canNavigateToPublishStep({ targetStep: 1, currentStep: 0, furthestStep: 1, form: complete, now })).toBe(true);
    expect(canNavigateToPublishStep({ targetStep: 4, currentStep: 0, furthestStep: 4, form: complete, now })).toBe(true);

    const invalidRoute = { ...complete, destinationLocation: null };
    expect(getPublishStepError(invalidRoute, 0)).toContain('confirmed Google location');
    expect(canNavigateToPublishStep({ targetStep: 1, currentStep: 0, furthestStep: 4, form: invalidRoute, now })).toBe(false);
    expect(canNavigateToPublishStep({ targetStep: 4, currentStep: 0, furthestStep: 4, form: invalidRoute, now })).toBe(false);
  });

  it('keeps the demo Host ride linked to a selectable vehicle', async () => {
    expect((await mockDb.getRide('r_5')).vehicleId).toBe('v_1');
    expect((await mockDb.listVehicles('u_demo_1')).some((vehicle) => vehicle.id === 'v_1')).toBe(true);
  });

  it('treats a route quote as stale at its exact expiry', () => {
    const quote = { token: 'opaque', expiresAt: '2026-08-20T00:05:00.000Z' };
    expect(isRouteQuoteFresh(quote, new Date('2026-08-20T00:04:59.999Z'))).toBe(true);
    expect(isRouteQuoteFresh(quote, new Date('2026-08-20T00:05:00.000Z'))).toBe(false);
  });

  it('saves, restores, updates, and publishes a Draft only with a fresh route quote', async () => {
    const draft = await mockDb.createRide('u_demo_1', {
      pickup: 'KL Sentral', destination: 'Ipoh', departureAt: '2026-08-25T01:00:00.000Z',
      date: '2026-08-25', time: '09:00', journeyScale: 'Intercity', vehicleId: 'v_1',
      seatsTotal: 2, pickupLocation: { placeId: 'pickup-id' }, destinationLocation: { placeId: 'destination-id' }
    }, 'Draft');
    expect((await mockDb.getRide(draft.id)).status).toBe('Draft');

    const updated = await mockDb.updateRide(draft.id, { contribution: 'Share tolls' });
    expect(updated.contribution).toBe('Share tolls');
    await expect(mockDb.publishDraft(draft.id, {
      estimatedArrivalAt: '2026-08-25T03:00:00.000Z', expiresAt: '2026-08-14T00:00:00.000Z'
    })).rejects.toThrow('fresh route');

    const stored = JSON.parse(memory.get('letstumpang_mock_db_v1'));
    stored.rides.r_5.estimatedArrivalAt = '2026-08-20T03:00:00.000Z';
    stored.rides.r_5.scheduleBufferUntil = '2026-08-20T03:30:00.000Z';
    memory.set('letstumpang_mock_db_v1', JSON.stringify(stored));
    const published = await mockDb.publishDraft(draft.id, {
      distanceMeters: 200000, routeDurationSeconds: 7200, stopoverSeconds: 0,
      estimatedArrivalAt: '2026-08-25T03:00:00.000Z', expiresAt: '2026-08-14T00:10:00.000Z',
      pickupAnchor: { latitude: 3.134, longitude: 101.686 },
      destinationAnchor: { latitude: 4.597, longitude: 101.09 }
    });
    expect(published.status).toBe('Published');
    expect(published.estimatedArrivalAt).toBe('2026-08-25T03:00:00.000Z');
  });

  it('deletes an owned Draft and rejects another account', async () => {
    const details = {
      pickup: 'KL Sentral', destination: 'Seremban', departureAt: '2026-08-26T01:00:00.000Z',
      date: '2026-08-26', time: '09:00', journeyScale: 'Intercity', vehicleId: 'v_1', seatsTotal: 2
    };
    const deletable = await mockDb.createRide('u_demo_1', details, 'Draft');
    await expect(mockDb.deleteDraft(deletable.id)).resolves.toBe(true);
    expect(await mockDb.getRide(deletable.id)).toBeNull();

    const protectedDraft = await mockDb.createRide('u_demo_1', details, 'Draft');
    await mockDb.signIn({ email: 'test@example.com' });
    await expect(mockDb.deleteDraft(protectedDraft.id)).rejects.toThrow('Only your Draft');
  });

  it('uses half-open occupied intervals for equal times, overlaps, and the buffer boundary', () => {
    const firstStart = '2026-08-20T01:00:00.000Z';
    const firstEnd = '2026-08-20T03:30:00.000Z';
    expect(rideIntervalsOverlap(firstStart, firstEnd, firstStart, '2026-08-20T02:00:00.000Z')).toBe(true);
    expect(rideIntervalsOverlap(firstStart, firstEnd, '2026-08-20T03:29:59.999Z', '2026-08-20T04:00:00.000Z')).toBe(true);
    expect(rideIntervalsOverlap(firstStart, firstEnd, firstEnd, '2026-08-20T04:00:00.000Z')).toBe(false);
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
