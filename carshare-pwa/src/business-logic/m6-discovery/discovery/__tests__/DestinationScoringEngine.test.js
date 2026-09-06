// Boundary Value Analysis - FR-6.18 scoring / FR-6.19 presentation rule.
//
// Each signal is pinned on its own axis before the composite is exercised,
// because a 2dp composite can round two genuinely different inputs onto the same
// number - exactly what a boundary case exists to tell apart.
//
// Makes zero API calls: every input is a literal, per the project rule that
// automated tests never touch Google.

import { describe, expect, it } from 'vitest';
import {
  applyPresentationRule,
  computeAccessibility,
  computeDemandConvergenceSignal,
  computeDesirability,
  computeHeadroomSignal,
  computeJourneyCostSignal,
  computeQualitySignal,
  computeSeatHeadroomSignal,
  maxUnservedAccessibility,
  rankCandidates,
  scoreCandidate,
  DestinationScoringEngine
} from '../DestinationScoringEngine.js';
import {
  ACCESSIBILITY_WEIGHTS,
  DESIRABILITY_WEIGHTS,
  PRESENTATION,
  PRESENTATION_THRESHOLDS,
  REVIEW_CONFIDENCE_SATURATION
} from '../constants.js';

describe('weighting integrity', () => {
  it('Desirability weights sum to exactly 1.0', () => {
    const total = Object.values(DESIRABILITY_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('Accessibility weights sum to exactly 1.0', () => {
    const total = Object.values(ACCESSIBILITY_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  // The local-economy signal must stay below the gap between the two
  // desirability thresholds, so independence can reorder comparable candidates
  // but cannot carry a poorly matched one across a presentation boundary.
  it('keeps local economy below the desirability threshold gap', () => {
    const gap = PRESENTATION_THRESHOLDS.unservedDesirable - PRESENTATION_THRESHOLDS.desirable;
    expect(DESIRABILITY_WEIGHTS.local).toBeLessThan(gap);
  });
});

describe('THE CENTRAL PREMISE: an unserved destination can never reach the primary list', () => {
  // This is the module's whole argument - filling an existing empty seat must
  // outrank creating a new journey - expressed as arithmetic rather than as an
  // appended preference. If a weight change ever breaks this, it must fail here.
  it('bounds unserved accessibility strictly below the primary threshold', () => {
    expect(maxUnservedAccessibility()).toBeLessThan(PRESENTATION_THRESHOLDS.accessible);
  });

  it('caps unserved accessibility at journeyCost + demandConvergence', () => {
    expect(maxUnservedAccessibility())
      .toBeCloseTo(ACCESSIBILITY_WEIGHTS.journeyCost + ACCESSIBILITY_WEIGHTS.demandConvergence, 10);
  });

  it('withholds the primary list even from a perfect unserved candidate', () => {
    // Zero distance, maximum converged demand, flawless desirability, no ride.
    const perfectButUnserved = scoreCandidate({
      placeId: 'p_perfect',
      affinity: 1, season: 1, local: 1,
      rating: 5, reviewCount: 10_000, peerMaxReviewCount: 10_000,
      rides: [],
      distanceKm: 0, maxCandidateDistanceKm: 100,
      interestedUserCount: 999
    });

    expect(perfectButUnserved.accessibility).toBeLessThanOrEqual(maxUnservedAccessibility());
    expect(perfectButUnserved.presentation).not.toBe(PRESENTATION.PRIMARY);
    expect(perfectButUnserved.presentation).toBe(PRESENTATION.UNSERVED);
  });

  it('lets a barely-adequate served candidate outrank it', () => {
    const servedButMediocre = scoreCandidate({
      placeId: 'p_served',
      affinity: 0.5, season: 0.7, local: 1,
      rating: 4, reviewCount: 10, peerMaxReviewCount: 100,
      rides: [{ seatsTotal: 4, seatsAvailable: 4 }],
      distanceKm: 50, maxCandidateDistanceKm: 100,
      interestedUserCount: 0
    });
    const perfectButUnserved = scoreCandidate({
      placeId: 'p_perfect',
      affinity: 1, season: 1, local: 1,
      rating: 5, reviewCount: 10_000, peerMaxReviewCount: 10_000,
      rides: [],
      distanceKm: 0, maxCandidateDistanceKm: 100,
      interestedUserCount: 999
    });

    expect(servedButMediocre.accessibility).toBeGreaterThan(perfectButUnserved.accessibility);
    expect(servedButMediocre.presentation).toBe(PRESENTATION.PRIMARY);
  });
});

describe('computeQualitySignal - BVA on review confidence saturation', () => {
  const sat = REVIEW_CONFIDENCE_SATURATION;

  it('scores below full confidence one review short of saturation', () => {
    expect(computeQualitySignal({ rating: 5, reviewCount: sat - 1 })).toBeLessThan(1);
  });

  it('reaches full confidence exactly at saturation', () => {
    expect(computeQualitySignal({ rating: 5, reviewCount: sat })).toBe(1);
  });

  it('does not exceed full confidence past saturation', () => {
    expect(computeQualitySignal({ rating: 5, reviewCount: sat + 1 })).toBe(1);
  });

  // The documented worked example: thin data must not beat deep data.
  it('ranks 5.0-on-two-reviews below 4.3-on-eight-thousand', () => {
    const thin = computeQualitySignal({ rating: 5.0, reviewCount: 2 });
    const deep = computeQualitySignal({ rating: 4.3, reviewCount: 8000 });
    expect(thin).toBeCloseTo(0.2, 10);
    expect(deep).toBeCloseTo(0.825, 10);
    expect(thin).toBeLessThan(deep);
  });

  it('maps the rating scale ends onto 0 and 1', () => {
    expect(computeQualitySignal({ rating: 1, reviewCount: sat })).toBe(0);
    expect(computeQualitySignal({ rating: 5, reviewCount: sat })).toBe(1);
    expect(computeQualitySignal({ rating: 3, reviewCount: sat })).toBeCloseTo(0.5, 10);
  });

  it('scores zero when no rating exists rather than throwing', () => {
    expect(computeQualitySignal({ reviewCount: 100 })).toBe(0);
    expect(computeQualitySignal({})).toBe(0);
  });
});

describe('computeHeadroomSignal', () => {
  it('gives the most-reviewed peer no headroom', () => {
    expect(computeHeadroomSignal({ reviewCount: 500, peerMaxReviewCount: 500 })).toBe(0);
  });

  it('gives an unreviewed place full headroom', () => {
    expect(computeHeadroomSignal({ reviewCount: 0, peerMaxReviewCount: 500 })).toBe(1);
  });

  it('scales linearly between the two', () => {
    expect(computeHeadroomSignal({ reviewCount: 250, peerMaxReviewCount: 500 })).toBeCloseTo(0.5, 10);
  });

  it('gives full headroom when the peer group has no reviews at all', () => {
    expect(computeHeadroomSignal({ reviewCount: 0, peerMaxReviewCount: 0 })).toBe(1);
    expect(computeHeadroomSignal({})).toBe(1);
  });
});

describe('computeSeatHeadroomSignal', () => {
  it('scores zero when no ride serves the destination', () => {
    expect(computeSeatHeadroomSignal([])).toBe(0);
    expect(computeSeatHeadroomSignal(undefined)).toBe(0);
  });

  // The greatest ratio, not the sum: what matters is whether any single ride can
  // take this traveller, since they cannot combine two rides.
  it('takes the greatest ratio among serving rides, not the total', () => {
    const signal = computeSeatHeadroomSignal([
      { seatsTotal: 4, seatsAvailable: 1 },
      { seatsTotal: 2, seatsAvailable: 2 },
      { seatsTotal: 8, seatsAvailable: 2 }
    ]);
    expect(signal).toBe(1);
  });

  it('ignores fully booked rides', () => {
    expect(computeSeatHeadroomSignal([{ seatsTotal: 4, seatsAvailable: 0 }])).toBe(0);
  });

  it('ignores malformed ride rows rather than throwing', () => {
    const signal = computeSeatHeadroomSignal([
      { seatsTotal: 0, seatsAvailable: 3 },
      { seatsTotal: 4, seatsAvailable: 2 },
      null
    ]);
    expect(signal).toBeCloseTo(0.5, 10);
  });
});

describe('computeJourneyCostSignal', () => {
  it('scores the furthest candidate at zero', () => {
    expect(computeJourneyCostSignal({ distanceKm: 100, maxCandidateDistanceKm: 100 })).toBe(0);
  });

  it('scores a zero-distance candidate at one', () => {
    expect(computeJourneyCostSignal({ distanceKm: 0, maxCandidateDistanceKm: 100 })).toBe(1);
  });

  it('floors at zero rather than going negative beyond the maximum', () => {
    expect(computeJourneyCostSignal({ distanceKm: 500, maxCandidateDistanceKm: 100 })).toBe(0);
  });

  it('returns full score when the candidate set has no spread', () => {
    expect(computeJourneyCostSignal({ distanceKm: 10, maxCandidateDistanceKm: 0 })).toBe(1);
  });
});

describe('computeDemandConvergenceSignal - BVA on saturation at four users', () => {
  it('scores zero with nobody interested', () => {
    expect(computeDemandConvergenceSignal(0)).toBe(0);
  });

  it('scores below full one user short of saturation', () => {
    expect(computeDemandConvergenceSignal(3)).toBeCloseTo(0.75, 10);
  });

  it('saturates exactly at four', () => {
    expect(computeDemandConvergenceSignal(4)).toBe(1);
  });

  it('does not exceed full past saturation', () => {
    expect(computeDemandConvergenceSignal(400)).toBe(1);
  });
});

describe('composite scores', () => {
  it('returns 1.00 for D when every signal is maximal', () => {
    expect(computeDesirability({ affinity: 1, season: 1, quality: 1, headroom: 1, local: 1 }).score)
      .toBe(1);
  });

  it('returns 1.00 for A when every signal is maximal', () => {
    expect(computeAccessibility({ seatHeadroom: 1, journeyCost: 1, demandConvergence: 1 }).score)
      .toBe(1);
  });

  it('applies each weight to its own axis', () => {
    expect(computeDesirability({ affinity: 1 }).score).toBeCloseTo(DESIRABILITY_WEIGHTS.affinity, 10);
    expect(computeAccessibility({ seatHeadroom: 1 }).score)
      .toBeCloseTo(ACCESSIBILITY_WEIGHTS.seatHeadroom, 10);
  });

  it('clamps out-of-range signals instead of letting them skew the total', () => {
    expect(computeDesirability({ affinity: 9, season: 9, quality: 9, headroom: 9, local: 9 }).score)
      .toBe(1);
    expect(computeAccessibility({ seatHeadroom: -5, journeyCost: -5, demandConvergence: -5 }).score)
      .toBe(0);
  });
});

describe('applyPresentationRule - BVA on all three thresholds', () => {
  const { accessible, desirable, unservedDesirable } = PRESENTATION_THRESHOLDS;

  it('is inclusive at the accessibility boundary', () => {
    expect(applyPresentationRule({ accessibility: accessible - 0.01, desirability: 1 }))
      .toBe(PRESENTATION.UNSERVED);
    expect(applyPresentationRule({ accessibility: accessible, desirability: 1 }))
      .toBe(PRESENTATION.PRIMARY);
    expect(applyPresentationRule({ accessibility: accessible + 0.01, desirability: 1 }))
      .toBe(PRESENTATION.PRIMARY);
  });

  it('is inclusive at the desirability boundary within the primary list', () => {
    expect(applyPresentationRule({ accessibility: 0.9, desirability: desirable - 0.01 }))
      .toBe(PRESENTATION.PRIMARY_BELOW_THRESHOLD);
    expect(applyPresentationRule({ accessibility: 0.9, desirability: desirable }))
      .toBe(PRESENTATION.PRIMARY);
    expect(applyPresentationRule({ accessibility: 0.9, desirability: desirable + 0.01 }))
      .toBe(PRESENTATION.PRIMARY);
  });

  it('is inclusive at the unserved desirability boundary', () => {
    expect(applyPresentationRule({ accessibility: 0.1, desirability: unservedDesirable - 0.01 }))
      .toBe(PRESENTATION.WITHHELD);
    expect(applyPresentationRule({ accessibility: 0.1, desirability: unservedDesirable }))
      .toBe(PRESENTATION.UNSERVED);
    expect(applyPresentationRule({ accessibility: 0.1, desirability: unservedDesirable + 0.01 }))
      .toBe(PRESENTATION.UNSERVED);
  });

  it('covers all four quadrants', () => {
    expect(applyPresentationRule({ accessibility: 0.8, desirability: 0.8 })).toBe(PRESENTATION.PRIMARY);
    expect(applyPresentationRule({ accessibility: 0.8, desirability: 0.2 }))
      .toBe(PRESENTATION.PRIMARY_BELOW_THRESHOLD);
    expect(applyPresentationRule({ accessibility: 0.2, desirability: 0.8 })).toBe(PRESENTATION.UNSERVED);
    expect(applyPresentationRule({ accessibility: 0.2, desirability: 0.2 })).toBe(PRESENTATION.WITHHELD);
  });
});

describe('rankCandidates', () => {
  const base = {
    affinity: 0.5, season: 0.7, local: 1,
    rating: 4.5, reviewCount: 100, peerMaxReviewCount: 200,
    distanceKm: 20, maxCandidateDistanceKm: 100
  };

  it('orders desirable served candidates above less desirable ones', () => {
    const { primary } = rankCandidates([
      { ...base, placeId: 'low', affinity: 0, season: 0.3, local: 0, rating: 2, reviewCount: 3,
        rides: [{ seatsTotal: 4, seatsAvailable: 4 }] },
      { ...base, placeId: 'high', affinity: 1, season: 1,
        rides: [{ seatsTotal: 4, seatsAvailable: 4 }] }
    ]);

    expect(primary[0].placeId).toBe('high');
    expect(primary.at(-1).placeId).toBe('low');
  });

  it('separates served, unserved, and withheld candidates', () => {
    const { primary, unserved, withheld } = rankCandidates([
      { ...base, placeId: 'served', rides: [{ seatsTotal: 4, seatsAvailable: 4 }] },
      { ...base, placeId: 'wanted', affinity: 1, season: 1, rides: [] },
      { ...base, placeId: 'ignored', affinity: 0, season: 0.3, local: 0, rating: 1,
        reviewCount: 1, rides: [] }
    ]);

    expect(primary.map((c) => c.placeId)).toEqual(['served']);
    expect(unserved.map((c) => c.placeId)).toEqual(['wanted']);
    expect(withheld.map((c) => c.placeId)).toEqual(['ignored']);
  });

  // The unserved section exists to show a prospective Host where a ride would be
  // filled, so demand has to break ties there rather than proximity.
  it('breaks unserved ties on converged demand', () => {
    const { unserved } = rankCandidates([
      { ...base, placeId: 'quiet', affinity: 1, season: 1, rides: [], interestedUserCount: 0 },
      { ...base, placeId: 'wanted', affinity: 1, season: 1, rides: [], interestedUserCount: 4 }
    ]);

    expect(unserved[0].placeId).toBe('wanted');
  });

  it('reports whether each candidate is served by a ride', () => {
    const { primary, unserved } = rankCandidates([
      { ...base, placeId: 'served', rides: [{ seatsTotal: 4, seatsAvailable: 4 }] },
      { ...base, placeId: 'wanted', affinity: 1, season: 1, rides: [] }
    ]);

    expect(primary[0].servedByRide).toBe(true);
    expect(unserved[0].servedByRide).toBe(false);
  });

  // Being served by a ride is necessary for the primary list but not sufficient.
  // A half-full ride to a distant place nobody else wants contributes only
  // 0.5*0.55 + 0.8*0.30 = 0.515, which is below the threshold - so seat headroom
  // has to be genuinely good, not merely non-zero.
  it('does not promote a served candidate on seat headroom alone', () => {
    const { primary, withheld } = rankCandidates([
      { ...base, placeId: 'half-full-far', rides: [{ seatsTotal: 4, seatsAvailable: 2 }] }
    ]);

    expect(primary).toHaveLength(0);
    expect(withheld[0].accessibility).toBeLessThan(PRESENTATION_THRESHOLDS.accessible);
  });

  it('survives an empty candidate set', () => {
    expect(rankCandidates([])).toEqual({ primary: [], unserved: [], withheld: [] });
  });

  it('exposes the per-signal breakdown for explainability', () => {
    const [candidate] = rankCandidates([
      { ...base, placeId: 'x', rides: [{ seatsTotal: 4, seatsAvailable: 4 }] }
    ]).primary;

    expect(Object.keys(candidate.signals.desirability).sort())
      .toEqual(['affinity', 'headroom', 'local', 'quality', 'season']);
    expect(Object.keys(candidate.signals.accessibility).sort())
      .toEqual(['demandConvergence', 'journeyCost', 'seatHeadroom']);
  });

  it('keeps every score within the 0.00-1.00 scale', () => {
    const { primary, unserved, withheld } = rankCandidates([
      { ...base, placeId: 'a', rides: [{ seatsTotal: 4, seatsAvailable: 4 }] },
      { ...base, placeId: 'b', rides: [] },
      { placeId: 'c', rides: [] }
    ]);

    for (const c of [...primary, ...unserved, ...withheld]) {
      expect(c.desirability).toBeGreaterThanOrEqual(0);
      expect(c.desirability).toBeLessThanOrEqual(1);
      expect(c.accessibility).toBeGreaterThanOrEqual(0);
      expect(c.accessibility).toBeLessThanOrEqual(1);
    }
  });

  it('survives a candidate with no data at all without throwing', () => {
    const result = scoreCandidate({});
    expect(Number.isFinite(result.desirability)).toBe(true);
    expect(Number.isFinite(result.accessibility)).toBe(true);
  });
});

describe('exported surface', () => {
  it('exposes the thresholds the presentation rule turns on', () => {
    expect(DestinationScoringEngine.thresholds).toBe(PRESENTATION_THRESHOLDS);
  });
});
