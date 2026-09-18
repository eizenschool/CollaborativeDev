import { mockDb } from '../shared/fixture/legacyMockDataStore.js';

export const favouriteMockAdapter = {
  list: (...args) => mockDb.listFavouriteRides(...args),
  add: (...args) => mockDb.addFavouriteRide(...args),
  remove: (...args) => mockDb.removeFavouriteRide(...args)
};
