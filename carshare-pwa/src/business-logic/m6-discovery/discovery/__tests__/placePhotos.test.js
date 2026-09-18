import { describe, expect, it } from 'vitest';
import {
  PHOTO_WIDTH_RAIL, PHOTO_WIDTH_CARD, PHOTO_WIDTH_LARGE
} from '../placePhotos.js';

describe('photo request widths', () => {
  it('keeps the rail, card, and detail image tiers ordered', () => {
    expect(PHOTO_WIDTH_RAIL).toBeLessThan(PHOTO_WIDTH_CARD);
    expect(PHOTO_WIDTH_CARD).toBeLessThan(PHOTO_WIDTH_LARGE);
  });

  it('uses the shared sizes across callers', () => {
    expect(PHOTO_WIDTH_RAIL).toBe(400);
    expect(PHOTO_WIDTH_CARD).toBe(600);
    expect(PHOTO_WIDTH_LARGE).toBe(1200);
  });
});
