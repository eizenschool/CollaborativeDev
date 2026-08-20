import { describe, expect, it } from 'vitest';
import {
  compareJourneyStates, formatJourneyCountdown, getRideJourneyState,
  isTripModeEligible, journeyGroup, RIDE_ACTION
} from '../rideJourneyState.js';

const NOW = new Date('2026-08-21T00:00:00.000Z');
const ride = (hours, status = 'Matched') => ({
  id: `ride-${hours}-${status}`, status,
  departureAt: new Date(NOW.getTime() + hours * 60 * 60 * 1000).toISOString()
});
const accepted = (boardingStatus = 'Pending') => ({ id: `request-${boardingStatus}`, status: 'Accepted', boardingStatus });

describe('ride journey state', () => {
  it('opens passenger check-in exactly one hour before departure', () => {
    const state = getRideJourneyState({ ride: ride(1), role: 'passenger', request: accepted(), now: NOW });
    expect(state.phase).toBe('check_in');
    expect(state.nextAction.id).toBe(RIDE_ACTION.CHECK_IN);
    expect(isTripModeEligible(state)).toBe(true);
  });

  it('requires unresolved passengers to be handled before Driver start', () => {
    const state = getRideJourneyState({ ride: ride(0), role: 'driver', requests: [accepted(), accepted('Checked In')], now: NOW });
    expect(state.nextAction.id).toBe(RIDE_ACTION.RESOLVE_BOARDING);
    expect(state.blockers).toContain('Unresolved accepted passengers');
  });

  it('allows Driver start only when at least one passenger checked in and none are unresolved', () => {
    const ready = getRideJourneyState({ ride: ride(0), role: 'driver', requests: [accepted('Checked In'), accepted('No-show')], now: NOW });
    const noneReady = getRideJourneyState({ ride: ride(0), role: 'driver', requests: [accepted('No-show')], now: NOW });
    expect(ready.nextAction.id).toBe(RIDE_ACTION.START_RIDE);
    expect(noneReady.nextAction.id).toBe(RIDE_ACTION.RESOLVE_BOARDING);
    expect(noneReady.blockers).toContain('At least one checked-in passenger is required');
  });

  it('never offers Check-in for a Completed ride even with stale boarding data', () => {
    const state = getRideJourneyState({ ride: ride(-2, 'Completed'), role: 'passenger', request: accepted(), now: NOW });
    expect(state.phase).toBe('completed');
    expect(state.nextAction.id).toBe(RIDE_ACTION.REVIEW_RIDE);
    expect(isTripModeEligible(state)).toBe(false);
  });

  it('shows an already-submitted result instead of asking for another review', () => {
    const state = getRideJourneyState({
      ride: ride(-2, 'Completed'), role: 'passenger', request: accepted(), now: NOW,
      reviewEligibility: [{ revieweeId: 'driver', existingRating: 5 }]
    });
    expect(state.title).toBe('Review submitted');
    expect(state.nextAction.label).toBe('View your review');
  });

  it('moves checked-in passengers from transit to arrival confirmation after Driver arrival', () => {
    const state = getRideJourneyState({
      ride: ride(-1, 'In Transit'), role: 'passenger', request: accepted('Checked In'),
      lifecycleContext: { driverArrivedAt: NOW.toISOString() }, now: NOW
    });
    expect(state.phase).toBe('arrival');
    expect(state.nextAction.id).toBe(RIDE_ACTION.CONFIRM_PASSENGER_ARRIVAL);
  });

  it('groups and sorts attention, upcoming, drafts, and history deterministically', () => {
    const attention = { ride: ride(0), state: getRideJourneyState({ ride: ride(0), role: 'driver', requests: [accepted()], now: NOW }) };
    const upcoming = { ride: ride(4), state: getRideJourneyState({ ride: ride(4), role: 'driver', now: NOW }) };
    const draftItem = { ride: ride(6, 'Draft'), state: getRideJourneyState({ ride: ride(6, 'Draft'), role: 'driver', now: NOW }) };
    const history = { ride: ride(-4, 'Completed'), state: getRideJourneyState({ ride: ride(-4, 'Completed'), role: 'driver', now: NOW }) };
    const sorted = [history, draftItem, upcoming, attention].sort(compareJourneyStates);
    expect(sorted[0]).toBe(attention);
    expect([attention, upcoming, draftItem, history].map((item) => journeyGroup(item.state))).toEqual(['attention', 'upcoming', 'drafts', 'history']);
  });

  it('formats relative departure copy without exposing timezone-sensitive dates', () => {
    expect(formatJourneyCountdown(ride(1).departureAt, NOW)).toBe('Leaves in 1h');
    expect(formatJourneyCountdown(ride(-0.5).departureAt, NOW)).toBe('30 min overdue');
  });
});
