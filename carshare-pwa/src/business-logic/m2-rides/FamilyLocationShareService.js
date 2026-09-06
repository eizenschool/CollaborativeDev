import { familyLocationShareAdapter } from '../../data-access/m2-rides/familyLocationShareAdapter.js';

export const FamilyLocationShareService = {
  getSnapshot(token) { return familyLocationShareAdapter.getSnapshot(token); },
  consumeMapLoad(token, pageSessionId) {
    return familyLocationShareAdapter.consumeMapLoad(token, pageSessionId);
  },
};
