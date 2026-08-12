import { beforeEach, describe, expect, it } from 'vitest';
import { validateRideDraft } from '../RideService.js';
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
  buildGoogleMapsDirectionsUrl
} from '../GoogleMapsEmbedService.js';

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

  it('lazily expires due Published rides and their Pending requests in the mock adapter', async () => {
    await mockDb.processRideLifecycle(new Date('2026-08-16T00:00:00.000Z'));
    const ride = await mockDb.getRide('r_1');
    const requests = await mockDb.listMyRideRequests('u_demo_1');
    expect(ride.status).toBe('Expired');
    expect(requests.find((request) => request.rideId === 'r_1').status).toBe('Expired');
  });
});
