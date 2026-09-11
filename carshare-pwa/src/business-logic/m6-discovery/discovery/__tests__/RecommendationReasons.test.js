// The sentences a traveller reads instead of the score table.
//
// The ordering assertions matter most: reasons are ranked by contribution, and
// getting that wrong produces explanations that are individually true but lead
// with the least relevant fact.

import { describe, expect, it } from 'vitest';
import { buildCaveats, buildReasons } from '../RecommendationReasons.js';
import { AFFINITY_SOURCE } from '../AffinityResolver.js';
import { CATEGORY } from '../constants.js';

const candidate = (over = {}) => ({
  servedByRide: true,
  signals: {
    desirability: { affinity: 0, season: 0, quality: 0, headroom: 0, local: 0 },
    accessibility: { seatHeadroom: 0, journeyCost: 0, demandConvergence: 0 },
    ...over.signals
  },
  ...over
});

const place = (over = {}) => ({
  name: 'Kek Lok Si Temple',
  category: CATEGORY.HERITAGE,
  state: 'Penang',
  rating: 4.5,
  reviewCount: 9800,
  ...over
});

describe('buildReasons - phrasing', () => {
  it('credits trip history when the affinity came from it', () => {
    const { reasons } = buildReasons(
      candidate({ signals: { desirability: { affinity: 1 }, accessibility: {} } }),
      { place: place(), affinitySource: AFFINITY_SOURCE.HISTORY }
    );
    expect(reasons[0].text).toBe('Similar to the heritage places you have been to');
  });

  it('credits stated preferences when that is where it came from', () => {
    const { reasons } = buildReasons(
      candidate({ signals: { desirability: { affinity: 1 }, accessibility: {} } }),
      { place: place(), affinitySource: AFFINITY_SOURCE.STATED }
    );
    expect(reasons[0].text).toBe('You said you enjoy heritage');
  });

  // Neutral affinity is the absence of a signal, not a reason to recommend.
  it('says nothing about affinity when the value is neutral', () => {
    const { reasons } = buildReasons(
      candidate({ signals: { desirability: { affinity: 0.5 }, accessibility: {} } }),
      { place: place(), affinitySource: AFFINITY_SOURCE.NEUTRAL }
    );
    expect(reasons.some((r) => r.key === 'affinity')).toBe(false);
  });

  it('reuses the seasonal calendar label rather than inventing wording', () => {
    const { reasons } = buildReasons(
      candidate({ signals: { desirability: { season: 1 }, accessibility: {} } }),
      { place: place(), season: { label: 'Durian season', state: 'aligned' } }
    );
    expect(reasons[0].text).toBe('Durian season');
  });

  it('does not present "No declared season" as a reason', () => {
    const { reasons } = buildReasons(
      candidate({ signals: { desirability: { season: 1 }, accessibility: {} } }),
      { place: place(), season: { label: 'No declared season', state: 'undeclared' } }
    );
    expect(reasons.some((r) => r.key === 'season')).toBe(false);
  });

  it('quotes the rating with its sample size', () => {
    const { reasons } = buildReasons(
      candidate({ signals: { desirability: { quality: 1 }, accessibility: {} } }),
      { place: place({ rating: 4.6, reviewCount: 18420 }) }
    );
    expect(reasons[0].text).toBe('Rated 4.6 by 18,420 visitors');
  });

  // FR-6.16 again: too few reviews means no numeric claim, in words as on screen.
  it('makes no rating claim below the review-confidence threshold', () => {
    const { reasons } = buildReasons(
      candidate({ signals: { desirability: { quality: 1 }, accessibility: {} } }),
      { place: place({ rating: 5, reviewCount: 2 }) }
    );
    expect(reasons.some((r) => r.key === 'quality')).toBe(false);
  });

  // The sustainability argument, stated as a sentence a traveller can act on.
  it('says a quiet place is quieter than its busiest peers', () => {
    const { reasons } = buildReasons(
      candidate({ signals: { desirability: { headroom: 1 }, accessibility: {} } }),
      { place: place() }
    );
    expect(reasons[0].text).toBe('Quieter than the busiest heritage spots in Penang');
  });

  it('mentions independence only when the place is independent', () => {
    const independent = buildReasons(
      candidate({ signals: { desirability: { local: 1 }, accessibility: {} } }),
      { place: place() }
    );
    const chain = buildReasons(
      candidate({ signals: { desirability: { local: 0 }, accessibility: {} } }),
      { place: place() }
    );
    expect(independent.reasons[0].text).toBe('Independently run, not a chain');
    expect(chain.reasons).toHaveLength(0);
  });

  it('states the seats and the day they are going', () => {
    const { reasons } = buildReasons(
      candidate({ signals: { desirability: {}, accessibility: { seatHeadroom: 1 } } }),
      { place: place(), rides: [{ seatsAvailable: 3, seatsTotal: 4 }], travelDate: '2026-08-15' }
    );
    expect(reasons[0].text).toMatch(/^3 seats going on /);
  });

  it('uses the singular for one seat and one other traveller', () => {
    const seat = buildReasons(
      candidate({ signals: { desirability: {}, accessibility: { seatHeadroom: 1 } } }),
      { place: place(), rides: [{ seatsAvailable: 1, seatsTotal: 4 }] }
    );
    const other = buildReasons(
      candidate({ signals: { desirability: {}, accessibility: { demandConvergence: 1 } } }),
      { place: place(), interestedUsers: 1 }
    );
    expect(seat.reasons[0].text).toMatch(/^1 seat going/);
    expect(other.reasons[0].text).toBe('1 other traveller wants to go');
  });

  it('reports the distance when the destination is genuinely close', () => {
    const { reasons } = buildReasons(
      candidate({ signals: { desirability: {}, accessibility: { journeyCost: 0.9 } } }),
      { place: place(), distanceKm: 20.4 }
    );
    expect(reasons[0].text).toBe('Only 20 km from you');
  });

  // Journey cost is relative to the furthest candidate. With Sarawak in the set
  // a 296km trip scores well, but "only 296 km" would claim something the signal
  // never measured.
  it('does not call a long trip "only", however well it scores relatively', () => {
    const { reasons } = buildReasons(
      candidate({ signals: { desirability: {}, accessibility: { journeyCost: 0.85 } } }),
      { place: place(), distanceKm: 296 }
    );
    expect(reasons[0].text).not.toMatch(/^Only /);
    expect(reasons[0].text).toBe("Closer than most of today's options, at 296 km");
  });
});

describe('buildReasons - ranking by contribution', () => {
  // The point of the whole module: 0.9 x 0.10 is a worse explanation than
  // 0.6 x 0.55, however much better the first number looks.
  it('ranks a heavily weighted mid signal above a lightly weighted strong one', () => {
    const { reasons } = buildReasons(
      candidate({
        signals: {
          desirability: { local: 1 },              // 1.00 x 0.10 = 0.10
          accessibility: { seatHeadroom: 0.6 }     // 0.60 x 0.55 = 0.33
        }
      }),
      { place: place(), rides: [{ seatsAvailable: 2, seatsTotal: 4 }], travelDate: '2026-08-15' }
    );

    expect(reasons[0].key).toBe('seatHeadroom');
    expect(reasons[1].key).toBe('local');
  });

  it('shows at most three reasons', () => {
    const { reasons } = buildReasons(
      candidate({
        signals: {
          desirability: { affinity: 1, season: 1, quality: 1, headroom: 1, local: 1 },
          accessibility: { seatHeadroom: 1, journeyCost: 1, demandConvergence: 1 }
        }
      }),
      {
        place: place(),
        affinitySource: AFFINITY_SOURCE.HISTORY,
        season: { label: 'Durian season', state: 'aligned' },
        rides: [{ seatsAvailable: 3, seatsTotal: 4 }],
        distanceKm: 12,
        interestedUsers: 4,
        travelDate: '2026-08-15'
      }
    );

    expect(reasons).toHaveLength(3);
  });

  it('drops signals contributing too little to be worth saying', () => {
    const { reasons } = buildReasons(
      candidate({ signals: { desirability: { headroom: 0.51 }, accessibility: { journeyCost: 0.61 } } }),
      { place: place(), distanceKm: 200 }
    );
    // headroom 0.51 x 0.15 = 0.077 clears the floor; nothing else does.
    expect(reasons.every((r) => r.contribution >= 0.06)).toBe(true);
  });

  it('returns nothing rather than inventing a reason for a weak candidate', () => {
    const { reasons } = buildReasons(candidate(), { place: place({ rating: null, reviewCount: 0 }) });
    expect(reasons).toEqual([]);
  });

  it('survives a candidate with no signals at all', () => {
    expect(buildReasons(null, {})).toEqual({ reasons: [], caveats: [] });
    expect(buildReasons({}, {})).toEqual({ reasons: [], caveats: [] });
  });
});

describe('buildCaveats', () => {
  it('explains that an unserved destination cannot reach the main list', () => {
    const caveats = buildCaveats({ servedByRide: false }, { place: place() });
    expect(caveats.some((c) => c.key === 'unserved')).toBe(true);
  });

  it('says nothing about serving when a ride exists', () => {
    const caveats = buildCaveats({ servedByRide: true }, { place: place() });
    expect(caveats.some((c) => c.key === 'unserved')).toBe(false);
  });

  it('passes the seasonal note through for an off-season date', () => {
    const caveats = buildCaveats({ servedByRide: true }, {
      place: place(),
      season: { state: 'off-season', note: 'Heavy rain on the east coast.' }
    });
    expect(caveats.find((c) => c.key === 'season').text).toBe('Heavy rain on the east coast.');
  });

  it('does not raise a seasonal caveat for an aligned date', () => {
    const caveats = buildCaveats({ servedByRide: true }, {
      place: place(),
      season: { state: 'aligned', note: 'Best months.' }
    });
    expect(caveats.some((c) => c.key === 'season')).toBe(false);
  });

  it('surfaces a weather advisory', () => {
    const caveats = buildCaveats({ servedByRide: true }, {
      place: place(), weatherAdvisory: 'Rain or poor visibility expected'
    });
    expect(caveats.find((c) => c.key === 'weather').text).toBe('Rain or poor visibility expected');
  });

  it('warns that a thin rating is not yet reliable', () => {
    const caveats = buildCaveats({ servedByRide: true }, { place: place({ reviewCount: 2 }) });
    expect(caveats.find((c) => c.key === 'thin-data').text).toMatch(/Only 2 reviews so far/);
  });

  it('raises no thin-data caveat for a well-reviewed place', () => {
    const caveats = buildCaveats({ servedByRide: true }, { place: place({ reviewCount: 9800 }) });
    expect(caveats.some((c) => c.key === 'thin-data')).toBe(false);
  });
});
