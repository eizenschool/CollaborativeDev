// Storage vocabulary for the browser-local verification fixture.
export const GPS_RESULT = Object.freeze({
  PASS: 'Pass',
  MISMATCH: 'GPS mismatch',
  UNAVAILABLE: 'Unavailable',
});

export const EXCHANGE_OUTCOME = Object.freeze({
  FULFILLED: 'Fulfilled',
  NOT_FULFILLED: 'Not Fulfilled',
});

export const DISPUTE_STATUS = Object.freeze({
  NONE: 'None',
  DISPUTED: 'Disputed',
  AUTO_RESOLVED: 'Auto-Resolved',
  PENDING_REVIEW: 'Pending Review',
  RESOLVED: 'Resolved',
});

export const VERIFICATION_STATUS = Object.freeze({
  MATCHED: 'Matched',
  IN_TRANSIT: 'In Transit',
  COMPLETED: 'Completed',
});
