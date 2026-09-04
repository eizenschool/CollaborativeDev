// FR-6.19 - what category browsing may reach.
//
// The presentation rule withholds below-threshold candidates from the default
// view but keeps them reachable by category. Only that selection is asserted
// here, not the markup: this file lives alongside the other discovery tests
// because the suite's include patterns cover business-logic only, and the rule
// is the part worth pinning. Same reasoning as PlacePoster.test.js.

import { describe, expect, it } from 'vitest';
import { selectWithheldForCategory } from '../../../presentation/components/HomeScreen.jsx';
import { CATEGORY } from '../constants.js';

const candidate = (placeId, category) => ({ placeId, place: { id: placeId, category } });

const withheld = [
  candidate('p_central_market', CATEGORY.HERITAGE),
  candidate('p_kellie', CATEGORY.HERITAGE),
  candidate('p_sekinchan', CATEGORY.NATURE)
];

describe('selectWithheldForCategory', () => {
  it('shows nothing on the default view, so the ranked list stays the recommendation', () => {
    expect(selectWithheldForCategory(withheld, 'all')).toEqual([]);
  });

  it('reaches the withheld places of the chosen category', () => {
    const picked = selectWithheldForCategory(withheld, CATEGORY.HERITAGE);
    expect(picked.map((c) => c.placeId)).toEqual(['p_central_market', 'p_kellie']);
  });

  it('excludes other categories', () => {
    const picked = selectWithheldForCategory(withheld, CATEGORY.NATURE);
    expect(picked.map((c) => c.placeId)).toEqual(['p_sekinchan']);
  });

  it('returns empty for a category with nothing withheld', () => {
    expect(selectWithheldForCategory(withheld, CATEGORY.CULINARY)).toEqual([]);
  });

  // The hub calls this with `result?.withheld` before the first result lands,
  // and a live read that returns no withheld candidates omits the key entirely.
  it('survives a missing withheld list', () => {
    expect(selectWithheldForCategory(undefined, CATEGORY.HERITAGE)).toEqual([]);
    expect(selectWithheldForCategory(null, 'all')).toEqual([]);
  });

  it('ignores a candidate carrying no place', () => {
    expect(selectWithheldForCategory([{ placeId: 'p_broken' }], CATEGORY.HERITAGE)).toEqual([]);
  });
});
