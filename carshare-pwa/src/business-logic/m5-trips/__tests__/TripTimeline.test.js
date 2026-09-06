import { describe, expect, it } from 'vitest';
import { STEP_STATE, buildTripTimeline, timelineProgress } from '../TripTimeline.js';

const NOW = new Date('2026-08-21T04:00:00.000Z'); // 12:00 in Kuala Lumpur

function ride(overrides = {}) {
  return {
    id: 'r_1',
    status: 'Matched',
    createdAt: '2026-08-18T02:00:00.000Z',
    publishedAt: '2026-08-18T02:05:00.000Z',
    recruitmentClosedAt: null,
    departureAt: '2026-08-20T00:00:00.000Z',
    expiredAt: null,
    cancelReason: null,
    ...overrides
  };
}

function request(overrides = {}) {
  return {
    id: 'rq_1',
    status: 'Accepted',
    seatsRequested: 1,
    createdAt: '2026-08-19T01:00:00.000Z',
    processedAt: '2026-08-19T02:00:00.000Z',
    ...overrides
  };
}

const idsOf = (steps) => steps.map((step) => step.id);
const byId = (steps) => Object.fromEntries(steps.map((step) => [step.id, step]));

describe('Module 5 trip timeline', () => {
  it('returns nothing without a ride', () => {
    expect(buildTripTimeline({ ride: null })).toEqual([]);
  });

  it('tells the whole story of a finished trip', () => {
    const steps = buildTripTimeline({
      ride: ride({ recruitmentClosedAt: '2026-08-19T16:00:00.000Z' }),
      requests: [request()],
      lifecycle: {
        driverArrivedAt: '2026-08-20T00:47:00.000Z',
        completedAt: '2026-08-20T00:52:00.000Z'
      },
      now: NOW
    });

    expect(idsOf(steps)).toEqual([
      'created', 'published', 'requested', 'accepted', 'matched', 'departure', 'arrived', 'completed'
    ]);
    expect(steps.every((step) => step.state === STEP_STATE.DONE)).toBe(true);
    expect(timelineProgress(steps)).toEqual({ done: 8, total: 8 });
  });

  it('marks a departed trip as awaiting confirmation, not finished', () => {
    const steps = byId(buildTripTimeline({
      ride: ride(),
      requests: [request()],
      lifecycle: null,
      now: NOW
    }));
    expect(steps.departure.state).toBe(STEP_STATE.DONE);
    expect(steps.departure.label).toBe('Departed');
    expect(steps.arrived.state).toBe(STEP_STATE.DUE);
    expect(steps.completed.state).toBe(STEP_STATE.UPCOMING);
  });

  it('explains what completion is waiting on once the driver has arrived', () => {
    const steps = byId(buildTripTimeline({
      ride: ride(),
      requests: [request()],
      lifecycle: { driverArrivedAt: '2026-08-20T00:47:00.000Z', completedAt: null },
      now: NOW
    }));
    expect(steps.completed.state).toBe(STEP_STATE.DUE);
    expect(steps.completed.detail).toMatch(/confirm/i);
  });

  it('keeps a future departure ahead of the traveller', () => {
    const steps = byId(buildTripTimeline({
      ride: ride({ departureAt: '2099-01-01T00:00:00.000Z' }),
      requests: [request()],
      now: NOW
    }));
    expect(steps.departure.state).toBe(STEP_STATE.UPCOMING);
    expect(steps.departure.label).toBe('Scheduled departure');
    expect(steps.arrived.state).toBe(STEP_STATE.UPCOMING);
  });

  it('stops the story at a cancellation and says why', () => {
    const steps = buildTripTimeline({
      ride: ride({ status: 'Cancelled', cancelReason: 'Car trouble' }),
      requests: [request()],
      now: NOW
    });
    expect(idsOf(steps)).toContain('cancelled');
    expect(idsOf(steps)).not.toContain('completed');
    expect(byId(steps).cancelled.detail).toBe('Car trouble');
  });

  it('records an expiry as its own ending', () => {
    const steps = buildTripTimeline({
      ride: ride({ status: 'Expired', expiredAt: '2026-08-20T00:00:00.000Z' }),
      requests: [],
      now: NOW
    });
    expect(idsOf(steps)).toContain('expired');
    expect(idsOf(steps)).not.toContain('arrived');
    expect(byId(steps).expired.label).toBe('Expired - nobody joined');
    expect(byId(steps).departure.label).toBe('Scheduled departure reached');
  });

  it('distinguishes an accepted ride that failed to start during grace', () => {
    const steps = buildTripTimeline({
      ride: ride({ status: 'Expired', expiredAt: '2026-08-20T00:30:00.000Z' }),
      requests: [request({ status: 'Expired', acceptedAt: '2026-08-19T02:00:00.000Z', processedAt: '2026-08-20T00:30:00.000Z' })],
      now: NOW
    });

    expect(byId(steps).accepted.at).toBe('2026-08-19T02:00:00.000Z');
    expect(byId(steps).expired.label).toBe('Expired - ride did not start within 30 minutes');
  });

  it('counts confirmed seats rather than requests', () => {
    const steps = byId(buildTripTimeline({
      ride: ride(),
      requests: [request({ seatsRequested: 2 }), request({ id: 'rq_2', seatsRequested: 1 })],
      now: NOW
    }));
    expect(steps.accepted.label).toBe('3 seats confirmed');
    expect(steps.requested.label).toBe('2 passengers asked to join');
  });

  it('ignores requests that were never accepted', () => {
    const steps = byId(buildTripTimeline({
      ride: ride(),
      requests: [request({ status: 'Rejected' })],
      now: NOW
    }));
    expect(steps.accepted).toBeUndefined();
    expect(steps.requested.state).toBe(STEP_STATE.DONE);
  });

  it('shows an unpublished draft as still unpublished', () => {
    const steps = byId(buildTripTimeline({
      ride: ride({ status: 'Draft', publishedAt: null }),
      requests: [],
      now: NOW
    }));
    expect(steps.published.state).toBe(STEP_STATE.UPCOMING);
    expect(steps.published.at).toBeNull();
    // Nothing can be requested on a trip nobody can see.
    expect(steps.requested).toBeUndefined();
  });
});

describe('Module 5 timeline ordering', () => {
  it('never prints a later instant above an earlier one', () => {
    // Real data from the mock store: the ride was closed to new requests after
    // its departure instant had already passed.
    const steps = buildTripTimeline({
      ride: ride({
        departureAt: '2026-08-20T00:00:00.000Z',
        recruitmentClosedAt: '2026-08-20T15:19:00.000Z'
      }),
      requests: [request()],
      now: NOW
    });

    const times = steps.filter((s) => s.at).map((s) => new Date(s.at).getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(idsOf(steps).indexOf('departure')).toBeLessThan(idsOf(steps).indexOf('matched'));
  });

  it('lists everything still awaited after everything that happened', () => {
    const steps = idsOf(buildTripTimeline({
      ride: ride(),
      requests: [request()],
      now: NOW
    }));
    // 'arrived' and 'completed' carry no instant yet, and must stay last.
    expect(steps.slice(-2)).toEqual(['arrived', 'completed']);
  });
});

describe('Module 5 timeline awaited steps', () => {
  it('never places an awaited step above something that already happened', () => {
    const steps = buildTripTimeline({
      ride: ride({
        departureAt: '2026-08-20T00:00:00.000Z',
        recruitmentClosedAt: '2026-08-20T15:19:00.000Z'
      }),
      requests: [request()],
      now: NOW
    });

    const lastTimed = steps.reduce((last, step, index) => (step.at ? index : last), -1);
    const firstAwaited = steps.findIndex((step) => !step.at);
    expect(firstAwaited).toBeGreaterThan(lastTimed);
  });
});
