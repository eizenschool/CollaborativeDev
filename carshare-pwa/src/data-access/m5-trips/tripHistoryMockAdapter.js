import { mockDb } from '../shared/fixture/legacyMockDataStore.js';

export const tripHistoryMockAdapter = {
  listAllRides: (...args) => mockDb.listAllRides(...args),
  getCurrentUser: (...args) => mockDb.getCurrentUser(...args)
};
