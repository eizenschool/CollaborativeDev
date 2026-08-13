// End-to-end orchestration against the real fixture catalogue and the real mock
// ride data - not stubs. This is what proves the /discover screen will actually
// have something to render, and that each rule fires on the way through.
//
// Still zero API calls: the weather gate's fetcher finds no global fetch response
// it can use and degrades to "no constraint", which is the documented A1 path.

import { beforeEach, describe, expect, it } from 'vitest';
import { DestinationDiscoveryService } from '../DestinationDiscoveryService.js';
import { discoveryDb } from '../../../data-access/discoveryStore.js';
import { PLACE_STATE, CATEGORY, LOCAL_VALUES } from '../constants.js';

// Module 2's mock store reads localStorage unguarded, so node needs the same
// shim RideWorkflow.test.js installs. Without it the ride lookup throws, the
// adapter's catch turns that into "no rides", and every assertion about the
// served list passes vacuously against an empty array.
const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, value),
  removeItem: (key) => memory.delete(key),
  clear: () => memory.clear()
};

const KL = { lat: 3.1390, lng: 101.6869, label: 'Kuala Lumpur' };
const RIDE_DATE = '2026-08-15'; // a date the shared mock ride data actually has

const allOf = (result) => [...result.primary, ...result.unserved, ...result.withheld];
const find = (result, placeId) => allOf(result).find((c) => c.placeId === placeId);

describe('getRecommendations - the catalogue reaches the screen', () => {
  beforeEach(() => discoveryDb.__reset());

  it('returns a non-empty candidate set', async () => {
    const result = await DestinationDiscoveryService.getRecommendations({
      userId: 'u_demo_1', origin: KL, travelDate: RIDE_DATE
    });

    expect(allOf(result).length).toBeGreaterThan(0);
  });

  // Guards the assertions below from passing vacuously: if the ride lookup ever
  // silently returns nothing again, the served list empties and several "never
  // does X" tests would hold against an empty array without meaning anything.
  it('finds rides serving at least one destination on a date that has departures', async () => {
    const result = await DestinationDiscoveryService.getRecommendations({
      userId: 'u_demo_1', origin: KL, travelDate: RIDE_DATE
    });

    expect(result.primary.length).toBeGreaterThan(0);
    expect(result.primary.every((c) => c.rides.length > 0)).toBe(true);
  });

  it('scores every candidate on both axes within 0.00-1.00', async () => {
    const result = await DestinationDiscoveryService.getRecommendations({
      userId: 'u_demo_1', origin: KL, travelDate: RIDE_DATE
    });

    for (const candidate of allOf(result)) {
      expect(candidate.desirability).toBeGreaterThanOrEqual(0);
      expect(candidate.desirability).toBeLessThanOrEqual(1);
      expect(candidate.accessibility).toBeGreaterThanOrEqual(0);
      expect(candidate.accessibility).toBeLessThanOrEqual(1);
    }
  });

  it('attaches the place record each card needs to render', async () => {
    const result = await DestinationDiscoveryService.getRecommendations({
      userId: 'u_demo_1', origin: KL, travelDate: RIDE_DATE
    });

    for (const candidate of allOf(result)) {
      expect(candidate.place).toBeDefined();
      expect(candidate.place.name).toBeTruthy();
      expect(candidate.place.category).toBeTruthy();
    }
  });

  it('reports the dates that actually have departures', async () => {
    const result = await DestinationDiscoveryService.getRecommendations({
      userId: 'u_demo_1', origin: KL, travelDate: RIDE_DATE
    });
    expect(result.departureDates.length).toBeGreaterThan(0);
  });
});

describe('FR-6.4 - Retired places are withheld everywhere', () => {
  beforeEach(() => discoveryDb.__reset());

  it('never surfaces the retired fixture place in any section', async () => {
    const result = await DestinationDiscoveryService.getRecommendations({
      userId: 'u_demo_1', origin: KL, travelDate: RIDE_DATE
    });

    expect(find(result, 'p_retired_museum')).toBeUndefined();
  });

  it('still surfaces the Stale place, which is ranked down rather than hidden', async () => {
    const result = await DestinationDiscoveryService.getRecommendations({
      userId: 'u_demo_1', origin: KL, travelDate: RIDE_DATE
    });

    const stale = find(result, 'p_stale_gallery');
    expect(stale).toBeDefined();
    expect(stale.place.lifecycleState).toBe(PLACE_STATE.STALE);
  });
});

describe('FR-6.26 - chain detection reaches the score', () => {
  beforeEach(() => discoveryDb.__reset());

  it('zeroes the local-economy signal for the three same-named outlets', async () => {
    const result = await DestinationDiscoveryService.getRecommendations({
      userId: 'u_demo_1', origin: KL, travelDate: RIDE_DATE
    });

    for (const id of ['p_chain_a', 'p_chain_b', 'p_chain_c']) {
      expect(find(result, id).signals.desirability.local).toBe(LOCAL_VALUES.CHAIN);
    }
  });

  it('leaves an independent establishment at the full local-economy value', async () => {
    const result = await DestinationDiscoveryService.getRecommendations({
      userId: 'u_demo_1', origin: KL, travelDate: RIDE_DATE
    });

    expect(find(result, 'p_gurney').signals.desirability.local).toBe(LOCAL_VALUES.INDEPENDENT);
  });
});

describe('FR-6.16 - thin data is ranked down, not dressed up', () => {
  beforeEach(() => discoveryDb.__reset());

  // The 5.0-on-two-reviews stall must score below a 4.1-on-7340 hawker centre,
  // even though its raw rating is higher.
  it('ranks a perfect rating on two reviews below a lower rating on thousands', async () => {
    const result = await DestinationDiscoveryService.getRecommendations({
      userId: 'u_demo_1', origin: KL, travelDate: RIDE_DATE
    });

    const thin = find(result, 'p_warung_mak_cik');
    const deep = find(result, 'p_gurney');

    expect(thin.place.rating).toBeGreaterThan(deep.place.rating);
    expect(thin.signals.desirability.quality).toBeLessThan(deep.signals.desirability.quality);
  });
});

describe('the central premise holds end to end', () => {
  beforeEach(() => discoveryDb.__reset());

  it('never places an unserved destination in the primary list', async () => {
    const result = await DestinationDiscoveryService.getRecommendations({
      userId: 'u_demo_1', origin: KL, travelDate: RIDE_DATE
    });

    for (const candidate of result.primary) {
      expect(candidate.servedByRide).toBe(true);
    }
  });

  it('caps every unserved candidate below the primary accessibility threshold', async () => {
    const result = await DestinationDiscoveryService.getRecommendations({
      userId: 'u_demo_1', origin: KL, travelDate: RIDE_DATE
    });

    for (const candidate of result.unserved) {
      expect(candidate.accessibility).toBeLessThanOrEqual(0.45);
    }
  });
});

describe('FR-6.30 - interest is recorded once per selection', () => {
  beforeEach(() => discoveryDb.__reset());

  it('records the first selection and ignores repeats', async () => {
    const first = await DestinationDiscoveryService.recordInterest('u_demo_1', 'p_cameron', RIDE_DATE);
    const second = await DestinationDiscoveryService.recordInterest('u_demo_1', 'p_cameron', RIDE_DATE);

    expect(first.recorded).toBe(true);
    expect(second.recorded).toBe(false);
  });

  it('counts one interested user however many times they look', async () => {
    await DestinationDiscoveryService.recordInterest('u_demo_1', 'p_cameron', RIDE_DATE);
    await DestinationDiscoveryService.recordInterest('u_demo_1', 'p_cameron', RIDE_DATE);

    const result = await DestinationDiscoveryService.getRecommendations({
      userId: 'u_demo_1', origin: KL, travelDate: RIDE_DATE
    });

    expect(find(result, 'p_cameron').interestedUsers).toBe(1);
  });

  it('requires a user, a place and a window', async () => {
    expect((await DestinationDiscoveryService.recordInterest(null, 'p_cameron', RIDE_DATE)).recorded).toBe(false);
    expect((await DestinationDiscoveryService.recordInterest('u_demo_1', null, RIDE_DATE)).recorded).toBe(false);
    expect((await DestinationDiscoveryService.recordInterest('u_demo_1', 'p_cameron', null)).recorded).toBe(false);
  });
});

describe('FR-6.33 / UC6.6 A1 - notification registration', () => {
  beforeEach(() => discoveryDb.__reset());

  it('creates a registration and reports a repeat as already existing', async () => {
    const first = await DestinationDiscoveryService.registerForNotification('u_demo_1', 'p_cameron', RIDE_DATE);
    const second = await DestinationDiscoveryService.registerForNotification('u_demo_1', 'p_cameron', RIDE_DATE);

    expect(first.alreadyExisted).toBe(false);
    expect(second.alreadyExisted).toBe(true);
    expect(second.registration.id).toBe(first.registration.id);
  });

  it('cancels a registration without deleting the record', async () => {
    const { registration } = await DestinationDiscoveryService
      .registerForNotification('u_demo_1', 'p_cameron', RIDE_DATE);
    const cancelled = await DestinationDiscoveryService.cancelRegistration('u_demo_1', registration.id);

    expect(cancelled.status).toBe('cancelled');
  });
});

describe('UC6.4 - stated preferences', () => {
  beforeEach(() => discoveryDb.__reset());

  it('feeds a saved preference into the affinity signal', async () => {
    await DestinationDiscoveryService.savePreferences('u_pref_test', {
      preferredCategories: [CATEGORY.NATURE]
    });

    const result = await DestinationDiscoveryService.getRecommendations({
      userId: 'u_pref_test', origin: KL, travelDate: RIDE_DATE
    });

    const nature = find(result, 'p_cameron');
    const culinary = find(result, 'p_jonker');
    expect(nature.signals.desirability.affinity)
      .toBeGreaterThan(culinary.signals.desirability.affinity);
  });

  it('stops prompting once the prompt has been dismissed', async () => {
    await DestinationDiscoveryService.savePreferences('u_dismiss_test', { promptDismissed: true });
    expect(await DestinationDiscoveryService.shouldPromptForPreferences('u_dismiss_test')).toBe(false);
  });

  it('never prompts an anonymous visitor', async () => {
    expect(await DestinationDiscoveryService.shouldPromptForPreferences(null)).toBe(false);
  });
});

describe('degraded inputs', () => {
  beforeEach(() => discoveryDb.__reset());

  // UC6.1 A1 asks for a location; it does not make one mandatory. Without an
  // origin every distance is unknown, and the view must still render.
  it('still returns candidates with no origin', async () => {
    const result = await DestinationDiscoveryService.getRecommendations({
      userId: 'u_demo_1', travelDate: RIDE_DATE
    });

    expect(allOf(result).length).toBeGreaterThan(0);
  });

  it('still returns candidates for an anonymous visitor', async () => {
    const result = await DestinationDiscoveryService.getRecommendations({
      origin: KL, travelDate: RIDE_DATE
    });

    expect(allOf(result).length).toBeGreaterThan(0);
  });

  it('returns an empty served list for a date with no departures', async () => {
    const result = await DestinationDiscoveryService.getRecommendations({
      userId: 'u_demo_1', origin: KL, travelDate: '2030-01-01'
    });

    expect(result.primary).toHaveLength(0);
    expect(allOf(result).length).toBeGreaterThan(0);
  });
});

describe('getUnmetDemand - UC6.7 / FR-6.34', () => {
  beforeEach(() => discoveryDb.__reset());

  it('returns nothing when no destination carries interest', async () => {
    const rows = await DestinationDiscoveryService.getUnmetDemand({
      userId: 'u_demo_1', travelDate: RIDE_DATE
    });
    expect(rows).toEqual([]);
  });

  it('surfaces a destination once someone has expressed interest in it', async () => {
    await DestinationDiscoveryService.recordInterest('u_a', 'p_cameron', RIDE_DATE);

    const rows = await DestinationDiscoveryService.getUnmetDemand({
      userId: 'u_demo_1', travelDate: RIDE_DATE
    });

    expect(rows.map((r) => r.placeId)).toContain('p_cameron');
    expect(rows.find((r) => r.placeId === 'p_cameron').interestedUsers).toBe(1);
  });

  // The suppression rule that stops the module creating the duplicate journeys
  // it exists to prevent: a destination someone is already driving to, with a
  // seat left, must not be advertised to a second Host.
  it('suppresses a destination already served by a ride with a seat left', async () => {
    await DestinationDiscoveryService.recordInterest('u_a', 'p_georgetown', RIDE_DATE);

    const rows = await DestinationDiscoveryService.getUnmetDemand({
      userId: 'u_demo_1', travelDate: RIDE_DATE
    });

    expect(rows.some((r) => r.placeId === 'p_georgetown')).toBe(false);
  });

  it('ranks by how many people want to go', async () => {
    await DestinationDiscoveryService.recordInterest('u_a', 'p_cameron', RIDE_DATE);
    await DestinationDiscoveryService.recordInterest('u_a', 'p_taman_negara', RIDE_DATE);
    await DestinationDiscoveryService.recordInterest('u_b', 'p_taman_negara', RIDE_DATE);
    await DestinationDiscoveryService.recordInterest('u_c', 'p_taman_negara', RIDE_DATE);

    const rows = await DestinationDiscoveryService.getUnmetDemand({
      userId: 'u_demo_1', travelDate: RIDE_DATE
    });

    expect(rows[0].placeId).toBe('p_taman_negara');
    expect(rows[0].interestedUsers).toBe(3);
  });

  it('counts demand against the travel window, not the place alone', async () => {
    await DestinationDiscoveryService.recordInterest('u_a', 'p_cameron', RIDE_DATE);

    const otherDay = await DestinationDiscoveryService.getUnmetDemand({
      userId: 'u_demo_1', travelDate: '2026-09-09'
    });

    expect(otherDay).toEqual([]);
  });

  it('never surfaces a Retired place', async () => {
    await DestinationDiscoveryService.recordInterest('u_a', 'p_retired_museum', RIDE_DATE);

    const rows = await DestinationDiscoveryService.getUnmetDemand({
      userId: 'u_demo_1', travelDate: RIDE_DATE
    });

    expect(rows.some((r) => r.placeId === 'p_retired_museum')).toBe(false);
  });

  it('works for a host with no publishing history', async () => {
    await DestinationDiscoveryService.recordInterest('u_a', 'p_cameron', RIDE_DATE);

    const rows = await DestinationDiscoveryService.getUnmetDemand({
      travelDate: RIDE_DATE
    });

    expect(rows.length).toBeGreaterThan(0);
  });
});

describe('buildPrefillPayload - UC6.3 / FR-6.35 handoff to Modules 2 and 4', () => {
  it('carries the destination and origin the ride forms need', () => {
    const payload = DestinationDiscoveryService.buildPrefillPayload(
      { name: 'Jonker Street', sourcePlaceId: 'fixture_jonker' },
      { label: 'Kuala Lumpur' }
    );

    expect(payload).toEqual({
      destination: 'Jonker Street',
      pickup: 'Kuala Lumpur',
      destinationPlaceId: 'fixture_jonker'
    });
  });

  it('degrades to empty strings rather than throwing on missing input', () => {
    expect(DestinationDiscoveryService.buildPrefillPayload(null, null))
      .toEqual({ destination: '', pickup: '', destinationPlaceId: null });
  });
});
