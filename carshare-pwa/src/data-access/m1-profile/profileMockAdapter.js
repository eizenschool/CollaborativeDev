import { mockDb } from '../shared/fixture/legacyMockDataStore.js';

// Module-owned facade over the legacy offline fixture. The shared store stays
// atomic because profile, ride, favourite, and reputation demo records share
// one localStorage transaction, while callers only see M1 operations here.
export const profileMockAdapter = {
  getCurrentUser: (...args) => mockDb.getCurrentUser(...args),
  signUp: (...args) => mockDb.signUp(...args),
  signIn: (...args) => mockDb.signIn(...args),
  updateProfile: (...args) => mockDb.updateProfile(...args),
  getPublicProfile: (...args) => mockDb.getPublicProfile(...args),
  getProfileVisibility: (...args) => mockDb.getProfileVisibility(...args),
  updateProfileVisibility: (...args) => mockDb.updateProfileVisibility(...args),
  getReputationSummary: (...args) => mockDb.getReputationSummary(...args),
  getRideEligibility: (...args) => mockDb.getRideEligibility(...args),
  recordReputationEvent: (...args) => mockDb.recordReputationEvent(...args),
  changePassword: (...args) => mockDb.changePassword(...args),
  verifyPassword: (...args) => mockDb.verifyPassword(...args),
  setAccountStatus: (...args) => mockDb.setAccountStatus(...args),
  listVehicles: (...args) => mockDb.listVehicles(...args),
  upsertVehicle: (...args) => mockDb.upsertVehicle(...args),
  removeVehicle: (...args) => mockDb.removeVehicle(...args),
  setVehicleActive: (...args) => mockDb.setVehicleActive(...args),
  getIdentityVerification: (...args) => mockDb.getIdentityVerification(...args),
  submitIdentityVerification: (...args) => mockDb.submitIdentityVerification(...args),
  getIdentityDocumentPreview: (...args) => mockDb.getIdentityDocumentPreview(...args),
  adminListIdentityVerifications: (...args) => mockDb.adminListIdentityVerifications(...args),
  adminReviewIdentityVerification: (...args) => mockDb.adminReviewIdentityVerification(...args),
  getImpactStats: (...args) => mockDb.getImpactStats(...args),
  adjustImpactStats: (...args) => mockDb.adjustImpactStats(...args)
};
