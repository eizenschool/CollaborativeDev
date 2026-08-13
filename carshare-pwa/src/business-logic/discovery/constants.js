// ===== BUSINESS LOGIC LAYER (Module 6 - Destination Discovery constants) =====
// Every weight and threshold the recommendation rules turn on lives here.
//
// Two reasons this file exists instead of inlining the numbers:
//   1. The module specification fixes these values, and several of them are load
//      bearing - the 0.55 seat-headroom weight is what makes "fill an existing
//      seat" outrank "create a new journey" arithmetically rather than by an
//      appended preference. A number moved carelessly changes the argument.
//   2. Boundary Value Analysis tests import these rather than hardcoding
//      literals, so a threshold change cannot silently pass a suite still
//      asserting the old number.

// --- Desirability Score (D): how well a destination suits this user ---
// Weights sum to 1.0 so D lands on 0.00-1.00.
export const DESIRABILITY_WEIGHTS = {
  affinity: 0.30,   // personal category affinity (trip history / stated / neutral)
  season: 0.25,     // seasonal or VM2026 event alignment
  quality: 0.20,    // normalised rating x review confidence
  headroom: 0.15,   // visitation headroom against same-category peers
  local: 0.10       // independently operated vs chain
};

// --- Accessibility Score (A): how efficiently the user can actually get there ---
// Weights sum to 1.0 so A lands on 0.00-1.00.
//
// Seat headroom deliberately carries more than half the weight. The consequence
// is structural: a destination no ride serves scores 0.0 on this signal, so its
// A is bounded above by 0.30 + 0.15 = 0.45 and can never cross the 0.60 primary
// threshold no matter how desirable it is or how close it sits. This is the
// module's central premise expressed as arithmetic, not as a special-case rule.
export const ACCESSIBILITY_WEIGHTS = {
  seatHeadroom: 0.55,
  journeyCost: 0.30,
  demandConvergence: 0.15
};

// --- Presentation rule thresholds (four quadrants over the D/A pair) ---
export const PRESENTATION_THRESHOLDS = {
  accessible: 0.60,       // A at or above this reaches the primary list
  desirable: 0.50,        // D at or above this leads the primary list
  unservedDesirable: 0.70 // D needed to surface in the unserved section
};

export const PRESENTATION = {
  PRIMARY: 'primary',                     // A >= 0.60 and D >= 0.50
  PRIMARY_BELOW_THRESHOLD: 'primary-low', // A >= 0.60 and D <  0.50
  UNSERVED: 'unserved',                   // A <  0.60 and D >= 0.70
  WITHHELD: 'withheld'                    // A <  0.60 and D <  0.70
};

// --- Desirability signal parameters ---

// Seasonal fit is a three-state signal rather than a continuous one: a
// destination is either in an active window, outside any declared season, or
// inside a declared off-season.
export const SEASON_VALUES = {
  ALIGNED: 1.0,     // active seasonal window or registered VM2026 event
  UNDECLARED: 0.7,  // outside any declared season
  OFF_SEASON: 0.3
};

// Review confidence saturates at ten reviews. This is the same number FR-6.16
// uses to decide whether a numeric rating may be displayed at all, so display
// suppression and rank treatment of thin data are one mechanism, not two rules
// that have to be kept in step.
export const REVIEW_CONFIDENCE_SATURATION = 10;

// Ratings are a 1-5 scale; (rating - 1) / 4 maps that onto 0.00-1.00.
export const RATING_MIN = 1;
export const RATING_MAX = 5;

// Affinity fallback chain (FR-6.20): trip history, then stated preference,
// then neutral. These two apply only in the stated-preference tier.
export const AFFINITY_STATED_PREFERRED = 1.0;
export const AFFINITY_STATED_OTHER = 0.4;
export const AFFINITY_NEUTRAL = 0.5;

// --- Accessibility signal parameters ---

// Demand convergence saturates at four distinct interested users: beyond that,
// more interest does not make the destination easier to reach.
export const DEMAND_CONVERGENCE_SATURATION = 4;

// --- Local economy signal (FR-6.25 / FR-6.26) ---
export const LOCAL_VALUES = {
  INDEPENDENT: 1.0,
  CHAIN: 0.0
};

// An establishment counts as a chain when its name recurs across this many
// distinct place records within the same state.
export const CHAIN_NAME_RECURRENCE = 3;

// --- Destination categories (FR-6.7: exactly one per place) ---
export const CATEGORY = {
  CULINARY: 'culinary',
  HERITAGE: 'heritage',
  NATURE: 'nature',
  EVENT: 'event'
};

// Only outdoor categories are withheld under a severe weather warning (FR-6.22).
export const OUTDOOR_CATEGORIES = [CATEGORY.NATURE, CATEGORY.EVENT];

// --- Place lifecycle (FR-6.3 / FR-6.4 / FR-6.5) ---
export const PLACE_STATE = {
  PENDING_ENRICHMENT: 'Pending Enrichment',
  ACTIVE: 'Active',
  PROVISIONAL: 'Provisional',
  STALE: 'Stale',
  RETIRED: 'Retired'
};

// Absence is counted in completed ingestion cycles. The seven-cycle gap between
// the two thresholds exists so a place is demoted well before it is withheld:
// source coverage is not perfectly stable, and a place that disappears for a few
// cycles and returns is more common than one that has genuinely closed.
export const STALE_AFTER_CYCLES = 3;
export const RETIRED_AFTER_CYCLES = 10;

// A place is Provisional rather than Active below this review count, or with no
// photograph at all (FR-6.12).
export const PROVISIONAL_MIN_REVIEWS = 3;

// Description generation is withheld entirely below this review count and a
// category template is presented instead (FR-6.10). Same number as the
// Provisional threshold by design - both express "too little source material".
export const DESCRIPTION_MIN_REVIEWS = 3;

// --- Presentation limits ---
export const MAX_PHOTOS_PER_PLACE = 5; // FR-6.13
