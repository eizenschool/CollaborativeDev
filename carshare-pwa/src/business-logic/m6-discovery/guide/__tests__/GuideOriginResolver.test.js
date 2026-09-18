import { describe, expect, it } from 'vitest';
import { guideOriginCandidates, resolveKnownGuideOrigin } from '../GuideOriginResolver.js';

describe('Guide starting-point city resolver', () => {
  it('maps exact Johor Bahru aliases to Johor coordinates', () => {
    expect(resolveKnownGuideOrigin('Johor Bahru')).toMatchObject({
      label: 'Johor Bahru', state: 'Johor', lat: 1.4927, lng: 103.7414
    });
    expect(resolveKnownGuideOrigin('JB')).toMatchObject({ label: 'Johor Bahru', state: 'Johor' });
  });

  it('does not treat a longer venue address as the city shortcut', () => {
    expect(resolveKnownGuideOrigin('johor bahru, Jalan Prima 9, Metro Prima, Kuala Lumpur')).toBeNull();
  });

  it('keeps the exact alias set unambiguous', () => {
    expect(guideOriginCandidates('Johor')).toEqual([]);
    expect(guideOriginCandidates('Kuala Lumpur')).toHaveLength(1);
  });
});
