// ===== BUSINESS LOGIC LAYER (Module 6 - Verification Constants) =====
// Every threshold Module 6's rules turn on lives here, and nowhere else.
//
// Two reasons this file exists instead of inlining the numbers:
//   1. The proposal fixes these values (100m, 0.75, 15min, 48h) as stated business
//      rules - if a reviewer asks "where is the 100 metre tolerance defined?", the
//      answer is one file, not a grep across ten.
//   2. Boundary Value Analysis test cases import these constants rather than
//      hardcoding literals, so a threshold change can never silently pass a test
//      suite that is still asserting the old number.

// UC6.3 - GPS cross-check tolerance radius between Host and Client at the moment
// of PIN confirmation. Beyond this, the pickup is recorded as "GPS mismatch" and
// becomes an input to the dispute confidence score (UC6.8).
export const GPS_TOLERANCE_M = 100;

// UC6.9 - disputes scoring at or above this auto-resolve; below it they are routed
// to the admin manual-review queue (UC6.10).
export const AUTO_RESOLVE_THRESHOLD = 0.75;

// UC6.5 - a party that has not confirmed pickup this long after the scheduled
// pickup time is recorded as a no-show, which is forwarded to Module 1 (FR-1.5).
export const NO_SHOW_WINDOW_MIN = 15;

// UC6.22 - a party that has not submitted an exchange-fulfilment confirmation this
// long after trip completion has it defaulted to "Not Fulfilled", so no trip is
// left permanently unresolved by silence.
export const EXCHANGE_DEFAULT_HOURS = 48;

// UC6.1 - PIN shape. Digits only, fixed length, so the Host can read it aloud and
// the Client can type it without ambiguity over character case.
export const PIN_LENGTH = 4;
export const PIN_MAX_GENERATION_ATTEMPTS = 10;

// UC6.3 result vocabulary. "Unavailable" is deliberately distinct from a failure:
// a device with location services off must not be treated as evidence of fraud.
export const GPS_RESULT = {
  PASS: 'Pass',
  MISMATCH: 'GPS mismatch',
  UNAVAILABLE: 'Unavailable'
};

// UC6.6 - the two answers either party can give about the agreed Exchange Condition.
export const EXCHANGE_OUTCOME = {
  FULFILLED: 'Fulfilled',
  NOT_FULFILLED: 'Not Fulfilled'
};

// UC6.9/UC6.10 - the three-state resolution enum. UC6.9's auto-resolution and
// UC6.10's admin decision deliberately share one enum so an auto-resolved trip and
// a human-resolved trip are the same shape downstream.
export const DISPUTE_OUTCOME = {
  FULFILLED: 'Fulfilled',
  NOT_FULFILLED: 'Not Fulfilled',
  INCONCLUSIVE: 'Inconclusive'
};

// Dispute lifecycle as Module 6 sees it. Note this is NOT Module 2's ride status -
// see TripContractAdapter for why the two are kept apart.
export const DISPUTE_STATUS = {
  NONE: 'None',
  DISPUTED: 'Disputed',
  AUTO_RESOLVED: 'Auto-Resolved',
  PENDING_REVIEW: 'Pending Review',
  RESOLVED: 'Resolved'
};

// Module 6's own shadow view of where a trip sits in the verification flow. Module 2
// owns `rides.status`; this is the verification-side mirror Module 6 is allowed to write.
export const VERIFICATION_STATUS = {
  MATCHED: 'Matched',
  IN_TRANSIT: 'In Transit',
  COMPLETED: 'Completed'
};

// Outbound event types Module 1 will subscribe to (FR-1.5 reputation recalculation).
// Module 6 never calls Module 1 directly - it appends here and Module 1 reads.
export const EVENT_TYPE = {
  NO_SHOW: 'NO_SHOW',
  DISPUTE_RESOLVED: 'DISPUTE_RESOLVED'
};
