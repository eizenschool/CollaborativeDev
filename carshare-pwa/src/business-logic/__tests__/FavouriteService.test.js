import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDb } from '../../data-access/mockDataStore.js';

const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, value),
  removeItem: (key) => memory.delete(key),
  clear: () => memory.clear()
};

describe('Module 4 mock favourite persistence', () => {
  beforeEach(() => {
    memory.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-08-14T00:00:00.000Z'));
  });

  afterEach(() => vi.useRealTimers());

  it('keeps favourites isolated per user and makes duplicate adds idempotent', async () => {
    await mockDb.addFavouriteRide('u_demo_2', 'r_2');
    await mockDb.addFavouriteRide('u_demo_2', 'r_2');
    const secondUser = await mockDb.listFavouriteRides('u_demo_2');
    const demoUser = await mockDb.listFavouriteRides('u_demo_1');
    expect(secondUser.map((item) => item.id)).toEqual(['r_2']);
    expect(demoUser.some((item) => item.id === 'r_2')).toBe(false);
  });

  it('retains unavailable rides for warning and removal', async () => {
    const favourites = await mockDb.listFavouriteRides('u_demo_1');
    const completed = favourites.find((item) => item.id === 'r_6');
    expect(completed.status).toBe('Completed');
    expect(completed.favouriteAvailable).toBe(false);
    await mockDb.removeFavouriteRide('u_demo_1', 'r_6');
    expect((await mockDb.listFavouriteRides('u_demo_1')).some((item) => item.id === 'r_6')).toBe(false);
  });

  it('rejects adding an unavailable ride', async () => {
    await expect(mockDb.addFavouriteRide('u_demo_2', 'r_6')).rejects.toThrow('available published ride');
  });
});
