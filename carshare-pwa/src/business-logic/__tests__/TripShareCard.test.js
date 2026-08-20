import { describe, expect, it } from 'vitest';
import {
  CARD_FORMATS,
  CARD_THEMES,
  DEFAULT_FORMAT_ID,
  DEFAULT_THEME_ID,
  buildShareContent,
  buildTextShareTargets,
  canShareReport,
  filenameFor,
  formatById,
  themeById,
  treesEquivalent
} from '../TripShareCard.js';

function report(overrides = {}) {
  return {
    year: 2026, month: 7, hasData: true,
    completedTrips: 2, totalDistanceKm: 358, passengersCarried: 1, totalCarbonSavedKg: 43,
    trips: [],
    ...overrides
  };
}

describe('Module 5 share card eligibility', () => {
  it('refuses a month with nothing to show', () => {
    expect(canShareReport(report({ hasData: false, completedTrips: 0 }))).toBe(false);
    expect(canShareReport(null)).toBe(false);
    expect(buildShareContent(report({ hasData: false, completedTrips: 0 }))).toBeNull();
  });

  it('accepts a month with at least one completed trip', () => {
    expect(canShareReport(report())).toBe(true);
  });
});

describe('Module 5 share card content', () => {
  it('leads with the carbon figure and the month', () => {
    const card = buildShareContent(report(), { userName: 'Jamie Delacroix' });
    expect(card.monthLabel).toBe('August 2026');
    expect(card.headline).toBe('43');
    expect(card.headlineUnit).toBe('kg CO₂ saved');
    expect(card.byline).toBe("Jamie Delacroix · Let's Tumpang");
  });

  it('falls back to the app name when the user has none', () => {
    expect(buildShareContent(report()).byline).toBe("Let's Tumpang");
  });

  it('agrees in number with the figures it quotes', () => {
    const one = buildShareContent(report({ completedTrips: 1, passengersCarried: 1 }));
    expect(one.stats[0].label).toBe('shared trip');
    expect(one.stats[2].label).toBe('passenger carried');

    const many = buildShareContent(report({ completedTrips: 4, passengersCarried: 3 }));
    expect(many.stats[0].label).toBe('shared trips');
    expect(many.stats[2].label).toBe('passengers carried');
  });

  it('only claims the tree comparison once it rounds to at least one', () => {
    expect(treesEquivalent(43)).toBe(2);
    expect(treesEquivalent(5)).toBe(0);
    // 5 kg is a real saving, so the card says something else rather than "0 trees".
    expect(buildShareContent(report({ totalCarbonSavedKg: 5 })).footnote).not.toMatch(/0 trees/);
    expect(buildShareContent(report()).footnote).toMatch(/about 2 trees/);
  });

  it('names the file by the month it covers', () => {
    expect(buildShareContent(report({ year: 2026, month: 0 })).filename)
      .toBe('lets-tumpang-impact-2026-01.png');
  });

  it('writes share text that stands alone without the image', () => {
    const card = buildShareContent(report());
    expect(card.shareText).toContain('43 kg');
    expect(card.shareText).toContain('August 2026');
    expect(card.shareText).toContain('358 km');
  });
});

describe('Module 5 share card themes', () => {
  it('offers palettes and resolves the default', () => {
    expect(CARD_THEMES.length).toBeGreaterThan(1);
    expect(themeById(DEFAULT_THEME_ID).id).toBe(DEFAULT_THEME_ID);
  });

  it('falls back to the first palette for an unknown id', () => {
    expect(themeById('no-such-theme')).toEqual(CARD_THEMES[0]);
    expect(themeById(undefined)).toEqual(CARD_THEMES[0]);
  });

  it('gives every palette a gradient and a swatch', () => {
    for (const theme of CARD_THEMES) {
      expect(theme.from).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(theme.to).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(theme.swatch).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(theme.name).toBeTruthy();
    }
  });
});

describe('Module 5 text share targets', () => {
  it('builds nothing without a card', () => {
    expect(buildTextShareTargets(null)).toEqual([]);
  });

  it('carries the share text, url-encoded, to each target', () => {
    const card = buildShareContent(report());
    const targets = buildTextShareTargets(card);
    expect(targets.map((t) => t.id)).toEqual(['whatsapp', 'telegram', 'x']);
    for (const target of targets) {
      expect(target.href).toContain(encodeURIComponent('43 kg'));
      expect(target.href.startsWith('https://')).toBe(true);
    }
  });

  it('does not pretend a link can carry the image', () => {
    // Every href is a plain text intent - no target claims a file parameter.
    for (const target of buildTextShareTargets(buildShareContent(report()))) {
      expect(target.href).not.toMatch(/file|image|attachment/i);
    }
  });
});

describe('Module 5 share card formats', () => {
  it('offers the three ratios the social apps expect', () => {
    expect(CARD_FORMATS.map((f) => f.id)).toEqual(['story', 'post', 'square']);
    expect(formatById(DEFAULT_FORMAT_ID).id).toBe('post');
  });

  it('falls back to Post for an unknown id', () => {
    expect(formatById('billboard').id).toBe('post');
    expect(formatById(undefined).id).toBe('post');
  });

  it('describes each format with real pixel dimensions', () => {
    for (const format of CARD_FORMATS) {
      expect(format.width).toBeGreaterThan(0);
      expect(format.height).toBeGreaterThan(0);
      expect(format.name).toBeTruthy();
    }
    const byId = Object.fromEntries(CARD_FORMATS.map((f) => [f.id, f]));
    expect(byId.story.height).toBeGreaterThan(byId.post.height);
    expect(byId.square.width).toBe(byId.square.height);
  });

  it('names each saved size differently so one does not overwrite another', () => {
    const card = buildShareContent(report());
    const names = CARD_FORMATS.map((f) => filenameFor(card, f.id));
    expect(new Set(names).size).toBe(CARD_FORMATS.length);
    expect(filenameFor(card, 'story')).toBe('lets-tumpang-impact-2026-08-story.png');
    expect(names.every((n) => n.endsWith('.png'))).toBe(true);
  });

  it('builds no filename without a card', () => {
    expect(filenameFor(null, 'post')).toBeNull();
  });
});
