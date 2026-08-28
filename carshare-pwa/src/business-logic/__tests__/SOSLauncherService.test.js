import { describe, expect, it } from 'vitest';
import {
  compareSOSLauncherCandidates,
  selectSOSLauncherCandidates,
} from '../SOSLauncherService.js';

const NOW = new Date('2026-08-28T04:00:00.000Z');

function ride(id, hours, status = 'Matched') {
  return {
    id,
    pickup: `${id} pickup`,
    destination: `${id} destination`,
    status,
    departureAt: new Date(NOW.getTime() + hours * 60 * 60 * 1000).toISOString(),
  };
}

function acceptedRequest(id, requestRide, boardingStatus = 'Pending') {
  return {
    id,
    status: 'Accepted',
    boardingStatus,
    ride: requestRide,
  };
}

describe('SOS launcher candidate selection', () => {
  it('uses the existing one-hour trip-mode window for Drivers and accepted passengers', () => {
    const driverRide = ride('driver-ready', 1);
    const tooEarlyRide = ride('too-early', 1.01);
    const passengerRide = ride('passenger-ready', 0.5);
    const candidates = selectSOSLauncherCandidates({
      hosting: [driverRide, tooEarlyRide],
      passengerRequests: [acceptedRequest('request-ready', passengerRide)],
      requestsByRide: {
        [driverRide.id]: [acceptedRequest('driver-passenger', driverRide)],
        [tooEarlyRide.id]: [acceptedRequest('too-early-passenger', tooEarlyRide)],
      },
      now: NOW,
    });

    expect(candidates.map((candidate) => candidate.ride.id)).toEqual(['passenger-ready', 'driver-ready']);
    expect(candidates.map((candidate) => candidate.role)).toEqual(['passenger', 'driver']);
  });

  it('excludes no-shows, terminal rides, pending requests, and rides outside the window', () => {
    const noShowRide = ride('no-show', -0.1, 'In Transit');
    const completedRide = ride('completed', -2, 'Completed');
    const pendingRide = ride('pending-request', 0.2);
    const candidates = selectSOSLauncherCandidates({
      hosting: [completedRide],
      passengerRequests: [
        acceptedRequest('no-show-request', noShowRide, 'No-show'),
        { ...acceptedRequest('pending-request', pendingRide), status: 'Pending' },
      ],
      now: NOW,
    });

    expect(candidates).toEqual([]);
  });

  it('sorts In Transit first, then by earliest departure', () => {
    const laterTransit = ride('transit', -1, 'In Transit');
    const earlierUpcoming = ride('earlier', 0.25);
    const laterUpcoming = ride('later', 0.75);
    const candidates = [
      { ride: laterUpcoming, role: 'passenger' },
      { ride: laterTransit, role: 'driver' },
      { ride: earlierUpcoming, role: 'driver' },
    ].sort(compareSOSLauncherCandidates);

    expect(candidates.map((candidate) => candidate.ride.id)).toEqual(['transit', 'earlier', 'later']);
  });
});
