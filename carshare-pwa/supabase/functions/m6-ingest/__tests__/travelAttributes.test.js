import { describe, expect, it } from 'vitest';
import { priceLevelNumber, travelAttributesFor } from '../travelAttributes.ts';

describe('Module 6 travel attribute enrichment', () => {
  it('maps Google price levels onto the documented 0-4 hard-filter scale', () => {
    expect(priceLevelNumber('PRICE_LEVEL_FREE')).toBe(0);
    expect(priceLevelNumber('PRICE_LEVEL_MODERATE')).toBe(2);
    expect(priceLevelNumber('PRICE_LEVEL_VERY_EXPENSIVE')).toBe(4);
    expect(priceLevelNumber('UNKNOWN')).toBeNull();
  });

  it('preserves per-field provenance and never guesses missing accessibility', () => {
    const row = travelAttributesFor({
      priceLevel: 'PRICE_LEVEL_INEXPENSIVE',
      regularOpeningHours: { weekdayDescriptions: ['Monday: 9:00 AM – 5:00 PM'] },
      goodForChildren: true,
      parkingOptions: { freeParkingLot: false, paidParkingLot: true },
      accessibilityOptions: { wheelchairAccessibleEntrance: false }
    }, '2026-08-30T00:00:00.000Z');
    expect(row).toMatchObject({
      price_level: 1, suitable_for_children: true, has_parking: true,
      wheelchair_accessible: false, enriched_at: '2026-08-30T00:00:00.000Z'
    });
    expect(row.field_provenance.wheelchair_accessible.field).toBe('accessibilityOptions.wheelchairAccessibleEntrance');
    expect(travelAttributesFor({}).wheelchair_accessible).toBeNull();
  });
});

