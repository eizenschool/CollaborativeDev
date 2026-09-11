// Boundary Value Analysis + Equivalence Partitioning - UC6.8 CALCULATE DISPUTE
// SCORE / UC6.9 ROUTE DISPUTE.
//
// Each signal axis is pinned on its own before the composite is exercised, because
// a 2dp composite score can round two genuinely different inputs onto the same
// number - which would hide exactly the boundary a BVA case exists to catch.

import { describe, expect, it } from 'vitest';
import {
  computeConfidenceScore,
  decideAutoOutcome,
  normaliseGpsSignal,
  normaliseHistorySignal,
  normaliseReputationSignal,
  normaliseTimestampSignal,
  routeDispute,
  scoreDispute,
  DisputeConfidenceEngine
} from '../DisputeConfidenceEngine.js';
import {
  AUTO_RESOLVE_THRESHOLD,
  DISPUTE_OUTCOME,
  EXCHANGE_DEFAULT_HOURS,
  EXCHANGE_OUTCOME,
  GPS_RESULT
} from '../constants.js';

const HOUR_MS = 3600000;
const BASE = new Date('2026-08-18T09:00:00.000Z');
const hoursAfterBase = (h) => new Date(BASE.getTime() + h * HOUR_MS).toISOString();

describe('weighting', () => {
  it('sums to exactly 1.0 so the composite stays on the 0.00-1.00 scale', () => {
    const total = Object.values(DisputeConfidenceEngine.weights).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });
});

describe('normaliseGpsSignal - equivalence partitions', () => {
  it('scores a clean cross-check at full confidence', () => {
    expect(normaliseGpsSignal(GPS_RESULT.PASS)).toBe(1);
  });

  it('scores a mismatch at zero', () => {
    expect(normaliseGpsSignal(GPS_RESULT.MISMATCH)).toBe(0);
  });

  // UC6.3 A2 - an unreachable GPS service is not evidence of wrongdoing, so it must
  // land strictly between a pass and a mismatch rather than alongside either.
  it('treats an unavailable reading as neutral, not as a mismatch', () => {
    const unavailable = normaliseGpsSignal(GPS_RESULT.UNAVAILABLE);
    expect(unavailable).toBe(0.5);
    expect(unavailable).toBeGreaterThan(normaliseGpsSignal(GPS_RESULT.MISMATCH));
    expect(unavailable).toBeLessThan(normaliseGpsSignal(GPS_RESULT.PASS));
  });

  it('treats a never-captured reading the same as unavailable', () => {
    expect(normaliseGpsSignal(null)).toBe(0.5);
    expect(normaliseGpsSignal(undefined)).toBe(0.5);
  });
});

describe('normaliseTimestampSignal - BVA on the 48-hour span', () => {
  it('scores simultaneous confirmations at full confidence', () => {
    expect(
      normaliseTimestampSignal({ hostAt: hoursAfterBase(0), clientAt: hoursAfterBase(0) })
    ).toBe(1);
  });

  it('still scores above zero just inside the 48-hour span', () => {
    const signal = normaliseTimestampSignal({
      hostAt: hoursAfterBase(0),
      clientAt: hoursAfterBase(EXCHANGE_DEFAULT_HOURS - 0.05)
    });
    expect(signal).toBeGreaterThan(0);
  });

  it('reaches exactly zero at a 48-hour gap', () => {
    expect(
      normaliseTimestampSignal({
        hostAt: hoursAfterBase(0),
        clientAt: hoursAfterBase(EXCHANGE_DEFAULT_HOURS)
      })
    ).toBe(0);
  });

  it('clamps to zero beyond 48 hours rather than going negative', () => {
    expect(
      normaliseTimestampSignal({
        hostAt: hoursAfterBase(0),
        clientAt: hoursAfterBase(EXCHANGE_DEFAULT_HOURS + 12)
      })
    ).toBe(0);
  });

  it('is direction-agnostic - who answered first does not matter', () => {
    const forward = normaliseTimestampSignal({
      hostAt: hoursAfterBase(0),
      clientAt: hoursAfterBase(6)
    });
    const reverse = normaliseTimestampSignal({
      hostAt: hoursAfterBase(6),
      clientAt: hoursAfterBase(0)
    });
    expect(forward).toBe(reverse);
  });

  // UC6.22 - a confirmation the system had to default in is silence, not evidence.
  it('scores zero when either side was defaulted in, however close the timestamps', () => {
    const timestamps = { hostAt: hoursAfterBase(0), clientAt: hoursAfterBase(0) };
    expect(normaliseTimestampSignal({ ...timestamps, hostDefaulted: true })).toBe(0);
    expect(normaliseTimestampSignal({ ...timestamps, clientDefaulted: true })).toBe(0);
  });

  it('scores zero when a confirmation is missing entirely', () => {
    expect(normaliseTimestampSignal({ hostAt: hoursAfterBase(0), clientAt: null })).toBe(0);
    expect(normaliseTimestampSignal({})).toBe(0);
  });
});

describe('normaliseReputationSignal', () => {
  it('scores two spotless parties at full confidence', () => {
    expect(normaliseReputationSignal({ hostReputation: 100, clientReputation: 100 })).toBe(1);
  });

  it('scores two zero-reputation parties at zero', () => {
    expect(normaliseReputationSignal({ hostReputation: 0, clientReputation: 0 })).toBe(0);
  });

  it('averages the two parties rather than taking either alone', () => {
    expect(normaliseReputationSignal({ hostReputation: 100, clientReputation: 0 })).toBe(0.5);
  });

  it('defaults missing reputation to zero instead of throwing', () => {
    expect(normaliseReputationSignal({})).toBe(0);
  });
});

describe('normaliseHistorySignal - BVA on the dispute-history ceiling', () => {
  const ceiling = DisputeConfidenceEngine.disputeHistoryCeiling;

  it('scores a clean history at full confidence', () => {
    expect(normaliseHistorySignal({ hostPriorDisputes: 0, clientPriorDisputes: 0 })).toBe(1);
  });

  it('still scores above zero one dispute short of the ceiling', () => {
    expect(
      normaliseHistorySignal({ hostPriorDisputes: ceiling - 1, clientPriorDisputes: 0 })
    ).toBeGreaterThan(0);
  });

  it('reaches zero exactly at the ceiling', () => {
    expect(normaliseHistorySignal({ hostPriorDisputes: ceiling, clientPriorDisputes: 0 })).toBe(0);
  });

  it('clamps to zero past the ceiling rather than going negative', () => {
    expect(
      normaliseHistorySignal({ hostPriorDisputes: ceiling, clientPriorDisputes: ceiling })
    ).toBe(0);
  });

  it('counts both parties combined, not just the worse one', () => {
    const combined = normaliseHistorySignal({ hostPriorDisputes: 2, clientPriorDisputes: 2 });
    const single = normaliseHistorySignal({ hostPriorDisputes: 2, clientPriorDisputes: 0 });
    expect(combined).toBeLessThan(single);
  });
});

describe('computeConfidenceScore', () => {
  it('returns 1.00 when every signal is at full confidence', () => {
    expect(computeConfidenceScore({ gps: 1, reputation: 1, timestamp: 1, history: 1 })).toBe(1);
  });

  it('returns 0.00 when every signal is at zero', () => {
    expect(computeConfidenceScore({ gps: 0, reputation: 0, timestamp: 0, history: 0 })).toBe(0);
  });

  it('applies each weight to its own axis', () => {
    const { weights } = DisputeConfidenceEngine;
    expect(computeConfidenceScore({ gps: 1, reputation: 0, timestamp: 0, history: 0 }))
      .toBeCloseTo(weights.gps, 10);
    expect(computeConfidenceScore({ gps: 0, reputation: 1, timestamp: 0, history: 0 }))
      .toBeCloseTo(weights.reputation, 10);
  });

  it('clamps out-of-range signals instead of letting them skew the total', () => {
    expect(computeConfidenceScore({ gps: 99, reputation: 99, timestamp: 99, history: 99 })).toBe(1);
    expect(computeConfidenceScore({ gps: -5, reputation: -5, timestamp: -5, history: -5 })).toBe(0);
  });
});

describe('routeDispute - BVA on the 0.75 auto-resolve threshold', () => {
  it('routes just below the threshold to manual review', () => {
    expect(routeDispute(AUTO_RESOLVE_THRESHOLD - 0.01)).toBe('manual-review');
  });

  // UC6.9 reads "score >= threshold", so the boundary itself auto-resolves.
  it('auto-resolves exactly at the threshold', () => {
    expect(routeDispute(AUTO_RESOLVE_THRESHOLD)).toBe('auto-resolve');
  });

  it('auto-resolves just above the threshold', () => {
    expect(routeDispute(AUTO_RESOLVE_THRESHOLD + 0.01)).toBe('auto-resolve');
  });

  it('routes the extremes as expected', () => {
    expect(routeDispute(0)).toBe('manual-review');
    expect(routeDispute(1)).toBe('auto-resolve');
  });
});

describe('scoreDispute - end to end over a whole trip', () => {
  const strongEvidence = {
    pickup: { gpsCheck: GPS_RESULT.PASS },
    exchange: {
      host: EXCHANGE_OUTCOME.FULFILLED,
      hostAt: hoursAfterBase(0),
      client: EXCHANGE_OUTCOME.NOT_FULFILLED,
      clientAt: hoursAfterBase(0.5)
    }
  };
  const strongContext = {
    hostReputation: 84, clientReputation: 78,
    hostPriorDisputes: 0, clientPriorDisputes: 0
  };

  const weakEvidence = {
    pickup: { gpsCheck: GPS_RESULT.MISMATCH },
    exchange: {
      host: EXCHANGE_OUTCOME.FULFILLED,
      hostAt: hoursAfterBase(0),
      client: EXCHANGE_OUTCOME.NOT_FULFILLED,
      clientAt: hoursAfterBase(20)
    }
  };
  const weakContext = {
    hostReputation: 45, clientReputation: 78,
    hostPriorDisputes: 3, clientPriorDisputes: 0
  };

  it('sends a clean, prompt, well-reputed dispute down the auto-resolve path', () => {
    const { score } = scoreDispute(strongEvidence, strongContext);
    expect(score).toBeGreaterThanOrEqual(AUTO_RESOLVE_THRESHOLD);
    expect(routeDispute(score)).toBe('auto-resolve');
  });

  it('sends a GPS-mismatched, slow, dispute-prone case to manual review', () => {
    const { score } = scoreDispute(weakEvidence, weakContext);
    expect(score).toBeLessThan(AUTO_RESOLVE_THRESHOLD);
    expect(routeDispute(score)).toBe('manual-review');
  });

  it('returns the per-signal breakdown so an admin can audit the number', () => {
    const { signals, weights } = scoreDispute(weakEvidence, weakContext);
    expect(Object.keys(signals).sort()).toEqual(['gps', 'history', 'reputation', 'timestamp']);
    expect(signals.gps).toBe(0);
    expect(weights).toEqual(DisputeConfidenceEngine.weights);
  });

  it('keeps every score within the 0.00-1.00 scale', () => {
    for (const [evidence, context] of [[strongEvidence, strongContext], [weakEvidence, weakContext]]) {
      const { score } = scoreDispute(evidence, context);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });

  it('survives a half-populated record without throwing', () => {
    const { score } = scoreDispute({}, {});
    expect(Number.isFinite(score)).toBe(true);
  });
});

describe('decideAutoOutcome - whose claim an auto-resolution adopts', () => {
  const verification = {
    exchange: { host: EXCHANGE_OUTCOME.FULFILLED, client: EXCHANGE_OUTCOME.NOT_FULFILLED }
  };

  it('adopts the host claim when the host has the higher reputation', () => {
    const outcome = decideAutoOutcome(verification, { hostReputation: 90, clientReputation: 50 });
    expect(outcome).toBe(EXCHANGE_OUTCOME.FULFILLED);
  });

  it('adopts the client claim when the client has the higher reputation', () => {
    const outcome = decideAutoOutcome(verification, { hostReputation: 50, clientReputation: 90 });
    expect(outcome).toBe(EXCHANGE_OUTCOME.NOT_FULFILLED);
  });

  // Equal standing gives no basis to prefer either account, so the system declines
  // to guess rather than silently favouring one side.
  it('returns Inconclusive when reputations are tied', () => {
    const outcome = decideAutoOutcome(verification, { hostReputation: 70, clientReputation: 70 });
    expect(outcome).toBe(DISPUTE_OUTCOME.INCONCLUSIVE);
  });

  it('returns Inconclusive when the winning party never actually submitted a claim', () => {
    const outcome = decideAutoOutcome(
      { exchange: { host: null, client: EXCHANGE_OUTCOME.NOT_FULFILLED } },
      { hostReputation: 90, clientReputation: 50 }
    );
    expect(outcome).toBe(DISPUTE_OUTCOME.INCONCLUSIVE);
  });
});
