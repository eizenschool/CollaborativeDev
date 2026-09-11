// FR-6.8/6.9/6.10 - describing a place from its own reviews.
//
// These pin the rules, not the wording: which phrases are allowed to become a
// theme, what is withheld for want of evidence, and what is never said. The
// governing constraint is 027_m6_place_reviews.sql's lesson - a review is not a
// description - so the load-bearing tests here are the ones proving a single
// reviewer cannot put words into the module's mouth.

import { describe, expect, it } from 'vitest';
import { buildPlaceDescription, extractThemes, dominantTime, placeNoun } from '../PlaceDescription.js';
import { DESCRIPTION_MIN_REVIEWS } from '../constants.js';

const review = (text, author = 'A visitor') => ({ author, rating: 5, text });

const place = (overrides = {}) => ({
  name: 'Test Place',
  category: 'heritage',
  state: 'Kuala Lumpur',
  rating: 4.5,
  reviewCount: 5000,
  description: 'Test Place is a heritage destination in Kuala Lumpur.',
  descriptionIsTemplate: true,
  reviews: [],
  ...overrides
});

describe('extractThemes', () => {
  it('reports a phrase two reviewers reached for independently', () => {
    const themes = extractThemes([
      review('The fountain show at night was the highlight.'),
      review('We came back for the fountain show.'),
      review('Nothing else to report.')
    ]);
    expect(themes.map((t) => t.key)).toContain('fountain show');
  });

  // The whole point. One person's opinion is not something the module may state
  // as a fact about the place - that is exactly what 027 recorded going wrong.
  it('ignores a phrase only one reviewer used, however often they repeat it', () => {
    const themes = extractThemes([
      review('The koi pond, the koi pond again, and more koi pond. Koi pond!'),
      review('Somewhere entirely different.'),
      review('No overlap here either.')
    ]);
    expect(themes.map((t) => t.key)).not.toContain('koi pond');
  });

  it('counts a reviewer once however many times they repeat a phrase', () => {
    const themes = extractThemes([
      review('Art Deco, Art Deco, Art Deco everywhere.'),
      review('The Art Deco frontage is lovely.')
    ]);
    const deco = themes.find((t) => t.key === 'art deco');
    expect(deco.reviewers).toBe(2);
  });

  it('prefers the longer phrase over one it contains', () => {
    const themes = extractThemes([
      review('The Art Deco frontage.'),
      review('Art Deco throughout.'),
      review('Art is everywhere in this Art building.')
    ]);
    expect(themes.map((t) => t.key)).toContain('art deco');
    expect(themes.map((t) => t.key)).not.toContain('art');
  });

  it('keeps the capitalisation reviewers used, so proper nouns survive', () => {
    const themes = extractThemes([
      review('Views of the Petronas Twin Towers.'),
      review('You can see the Petronas Twin Towers from here.')
    ]);
    expect(themes[0].display).toBe('Petronas Twin Towers');
  });

  it('never reports a single word, however many reviewers use it', () => {
    const themes = extractThemes([
      review('The area was nice.'), review('Lovely area.'), review('Great area here.')
    ]);
    expect(themes.every((t) => t.key.split(' ').length >= 2)).toBe(true);
  });

  it('rejects a clause about the place rather than a name for something at it', () => {
    const themes = extractThemes([
      review('The portions are generous here.'),
      review('Portions are generous and cheap.')
    ]);
    expect(themes.map((t) => t.key)).not.toContain('portions are generous');
  });

  it('rejects instructions addressed to the reader', () => {
    const themes = extractThemes([
      review('Buy your tickets online first.'),
      review('Buy your tickets in advance.')
    ]);
    expect(themes.map((t) => t.key)).not.toContain('buy your tickets');
  });

  it('trims praise off the ends so the phrase inside is what counts', () => {
    const themes = extractThemes([
      review('A vibrant arts and crafts hub.'),
      review('The arts and crafts on sale are good.')
    ]);
    expect(themes.map((t) => t.key)).toContain('arts and crafts');
  });

  // Adjacency across a comma is an artefact of stripping punctuation, not a
  // phrase anybody wrote.
  it('does not build a phrase across a comma', () => {
    const themes = extractThemes([
      review('They serve breakfast, lunch and dinner.'),
      review('Good for breakfast, lunch and dinner.')
    ]);
    expect(themes.map((t) => t.key)).not.toContain('breakfast lunch');
  });

  it('excludes the words it is told to, so a place does not echo its own name', () => {
    const themes = extractThemes(
      [review('Central Market is lovely.'), review('Central Market again.')],
      { exclude: ['Central Market'] }
    );
    expect(themes.map((t) => t.key)).not.toContain('central market');
  });

  it('returns nothing for reviews that agree on nothing', () => {
    expect(extractThemes([review('One thing.'), review('Another matter.')])).toEqual([]);
    expect(extractThemes([])).toEqual([]);
  });
});

describe('placeNoun', () => {
  it('takes the noun out of the name when it is there', () => {
    expect(placeNoun(place({ name: 'KL Bird Park' }))).toBe('bird park');
  });

  it('falls back to what most reviewers call it', () => {
    const noun = placeNoun(place({
      name: 'Menara Kuala Lumpur',
      reviews: [review('The tower is tall.'), review('Great tower.'), review('One observation deck.')]
    }));
    expect(noun).toBe('tower');
  });

  // Substring matching made "comfortable" mean fort, and turned two restaurants
  // into forts on the live catalogue.
  it('does not match a noun buried inside another word', () => {
    expect(placeNoun(place({
      name: 'Nasi Lemak Wanjo',
      reviews: [review('Very comfortable seating.'), review('Comfortable and quick.')]
    }))).not.toBe('fort');
  });

  it('is null when neither the name nor the reviews say what it is', () => {
    expect(placeNoun(place({ name: 'Zhang Lala', reviews: [review('Tasty.')] }))).toBeNull();
  });
});

describe('dominantTime', () => {
  it('reports the time of day two or more reviewers describe', () => {
    expect(dominantTime([
      review('Lovely in the evening.'), review('We went in the evening.'), review('Fine.')
    ])).toBe('evening');
  });

  it('is null when only one reviewer mentions a time', () => {
    expect(dominantTime([review('Nice in the morning.'), review('Good.')])).toBeNull();
  });
});

describe('buildPlaceDescription', () => {
  const withReviews = (extra = {}) => place({
    name: 'Riverside Park',
    reviews: [
      review('The fountain show in the evening is the reason to come.'),
      review('We watched the fountain show, then walked in the evening air.'),
      review('Quiet spot with a fountain show worth staying for.')
    ],
    ...extra
  });

  // FR-6.10: below the threshold the module has nothing to describe the place
  // with, and says nothing rather than padding a template out.
  it('withholds generation below the minimum review count', () => {
    const thin = withReviews({ reviews: [review('Only one voice here.')] });
    expect(thin.reviews.length).toBeLessThan(DESCRIPTION_MIN_REVIEWS);
    expect(buildPlaceDescription(thin)).toBeNull();
    expect(buildPlaceDescription(place())).toBeNull();
    expect(buildPlaceDescription(null)).toBeNull();
  });

  it('opens by saying what kind of place it is', () => {
    expect(buildPlaceDescription(withReviews()).sentences[0]).toBe('A park in Kuala Lumpur.');
  });

  // description_is_template has recorded which descriptions were written by a
  // person since 024, and nothing had ever read it.
  it('keeps a hand-authored description instead of replacing it', () => {
    const authored = withReviews({
      description: 'A hillside temple complex crowned by a bronze statue of Kuan Yin.',
      descriptionIsTemplate: false
    });
    expect(buildPlaceDescription(authored).sentences[0])
      .toBe('A hillside temple complex crowned by a bronze statue of Kuan Yin.');
  });

  it('says what the reviews agree on', () => {
    expect(buildPlaceDescription(withReviews()).text).toContain('fountain show');
  });

  it('states the rating once there are enough reviews to trust it', () => {
    expect(buildPlaceDescription(withReviews()).text).toContain('Rated 4.5 across 5,000 reviews.');
  });

  // FR-6.16: the same threshold that suppresses the rating on a card suppresses
  // it here, so the two cannot drift apart.
  it('does not state a rating the review count cannot support', () => {
    const thin = withReviews({ rating: 5, reviewCount: 4 });
    const text = buildPlaceDescription(thin).text;
    expect(text).not.toContain('Rated');
    expect(text).toContain('Only 4 reviews so far.');
  });

  it('adds distance when the caller knows it, and omits it when not', () => {
    expect(buildPlaceDescription(withReviews(), { distanceKm: 3.4 }).text).toContain('About 3 km away');
    expect(buildPlaceDescription(withReviews()).text).not.toContain('km away');
  });

  it('does not round a nearby place down to "About 0 km away"', () => {
    const text = buildPlaceDescription(withReviews(), { distanceKm: 0.4 }).text;
    expect(text).not.toContain('0 km');
    expect(text).toContain('Less than a kilometre away');
  });

  it('reports the time of day as something reviewers describe, not as advice', () => {
    // Never "best visited in the evening" - the module has no standing to
    // recommend a time, only to say what the reviews describe.
    expect(buildPlaceDescription(withReviews()).text)
      .toContain('Reviewers most often describe visiting in the evening');
    expect(buildPlaceDescription(withReviews(), { distanceKm: 3 }).text)
      .toContain('About 3 km away; reviewers most often describe visiting in the evening');
  });

  it('joins its sentences into one readable paragraph', () => {
    const built = buildPlaceDescription(withReviews(), { distanceKm: 3 });
    expect(built.text).toBe(built.sentences.join(' '));
    expect(built.sentences.length).toBe(4);
  });
});
