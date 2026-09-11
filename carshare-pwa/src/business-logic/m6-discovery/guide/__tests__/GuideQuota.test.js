import { describe, expect, it } from 'vitest';
import { afterSuccessfulGuideTurn, guideQuotaState } from '../GuideQuota.js';

describe('Tumpang Guide successful-turn quotas', () => {
  it.each([
    [4, 5, true, 1],
    [5, 5, false, 0],
    [19, 20, true, 1],
    [20, 20, false, 0]
  ])('checks used=%s against limit=%s', (used, limit, allowed, remaining) => {
    expect(guideQuotaState(used, limit)).toEqual({ allowed, remaining });
  });

  it('decrements only when the caller records a successful recommendation', () => {
    expect(guideQuotaState(2, 5).remaining).toBe(3);
    expect(afterSuccessfulGuideTurn(2, 5)).toEqual({ allowed: true, remaining: 2 });
    expect(afterSuccessfulGuideTurn(5, 5)).toEqual({ allowed: false, remaining: 0 });
  });
});
