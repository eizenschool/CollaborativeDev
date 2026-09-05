import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RideRequestService } from '../RideRequestService.js';
import { IdentityVerificationService } from '../IdentityVerificationService.js';

// The mock backend persists through localStorage, which the node test
// environment does not provide - same shim RideWorkflow.test.js uses.
const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, value),
  removeItem: (key) => memory.delete(key),
  clear: () => memory.clear()
};

const photo = () => ({ type: 'image/jpeg', size: 1024, name: 'mykad.jpg' });

describe('requesting to join a ride requires a submitted MyKad', () => {
  beforeEach(() => {
    memory.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Well before r_5's 2026-08-20 08:00 (Malaysia time) departure and its
    // one-hour request cutoff.
    vi.setSystemTime(new Date('2026-08-15T00:00:00.000Z'));
  });

  afterEach(() => vi.useRealTimers());

  // r_5 is the seeded Published ride hosted by u_demo_1, with seats free -
  // a fresh traveller id is used as the requester so the seeded reputation
  // and identity fixtures (both empty for an unknown id) apply.
  const request = { rideId: 'r_5', seatsRequested: 1, companionNames: [] };

  it('blocks a traveller who has not submitted a MyKad', async () => {
    await expect(RideRequestService.submitRequest('u_unverified_traveller', request)).rejects.toThrow(
      /verify your identity/i
    );
  });

  it('lets a traveller who has submitted a MyKad request a seat', async () => {
    const requesterId = 'u_verified_traveller';
    await IdentityVerificationService.submit(requesterId, {
      file: photo(),
      icNumber: '990101-14-5678',
      licenseExpiry: '2099-12-31'
    });
    await expect(RideRequestService.submitRequest(requesterId, request)).resolves.toMatchObject({
      rideId: 'r_5',
      requesterId,
      status: 'Pending'
    });
  });
});
