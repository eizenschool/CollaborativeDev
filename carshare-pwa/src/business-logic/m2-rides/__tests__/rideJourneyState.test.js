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

  it('allows an early Driver start after every accepted passenger checks in', () => {
    const state = getRideJourneyState({ ride: ride(0.5), role: 'driver', requests: [accepted('Checked In'), accepted('Checked In')], now: NOW });
    expect(state.nextAction.id).toBe(RIDE_ACTION.START_RIDE);
    expect(state.nextAction.label).toBe('Start trip early');
    expect(state.description).toContain('All 2 accepted passengers checked in');
  });

  it('keeps early start unavailable until every accepted passenger checks in', () => {
    const state = getRideJourneyState({ ride: ride(0.5), role: 'driver', requests: [accepted(), accepted('Checked In')], now: NOW });
    expect(state.nextAction.id).toBe(RIDE_ACTION.RESOLVE_BOARDING);
    expect(state.description).toContain('only after everyone checks in');
  });

  it('allows normal departure start with a checked-in passenger and marks unresolved passengers', () => {
    const ready = getRideJourneyState({ ride: ride(0), role: 'driver', requests: [accepted(), accepted('Checked In')], now: NOW });
    const noneReady = getRideJourneyState({ ride: ride(0), role: 'driver', requests: [accepted('No-show')], now: NOW });
    expect(ready.nextAction.id).toBe(RIDE_ACTION.START_RIDE);
    expect(ready.description).toContain('marks 1 passenger who did not check in as No-show');
    expect(noneReady.nextAction.id).toBe(RIDE_ACTION.RESOLVE_BOARDING);
    expect(noneReady.blockers).toContain('At least one checked-in passenger is required');
    expect(ready.countdownKind).toBe('expiry');
    expect(formatJourneyCountdown(ready.countdownAt, NOW, ready.countdownKind)).toBe('Expires in 30 min');
  });

  it('keeps departure actions open one second before departure', () => {
    const oneSecondBefore = new Date(NOW.getTime() + 1000);
    const state = getRideJourneyState({
      ride: { id: 'ride-boundary', status: 'Matched', departureAt: oneSecondBefore.toISOString() },
      role: 'passenger', request: accepted(), now: NOW
    });

    expect(state.nextAction.id).toBe(RIDE_ACTION.CHECK_IN);
    expect(state.countdownKind).toBe('departure');
  });

  it('keeps accepted participants actionable through 29:59 and disables stale data at 30:00', () => {
    const beforeDeadline = getRideJourneyState({
      ride: ride(-((29 * 60 + 59) / 3600)), role: 'passenger', request: accepted(), now: NOW
    });
    const atDeadline = getRideJourneyState({ ride: ride(-0.5), role: 'passenger', request: accepted(), now: NOW });

    expect(beforeDeadline.nextAction.id).toBe(RIDE_ACTION.CHECK_IN);
    expect(beforeDeadline.countdownKind).toBe('expiry');
    expect(atDeadline.phase).toBe('terminal');
    expect(atDeadline.title).toBe('Ride expired');
    expect(isTripModeEligible(atDeadline)).toBe(false);
  });

  it('treats a stale pending request and passengerless Published ride as expired at departure', () => {
    const pending = getRideJourneyState({
      ride: ride(0, 'Published'), role: 'passenger', request: { status: 'Pending' }, now: NOW
    });
    const driver = getRideJourneyState({ ride: ride(0, 'Published'), role: 'driver', requests: [], now: NOW });

    expect(pending.title).toBe('Request expired');
    expect(driver.title).toBe('Ride expired');
  });

  it('requires an old Draft to be rescheduled instead of showing the normal Continue state', () => {
    const state = getRideJourneyState({ ride: ride(-1, 'Draft'), role: 'driver', now: NOW });
    expect(state.title).toBe('Reschedule this draft');
    expect(state.countdownAt).toBeNull();
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
    expect(formatJourneyCountdown(ride(-0.5).departureAt, NOW)).toBe('Departure time');
    expect(formatJourneyCountdown(ride(0.25).departureAt, NOW, 'expiry')).toBe('Expires in 15 min');
    expect(formatJourneyCountdown(ride(0).departureAt, NOW, 'expiry')).toBe('Expired');
  });
});
