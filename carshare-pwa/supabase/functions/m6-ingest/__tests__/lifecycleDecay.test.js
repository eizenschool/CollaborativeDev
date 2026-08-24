// Boundary Value Analysis for the sweep's decay step - mirrors
// PlaceLifecycle.test.js's coverage of the same FR-6.3/6.4/6.5 thresholds,
// reimplemented locally so the Deno function can import it. The thresholds
// are imported rather than hardcoded, so moving one cannot leave a passing
// suite asserting the old number.
import { describe, it, expect } from 'vitest';
import { applyAbsentCycle, RETIRED_AFTER_CYCLES, STALE_AFTER_CYCLES } from '../lifecycleDecay.ts';

describe('applyAbsentCycle', () => {
  it('increments the counter without changing state below the Stale threshold', () => {
    const result = applyAbsentCycle({
      absenceCounter: 0, lifecycleState: 'Active', stateBeforeDemotion: null
    });
    expect(result).toEqual({
      absenceCounter: 1, lifecycleState: 'Active', stateBeforeDemotion: null
    });
  });

  it('demotes to Stale at exactly the threshold and captures the prior state', () => {
    const result = applyAbsentCycle({
      absenceCounter: STALE_AFTER_CYCLES - 1, lifecycleState: 'Active', stateBeforeDemotion: null
    });
    expect(result.lifecycleState).toBe('Stale');
    expect(result.absenceCounter).toBe(STALE_AFTER_CYCLES);
    expect(result.stateBeforeDemotion).toBe('Active');
  });

  it('demotes Provisional to Stale and captures Provisional, not Active', () => {
    const result = applyAbsentCycle({
      absenceCounter: STALE_AFTER_CYCLES - 1, lifecycleState: 'Provisional', stateBeforeDemotion: null
    });
    expect(result.lifecycleState).toBe('Stale');
    expect(result.stateBeforeDemotion).toBe('Provisional');
  });

  it('does not re-capture stateBeforeDemotion on a second absent cycle once already Stale', () => {
    const result = applyAbsentCycle({
      absenceCounter: STALE_AFTER_CYCLES, lifecycleState: 'Stale', stateBeforeDemotion: 'Active'
    });
    expect(result.lifecycleState).toBe('Stale');
    expect(result.stateBeforeDemotion).toBe('Active');
  });

  it('retires at exactly the Retired threshold', () => {
    const result = applyAbsentCycle({
      absenceCounter: RETIRED_AFTER_CYCLES - 1, lifecycleState: 'Stale', stateBeforeDemotion: 'Provisional'
    });
    expect(result.lifecycleState).toBe('Retired');
    expect(result.absenceCounter).toBe(RETIRED_AFTER_CYCLES);
    // Retired keeps whatever was already captured rather than overwriting it -
    // there is no "state before Retired" distinct from "state before Stale".
    expect(result.stateBeforeDemotion).toBe('Provisional');
  });

  it('keeps incrementing the counter for an already-Retired place without changing state', () => {
    const result = applyAbsentCycle({
      absenceCounter: RETIRED_AFTER_CYCLES + 5, lifecycleState: 'Retired', stateBeforeDemotion: 'Active'
    });
    expect(result.lifecycleState).toBe('Retired');
    expect(result.absenceCounter).toBe(RETIRED_AFTER_CYCLES + 6);
    expect(result.stateBeforeDemotion).toBe('Active');
  });

  it('tolerates a missing absenceCounter as zero', () => {
    const result = applyAbsentCycle({
      absenceCounter: undefined, lifecycleState: 'Active', stateBeforeDemotion: null
    });
    expect(result.absenceCounter).toBe(1);
  });
});
