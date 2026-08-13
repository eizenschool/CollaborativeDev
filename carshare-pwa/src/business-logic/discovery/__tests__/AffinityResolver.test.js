// Equivalence Partitioning - FR-6.20 affinity fallback chain: completed trip
// history, then stated travel preferences, then a neutral value.
//
// The three tiers are mutually exclusive and ordered, so each branch gets its own
// partition plus the boundaries between them.

import { describe, expect, it } from 'vitest';
import {
  affinityFromHistory,
  affinityFromStated,
  resolveAffinity,
  AFFINITY_SOURCE
} from '../AffinityResolver.js';
import {
  AFFINITY_NEUTRAL,
  AFFINITY_STATED_OTHER,
  AFFINITY_STATED_PREFERRED,
  CATEGORY
} from '../constants.js';

const trip = (category) => ({ category });

describe('affinityFromHistory', () => {
  it('scores the proportion of completed trips sharing the category', () => {
    const trips = [
      trip(CATEGORY.CULINARY), trip(CATEGORY.CULINARY),
      trip(CATEGORY.HERITAGE), trip(CATEGORY.NATURE)
    ];
    expect(affinityFromHistory(CATEGORY.CULINARY, trips)).toBeCloseTo(0.5, 10);
    expect(affinityFromHistory(CATEGORY.HERITAGE, trips)).toBeCloseTo(0.25, 10);
  });

  it('scores 1.0 where every trip shares the category', () => {
    expect(affinityFromHistory(CATEGORY.NATURE, [trip(CATEGORY.NATURE), trip(CATEGORY.NATURE)]))
      .toBe(1);
  });

  it('scores 0 for a category the user has never visited', () => {
    expect(affinityFromHistory(CATEGORY.EVENT, [trip(CATEGORY.CULINARY)])).toBe(0);
  });

  // A proportion, not a count: a user with 200 trips and one with 4 sit on the
  // same scale.
  it('is independent of how many trips the user has taken', () => {
    const few = [trip(CATEGORY.NATURE), trip(CATEGORY.CULINARY)];
    const many = Array.from({ length: 200 }, (_, i) =>
      trip(i % 2 === 0 ? CATEGORY.NATURE : CATEGORY.CULINARY));
    expect(affinityFromHistory(CATEGORY.NATURE, few))
      .toBeCloseTo(affinityFromHistory(CATEGORY.NATURE, many), 10);
  });

  it('returns null where no history exists, so the caller falls through', () => {
    expect(affinityFromHistory(CATEGORY.NATURE, [])).toBeNull();
    expect(affinityFromHistory(CATEGORY.NATURE, undefined)).toBeNull();
  });
});

describe('affinityFromStated', () => {
  it('scores a named category at full preference', () => {
    expect(affinityFromStated(CATEGORY.HERITAGE, [CATEGORY.HERITAGE, CATEGORY.NATURE]))
      .toBe(AFFINITY_STATED_PREFERRED);
  });

  // Not naming a category is not the same as rejecting it: a first-time user
  // cannot enumerate everything they might enjoy, and zeroing the rest would lock
  // them out of the recommendations most likely to broaden their trip.
  it('scores an unnamed category above zero rather than excluding it', () => {
    const unnamed = affinityFromStated(CATEGORY.CULINARY, [CATEGORY.HERITAGE]);
    expect(unnamed).toBe(AFFINITY_STATED_OTHER);
    expect(unnamed).toBeGreaterThan(0);
    expect(unnamed).toBeLessThan(AFFINITY_STATED_PREFERRED);
  });

  it('returns null where nothing was stated, so the caller falls through', () => {
    expect(affinityFromStated(CATEGORY.NATURE, [])).toBeNull();
    expect(affinityFromStated(CATEGORY.NATURE, undefined)).toBeNull();
  });
});

describe('resolveAffinity - the full fallback chain', () => {
  it('uses trip history when it exists', () => {
    const result = resolveAffinity(CATEGORY.CULINARY, {
      completedTrips: [trip(CATEGORY.CULINARY), trip(CATEGORY.NATURE)],
      preferredCategories: [CATEGORY.HERITAGE]
    });
    expect(result.value).toBeCloseTo(0.5, 10);
    expect(result.source).toBe(AFFINITY_SOURCE.HISTORY);
  });

  // Observed behaviour supersedes a stated intention - a user who says they like
  // nature but completed six culinary trips is described by the trips.
  it('prefers history over stated preferences when both exist', () => {
    const result = resolveAffinity(CATEGORY.NATURE, {
      completedTrips: [trip(CATEGORY.CULINARY)],
      preferredCategories: [CATEGORY.NATURE]
    });
    expect(result.value).toBe(0);
    expect(result.source).toBe(AFFINITY_SOURCE.HISTORY);
  });

  it('falls back to stated preferences with no history', () => {
    const result = resolveAffinity(CATEGORY.NATURE, {
      completedTrips: [],
      preferredCategories: [CATEGORY.NATURE]
    });
    expect(result.value).toBe(AFFINITY_STATED_PREFERRED);
    expect(result.source).toBe(AFFINITY_SOURCE.STATED);
  });

  // UC6.4 A1: the user dismissed the prompt. Recommendations stay available;
  // only the personalisation signal goes neutral.
  it('falls back to neutral with neither history nor preferences', () => {
    const result = resolveAffinity(CATEGORY.NATURE, {});
    expect(result.value).toBe(AFFINITY_NEUTRAL);
    expect(result.source).toBe(AFFINITY_SOURCE.NEUTRAL);
  });

  it('falls back to neutral when called with no context at all', () => {
    const result = resolveAffinity(CATEGORY.NATURE);
    expect(result.value).toBe(AFFINITY_NEUTRAL);
    expect(result.source).toBe(AFFINITY_SOURCE.NEUTRAL);
  });

  it('always reports which tier produced the value', () => {
    const sources = [
      resolveAffinity(CATEGORY.NATURE, { completedTrips: [trip(CATEGORY.NATURE)] }).source,
      resolveAffinity(CATEGORY.NATURE, { preferredCategories: [CATEGORY.NATURE] }).source,
      resolveAffinity(CATEGORY.NATURE, {}).source
    ];
    expect(sources).toEqual([
      AFFINITY_SOURCE.HISTORY, AFFINITY_SOURCE.STATED, AFFINITY_SOURCE.NEUTRAL
    ]);
  });

  it('keeps every tier within the 0-1 scale the scoring engine expects', () => {
    const values = [
      resolveAffinity(CATEGORY.NATURE, { completedTrips: [trip(CATEGORY.NATURE)] }).value,
      resolveAffinity(CATEGORY.CULINARY, { completedTrips: [trip(CATEGORY.NATURE)] }).value,
      resolveAffinity(CATEGORY.NATURE, { preferredCategories: [CATEGORY.NATURE] }).value,
      resolveAffinity(CATEGORY.NATURE, { preferredCategories: [CATEGORY.HERITAGE] }).value,
      resolveAffinity(CATEGORY.NATURE, {}).value
    ];
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});
