// Boundary Value Analysis - FR-6.3 Stale at three cycles / FR-6.4 Retired at ten
// and withheld / FR-6.5 restore on reappearance / FR-6.12 Provisional.
//
// The thresholds are imported rather than hardcoded, so moving one cannot leave a
// passing suite asserting the old number.

import { describe, expect, it } from 'vitest';
import {
  applyAbsentCycle,
  applyPresentCycle,
  isRecommendable,
  selectRecommendable,
  stateAfterEnrichment,
  stateForAbsence
} from '../PlaceLifecycle.js';
import {
  PLACE_STATE,
  PROVISIONAL_MIN_REVIEWS,
  RETIRED_AFTER_CYCLES,
  STALE_AFTER_CYCLES
} from '../constants.js';

describe('stateAfterEnrichment - FR-6.12 Provisional conditions', () => {
  it('reaches Active with enough reviews and a photograph', () => {
    expect(stateAfterEnrichment({ reviewCount: PROVISIONAL_MIN_REVIEWS, hasPhoto: true }))
      .toBe(PLACE_STATE.ACTIVE);
  });

  it('is Provisional one review short of the threshold', () => {
    expect(stateAfterEnrichment({ reviewCount: PROVISIONAL_MIN_REVIEWS - 1, hasPhoto: true }))
      .toBe(PLACE_STATE.PROVISIONAL);
  });

  it('is Provisional with reviews but no photograph', () => {
    expect(stateAfterEnrichment({ reviewCount: 500, hasPhoto: false }))
      .toBe(PLACE_STATE.PROVISIONAL);
  });

  it('is Provisional with neither', () => {
    expect(stateAfterEnrichment({ reviewCount: 0, hasPhoto: false }))
      .toBe(PLACE_STATE.PROVISIONAL);
    expect(stateAfterEnrichment({})).toBe(PLACE_STATE.PROVISIONAL);
  });
});

describe('stateForAbsence - BVA on the Stale and Retired thresholds', () => {
  it('leaves the state unchanged below the Stale threshold', () => {
    expect(stateForAbsence(PLACE_STATE.ACTIVE, STALE_AFTER_CYCLES - 1)).toBe(PLACE_STATE.ACTIVE);
  });

  it('becomes Stale exactly at the threshold', () => {
    expect(stateForAbsence(PLACE_STATE.ACTIVE, STALE_AFTER_CYCLES)).toBe(PLACE_STATE.STALE);
  });

  it('stays Stale one cycle past the threshold', () => {
    expect(stateForAbsence(PLACE_STATE.ACTIVE, STALE_AFTER_CYCLES + 1)).toBe(PLACE_STATE.STALE);
  });

  it('is still Stale one cycle short of Retired', () => {
    expect(stateForAbsence(PLACE_STATE.STALE, RETIRED_AFTER_CYCLES - 1)).toBe(PLACE_STATE.STALE);
  });

  it('becomes Retired exactly at the Retired threshold', () => {
    expect(stateForAbsence(PLACE_STATE.STALE, RETIRED_AFTER_CYCLES)).toBe(PLACE_STATE.RETIRED);
  });

  it('stays Retired beyond the threshold', () => {
    expect(stateForAbsence(PLACE_STATE.STALE, RETIRED_AFTER_CYCLES + 50)).toBe(PLACE_STATE.RETIRED);
  });

  it('leaves the state unchanged for a non-numeric counter', () => {
    expect(stateForAbsence(PLACE_STATE.ACTIVE, undefined)).toBe(PLACE_STATE.ACTIVE);
  });
});

describe('applyAbsentCycle', () => {
  it('advances the counter by one per completed cycle', () => {
    const place = { lifecycleState: PLACE_STATE.ACTIVE, absenceCounter: 0 };
    expect(applyAbsentCycle(place).absenceCounter).toBe(1);
  });

  it('demotes to Stale on reaching the threshold', () => {
    let place = { lifecycleState: PLACE_STATE.ACTIVE, absenceCounter: STALE_AFTER_CYCLES - 1 };
    place = applyAbsentCycle(place);
    expect(place.absenceCounter).toBe(STALE_AFTER_CYCLES);
    expect(place.lifecycleState).toBe(PLACE_STATE.STALE);
  });

  // FR-6.5 needs the pre-demotion state so a returning place is restored to what
  // it was, not to a default.
  it('records the state held before demotion', () => {
    const place = applyAbsentCycle({
      lifecycleState: PLACE_STATE.PROVISIONAL,
      absenceCounter: STALE_AFTER_CYCLES - 1
    });
    expect(place.stateBeforeDemotion).toBe(PLACE_STATE.PROVISIONAL);
  });

  it('does not overwrite the recorded pre-demotion state on later cycles', () => {
    let place = { lifecycleState: PLACE_STATE.ACTIVE, absenceCounter: STALE_AFTER_CYCLES - 1 };
    place = applyAbsentCycle(place); // Active -> Stale, records Active
    place = applyAbsentCycle(place); // still Stale
    place = applyAbsentCycle(place);
    expect(place.stateBeforeDemotion).toBe(PLACE_STATE.ACTIVE);
  });

  it('walks an Active place all the way to Retired over ten cycles', () => {
    let place = { lifecycleState: PLACE_STATE.ACTIVE, absenceCounter: 0 };
    for (let i = 0; i < RETIRED_AFTER_CYCLES; i += 1) place = applyAbsentCycle(place);
    expect(place.lifecycleState).toBe(PLACE_STATE.RETIRED);
    expect(place.stateBeforeDemotion).toBe(PLACE_STATE.ACTIVE);
  });
});

describe('applyPresentCycle - FR-6.5 restoration', () => {
  it('resets the absence counter', () => {
    const place = applyPresentCycle({ lifecycleState: PLACE_STATE.ACTIVE, absenceCounter: 2 });
    expect(place.absenceCounter).toBe(0);
  });

  it('restores a Retired place to the state it held before retirement', () => {
    const place = applyPresentCycle({
      lifecycleState: PLACE_STATE.RETIRED,
      absenceCounter: RETIRED_AFTER_CYCLES,
      stateBeforeDemotion: PLACE_STATE.ACTIVE
    });
    expect(place.lifecycleState).toBe(PLACE_STATE.ACTIVE);
    expect(place.absenceCounter).toBe(0);
    expect(place.stateBeforeDemotion).toBeNull();
  });

  it('restores a Stale place too', () => {
    const place = applyPresentCycle({
      lifecycleState: PLACE_STATE.STALE,
      absenceCounter: 4,
      stateBeforeDemotion: PLACE_STATE.PROVISIONAL
    });
    expect(place.lifecycleState).toBe(PLACE_STATE.PROVISIONAL);
  });

  it('falls back to Provisional where no prior state was recorded', () => {
    const place = applyPresentCycle({
      lifecycleState: PLACE_STATE.RETIRED,
      stateBeforeDemotion: null
    });
    expect(place.lifecycleState).toBe(PLACE_STATE.PROVISIONAL);
  });

  it('leaves an already-Active place alone', () => {
    const place = applyPresentCycle({ lifecycleState: PLACE_STATE.ACTIVE, absenceCounter: 0 });
    expect(place.lifecycleState).toBe(PLACE_STATE.ACTIVE);
  });

  // The whole point of withholding rather than deleting: a place that disappears
  // for a source-coverage gap and returns keeps the demand recorded against it.
  it('preserves fields the module records against the place', () => {
    const place = applyPresentCycle({
      placeId: 'p_1',
      lifecycleState: PLACE_STATE.RETIRED,
      stateBeforeDemotion: PLACE_STATE.ACTIVE,
      interestCount: 12
    });
    expect(place.placeId).toBe('p_1');
    expect(place.interestCount).toBe(12);
  });

  it('round-trips absence and return without losing the original state', () => {
    let place = { placeId: 'p_1', lifecycleState: PLACE_STATE.ACTIVE, absenceCounter: 0 };
    for (let i = 0; i < RETIRED_AFTER_CYCLES; i += 1) place = applyAbsentCycle(place);
    expect(place.lifecycleState).toBe(PLACE_STATE.RETIRED);

    place = applyPresentCycle(place);
    expect(place.lifecycleState).toBe(PLACE_STATE.ACTIVE);
  });
});

describe('isRecommendable / selectRecommendable - FR-6.4 withholding', () => {
  it('withholds Retired places', () => {
    expect(isRecommendable({ lifecycleState: PLACE_STATE.RETIRED })).toBe(false);
  });

  it('withholds places still awaiting enrichment', () => {
    expect(isRecommendable({ lifecycleState: PLACE_STATE.PENDING_ENRICHMENT })).toBe(false);
  });

  // Stale is ranked down, not hidden - it is still a real place.
  it('keeps Active, Provisional and Stale places recommendable', () => {
    expect(isRecommendable({ lifecycleState: PLACE_STATE.ACTIVE })).toBe(true);
    expect(isRecommendable({ lifecycleState: PLACE_STATE.PROVISIONAL })).toBe(true);
    expect(isRecommendable({ lifecycleState: PLACE_STATE.STALE })).toBe(true);
  });

  it('filters a mixed catalogue down to the recommendable set', () => {
    const selected = selectRecommendable([
      { placeId: 'a', lifecycleState: PLACE_STATE.ACTIVE },
      { placeId: 'b', lifecycleState: PLACE_STATE.RETIRED },
      { placeId: 'c', lifecycleState: PLACE_STATE.STALE },
      { placeId: 'd', lifecycleState: PLACE_STATE.PENDING_ENRICHMENT }
    ]);
    expect(selected.map((p) => p.placeId)).toEqual(['a', 'c']);
  });

  it('returns an empty set for an empty catalogue', () => {
    expect(selectRecommendable([])).toEqual([]);
  });
});
