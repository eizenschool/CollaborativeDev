// FR-6.17 illustration tier - the poster generator.
//
// Only the deterministic parts are asserted here, not the SVG markup: pinning
// exact geometry would break on any visual refinement without catching a real
// defect. What must hold is that a place always looks like itself, and that two
// places do not look identical.

import { describe, expect, it } from 'vitest';
import { __posterInternals } from '../../../presentation/components/discover/PlacePoster.jsx';
import { CATEGORY } from '../constants.js';

const { hash, rng, PALETTES } = __posterInternals;

const firstDraws = (seed, count = 8) => {
  const next = rng(hash(seed));
  return Array.from({ length: count }, () => next());
};

describe('hash', () => {
  it('is stable for the same input', () => {
    expect(hash('p_cameron')).toBe(hash('p_cameron'));
  });

  it('separates the catalogue ids that actually exist', () => {
    const ids = ['p_georgetown', 'p_jonker', 'p_cameron', 'p_gurney', 'p_kellie', 'p_sekinchan'];
    expect(new Set(ids.map(hash)).size).toBe(ids.length);
  });

  it('separates carousel variants of one place', () => {
    expect(hash('p_cameron::0')).not.toBe(hash('p_cameron::1'));
  });

  it('handles an empty seed without throwing', () => {
    expect(Number.isFinite(hash(''))).toBe(true);
  });
});

describe('rng', () => {
  // A place must look the same on every render and on every device, or the list
  // would reshuffle its own artwork on each navigation.
  it('produces the same sequence for the same seed', () => {
    expect(firstDraws('p_cameron')).toEqual(firstDraws('p_cameron'));
  });

  it('produces a different sequence for a different seed', () => {
    expect(firstDraws('p_cameron')).not.toEqual(firstDraws('p_jonker'));
  });

  it('stays within 0-1 so every derived coordinate lands on the canvas', () => {
    for (const value of firstDraws('p_georgetown', 200)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('does not collapse to a constant', () => {
    expect(new Set(firstDraws('p_jonker', 40)).size).toBeGreaterThan(20);
  });
});

describe('palettes', () => {
  it('covers every destination category', () => {
    for (const category of Object.values(CATEGORY)) {
      expect(PALETTES[category]).toBeDefined();
    }
  });

  it('gives each palette a sky pair and four depth layers', () => {
    for (const palette of Object.values(PALETTES)) {
      expect(palette.sky).toHaveLength(2);
      expect(palette.layers).toHaveLength(4);
      expect(palette.accent).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('uses valid hex throughout', () => {
    for (const palette of Object.values(PALETTES)) {
      for (const colour of [...palette.sky, ...palette.layers]) {
        expect(colour).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });
});
