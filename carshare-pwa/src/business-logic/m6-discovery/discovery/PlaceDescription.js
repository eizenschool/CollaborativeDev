// ===== BUSINESS LOGIC LAYER (PlaceDescription) =====
// FR-6.8/6.9/6.10 - the description of a place, derived from that place's own
// reviews.
//
// This is the requirement as originally stated ("a description derived from
// that place's own reviews", docs/ai/modules/M6_DESTINATION_DISCOVERY.md), which
// until now had only ever run its fallback path: every live place got the
// category template "X is a <category> destination in <state>", which says
// nothing a traveller can act on. DESCRIPTION_MIN_REVIEWS existed for FR-6.10's
// withholding rule and was never read by anything.
//
// The hard constraint is 027_m6_place_reviews.sql's recorded lesson: a review is
// not a description. Writing one person's text in as though the application had
// said it produced "Awesome and amazing and better than expectation!!!" for
// Central Market. So nothing here quotes a reviewer. It reports only what
// **several reviewers independently mention** - consensus, not opinion - and
// says it in the module's own words. The individual reviews stay where they
// belong, attributed, in the detail screen's review list.
//
// Composed at read time from data already loaded, the same way
// RecommendationReasons.js composes its sentences. FR-6.11 forbids *enrichment*
// at request time - fetching from Google - not phrasing facts already in hand.

import { DESCRIPTION_MIN_REVIEWS, REVIEW_CONFIDENCE_SATURATION } from './constants.js';

// What kind of place this is. Matched against the name first, then the review
// corpus - Malaysian POI names carry the noun far more often than not ("KL Bird
// Park", "Thean Hou Temple", "Central Market"), and where they do not the
// reviewers supply it ("KL Tower", "this aquarium").
//
// Longest first: "theme park" must win over "park", "night market" over
// "market".
const PLACE_NOUNS = [
  'hawker centre', 'hawker center', 'food court', 'night market', 'theme park',
  'water park', 'bird park', 'botanical garden', 'botanical gardens',
  'shopping mall', 'art gallery', 'cave temple', 'observation deck',
  'aquarium', 'planetarium', 'boardwalk', 'waterfall', 'plantation',
  'sanctuary', 'cathedral', 'monument', 'viewpoint', 'landmark', 'gardens',
  'mosque', 'temple', 'church', 'shrine', 'market', 'museum', 'gallery',
  'palace', 'square', 'street', 'bridge', 'island', 'street food',
  'tower', 'caves', 'beach', 'trail', 'jetty', 'shrine', 'fort', 'lake',
  'hill', 'cave', 'park', 'zoo', 'farm', 'pier', 'lane',
  'restaurant', 'kopitiam', 'stall', 'cafe'
];

// Words that carry no information about a place. Anything whose first or last
// word is in here is trimmed or dropped, so "the fountain show" becomes
// "fountain show" rather than being reported with its article attached.
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'of', 'at', 'by', 'for', 'with',
  'about', 'into', 'to', 'from', 'in', 'on', 'off', 'out', 'over', 'under',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does', 'did',
  'have', 'has', 'had', 'having', 'can', 'could', 'will', 'would', 'shall',
  'should', 'may', 'might', 'must', 'this', 'that', 'these', 'those', 'there',
  'here', 'it', 'its', 'we', 'our', 'us', 'you', 'your', 'i', 'my', 'me',
  'they', 'them', 'their', 'he', 'she', 'his', 'her', 'as', 'so', 'than',
  'then', 'too', 'very', 'just', 'also', 'only', 'even', 'much', 'many',
  'more', 'most', 'some', 'any', 'all', 'both', 'each', 'no', 'not', 'up',
  'down', 'when', 'while', 'where', 'how', 'what', 'which', 'who', 'whom',
  'get', 'got', 'go', 'going', 'went', 'come', 'came', 'take', 'took', 'see',
  'saw', 'make', 'made', 'want', 'like', 'really', 'quite', 'well', 'still',
  'one', 'two', 'first', 'last', 'next', 'other', 'another', 'every', 'own',
  'lot', 'lots', 'bit', 'thing', 'things', 'way', 'time', 'times', 'day',
  'days', 'people', 'everyone', 'anyone', 'something', 'anything'
]);

// Generic praise. Present in almost every review of every place, so it
// separates nothing - "must visit" is not a feature of a destination.
const PRAISE = new Set([
  'good', 'great', 'nice', 'best', 'better', 'amazing', 'awesome', 'lovely',
  'beautiful', 'stunning', 'wonderful', 'excellent', 'perfect', 'fantastic',
  'incredible', 'spectacular', 'gorgeous', 'magical', 'memorable', 'worth',
  'must', 'recommend', 'recommended', 'highly', 'definitely', 'absolutely',
  'visit', 'visited', 'visiting', 'visitors', 'place', 'places', 'spot',
  'spots', 'experience', 'attraction', 'attractions', 'trip', 'tour',
  'enjoy', 'enjoyed', 'love', 'loved', 'liked', 'fun', 'happy', 'friendly',
  'clean', 'busy', 'crowded', 'expensive', 'cheap', 'free', 'easy', 'hard',
  'big', 'small', 'large', 'huge', 'long', 'short', 'old', 'new', 'few'
]);

// Trimmed off the ends of a candidate phrase rather than used to reject it, so
// "vibrant arts and crafts" becomes "arts and crafts" - and then counts as the
// same theme as the reviewer who wrote it plainly, which is the point. Rejecting
// on these instead would have thrown away the good half of the phrase.
const ADVERBS = new Set([
  'truly', 'extremely', 'especially', 'particularly', 'carefully', 'originally',
  'actually', 'simply', 'genuinely', 'honestly', 'certainly', 'surely',
  'mostly', 'largely', 'generally', 'usually', 'often', 'always', 'never',
  'sometimes', 'super', 'pretty', 'fairly', 'rather', 'somewhat', 'slightly',
  'completely', 'totally', 'entirely', 'fully', 'perfectly', 'wonderfully',
  'incredibly', 'seriously', 'literally', 'basically', 'probably', 'maybe',
  'vibrant', 'lively', 'iconic', 'famous', 'popular', 'stunningly',
  'beautifully', 'back', 'again', 'once', 'twice'
]);

// A copula anywhere means the phrase is a clause about the place ("portions are
// generous"), not a name for something at it. A theme has to be a thing.
const COPULA = new Set(['is', 'are', 'was', 'were', 'be', 'been', 'has', 'have', 'had']);

// Kill the phrase outright wherever they appear. These mark a sentence about the
// *reader* ("buy your tickets", "don't forget") or an action rather than a
// feature ("comes alive", "walk around") - review writing habits, not
// attributes of a destination. A destination is a thing, so a theme should be a
// noun phrase.
const NOT_A_FEATURE = new Set([
  'your', 'you', 'our', 'we', 'my', 'their', 'his', 'her', 'its',
  'don', 'didn', 'doesn', 'isn', 'wasn', 'won', 'couldn', 'shouldn', 'aren',
  'buy', 'bought', 'purchase', 'purchased', 'book', 'booked', 'forget',
  'forgot', 'bring', 'brought', 'check', 'checked', 'try', 'tried', 'walk',
  'walked', 'walking', 'comes', 'coming', 'arrive', 'arrived', 'enter',
  'entered', 'entering', 'stay', 'stayed', 'spend', 'spent', 'wait', 'waiting',
  'sit', 'sitting', 'eat', 'eating', 'drink', 'drinking', 'preserved',
  'established', 'located', 'situated', 'offering', 'offers', 'provides',
  'providing', 'featuring', 'includes', 'including', 'using', 'looking',
  'seeing', 'finding', 'thinking', 'feeling', 'knowing', 'having', 'doing',
  'around', 'through', 'inside', 'outside', 'nearby', 'towards', 'across',
  'depicting', 'showing', 'telling', 'representing', 'celebrating',
  'blends', 'captures', 'combines', 'transforms', 'boasts'
]);

// Time-of-day terms, for the practical sentence. Reported as what reviewers
// mention, never as advice the module is not in a position to give.
const TIME_WORDS = {
  evening: ['evening', 'evenings', 'sunset', 'dusk'],
  night: ['night', 'nights', 'nighttime', 'after dark'],
  morning: ['morning', 'mornings', 'sunrise', 'early'],
  afternoon: ['afternoon', 'afternoons', 'midday', 'noon']
};

const MAX_THEMES = 3;
const MIN_REVIEWERS_PER_THEME = 2;
const MAX_NGRAM = 4;

// Single words are where this goes wrong. Run against the live catalogue,
// one-word themes produced "around", "area", "back", "helpful", "highlight" -
// words that pass every blocklist because they are not praise and not
// stopwords, yet say nothing about a destination. They also win on frequency,
// because a common word appears in more reviews than a specific phrase does.
// Requiring two words is a far better filter than any blocklist could be:
// "Art Deco", "fountain show", "jogging track", "colonial architecture",
// "Petronas Twin Towers" all survive it, and the noise does not.
const MIN_THEME_WORDS = 2;

const words = (text) => String(text || '')
  .toLowerCase()
  .replace(/[^a-z0-9À-ɏ\s'-]/g, ' ')
  .split(/\s+/)
  .filter(Boolean);

/** "a", "b" and "c" - the module's own connective tissue, not a reviewer's. */
function list(items) {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * Terms several reviewers reached for independently.
 *
 * Counted per review, not per occurrence: one enthusiastic reviewer repeating
 * "fountain" eight times is still one reviewer, and must not outvote two who
 * both mention the jogging track. That is the whole point - a theme is what the
 * reviews agree on, which is the only thing this module is entitled to state as
 * fact about the place.
 */
export function extractThemes(reviews = [], { exclude = [], limit = MAX_THEMES } = {}) {
  const banned = new Set(words(exclude.join(' ')));

  // n-gram -> { reviewers: Set, display: most common original casing }
  const seen = new Map();

  const trimmable = (w) => STOPWORDS.has(w) || PRAISE.has(w) || ADVERBS.has(w);

  reviews.forEach((review, index) => {
    const raw = String(review?.text || '');
    if (!raw.trim()) return;

    // Phrases are gathered within a clause, never across one. Reading straight
    // through the punctuation turned "breakfast, lunch and dinner" into the
    // theme "breakfast lunch" - two words that are only adjacent because a
    // comma was removed between them.
    const clauses = raw.split(/[.,;:!?()[\]"“”]|\s[-–—]\s/);

    for (const clause of clauses) {
      const lower = words(clause);
      const original = clause.replace(/[^A-Za-z0-9À-ɏ\s'-]/g, ' ').split(/\s+/).filter(Boolean);
      if (lower.length !== original.length) continue;

      for (let size = MIN_THEME_WORDS; size <= MAX_NGRAM; size += 1) {
        for (let start = 0; start + size <= lower.length; start += 1) {
          const gram = lower.slice(start, start + size);
          if (gram.some((w) => (
            banned.has(w) || NOT_A_FEATURE.has(w) || COPULA.has(w) || w.length < 3
          ))) continue;

          // Trim the ends down to the noun phrase inside. A phrase opening or
          // closing on a stopword, a bare adverb or plain praise is a fragment
          // of somebody's sentence; what is left names something.
          let from = start;
          let to = start + size;
          while (from < to && trimmable(lower[from])) from += 1;
          while (to > from && trimmable(lower[to - 1])) to -= 1;
          if (to - from < MIN_THEME_WORDS) continue;

          const key = lower.slice(from, to).join(' ');
          if (!seen.has(key)) seen.set(key, { reviewers: new Set(), display: new Map() });
          const entry = seen.get(key);
          entry.reviewers.add(index);

          const shown = original.slice(from, to).join(' ');
          entry.display.set(shown, (entry.display.get(shown) || 0) + 1);
        }
      }
    }
  });

  const ranked = [...seen.entries()]
    .filter(([, entry]) => entry.reviewers.size >= MIN_REVIEWERS_PER_THEME)
    .map(([key, entry]) => ({
      key,
      reviewers: entry.reviewers.size,
      size: key.split(/\s+/).length,
      // The casing reviewers used most often, so proper nouns keep their capitals
      // ("Art Deco", "Petronas Twin Towers") without a list of them existing here.
      display: [...entry.display.entries()].sort((a, b) => b[1] - a[1])[0][0]
    }))
    // Among equally supported themes, prefer one without an internal "and":
    // listing "kids and adults" beside two others produces "a, kids and adults
    // and c", which reads as four items rather than three. A phrase like "arts
    // and crafts" still wins when the reviewers back it more strongly.
    .sort((a, b) => (
      b.reviewers - a.reviewers
      || Number(a.key.includes(' and ')) - Number(b.key.includes(' and '))
      || b.size - a.size
      || a.key.localeCompare(b.key)
    ));

  // A phrase contained in a longer qualifying one is dropped in favour of the
  // longer, whatever the counts say. "Art" is mentioned by more reviewers than
  // "Art Deco" is, and is worth strictly less; ranking alone would have kept
  // the wrong one, because the shorter phrase is always at least as frequent as
  // the longer one it sits inside.
  const survivors = ranked.filter((theme) => !ranked.some((other) => (
    other !== theme && other.size > theme.size && other.key.includes(theme.key)
  )));

  // Then drop overlaps among what is left, so one place does not get three
  // themes that are all variations on the same phrase.
  const chosen = [];
  for (const theme of survivors) {
    if (chosen.some((kept) => kept.key.includes(theme.key) || theme.key.includes(kept.key))) continue;
    chosen.push(theme);
    if (chosen.length >= limit) break;
  }

  return chosen;
}

/** The time of day reviewers mention most, or null when they do not agree on one. */
export function dominantTime(reviews = []) {
  const counts = new Map();

  reviews.forEach((review, index) => {
    const text = String(review?.text || '').toLowerCase();
    for (const [label, terms] of Object.entries(TIME_WORDS)) {
      if (terms.some((term) => text.includes(term))) {
        if (!counts.has(label)) counts.set(label, new Set());
        counts.get(label).add(index);
      }
    }
  });

  const ranked = [...counts.entries()]
    .map(([label, reviewers]) => ({ label, reviewers: reviewers.size }))
    .filter((entry) => entry.reviewers >= MIN_REVIEWERS_PER_THEME)
    .sort((a, b) => b.reviewers - a.reviewers);

  return ranked.length ? ranked[0].label : null;
}

// Whole words only. Substring matching read "comfortable" as `fort` and turned
// two Kuala Lumpur restaurants into forts; `park` would likewise match
// "parking", and `hill` "chill".
const mentions = (text, noun) => new RegExp(`\\b${noun}s?\\b`, 'i').test(text);

/** What kind of place this is, from its name, else from what reviewers call it. */
export function placeNoun(place) {
  const name = String(place?.name || '').toLowerCase();
  const fromName = PLACE_NOUNS.find((noun) => mentions(name, noun));
  if (fromName) return fromName;

  // Falling back to the reviews, take the noun the most reviewers used rather
  // than the first one in the list. "Menara Kuala Lumpur" carries no English
  // noun, and its reviewers overwhelmingly call it a tower - which a
  // first-match scan would miss in favour of the one reviewer who wrote
  // "observation deck".
  const reviews = (place?.reviews || []).map((r) => String(r?.text || '').toLowerCase());
  const counted = PLACE_NOUNS
    .map((noun) => ({ noun, reviewers: reviews.filter((text) => mentions(text, noun)).length }))
    .filter((entry) => entry.reviewers > 0)
    .sort((a, b) => b.reviewers - a.reviewers || b.noun.length - a.noun.length);

  return counted.length ? counted[0].noun : null;
}

/** "a"/"an" by sound of the following word, so "an aquarium" reads correctly. */
const article = (noun) => (/^[aeiou]/i.test(noun) ? 'An' : 'A');

/**
 * The place, described in the module's own voice.
 *
 * Returns null when there is not enough source material to say anything true -
 * FR-6.10 withholds generation below DESCRIPTION_MIN_REVIEWS rather than
 * padding a template out to look substantial. The caller falls back to the
 * stored description.
 *
 * @param place    the place record, carrying reviews, rating, reviewCount, state
 * @param context  facts the place record does not hold - currently distanceKm
 */
export function buildPlaceDescription(place, context = {}) {
  const reviews = (place?.reviews || []).filter((r) => String(r?.text || '').trim());
  if (reviews.length < DESCRIPTION_MIN_REVIEWS) return null;

  const sentences = [];

  // 1. What it is. A hand-authored description is better than anything composed
  //    here, so it is kept and built on rather than replaced - which is what
  //    description_is_template has recorded all along and nothing has read.
  const authored = place?.descriptionIsTemplate === false && String(place?.description || '').trim();
  if (authored) {
    sentences.push(authored);
  } else {
    const noun = placeNoun(place) || `${place?.category || 'destination'} destination`;
    const where = String(place?.state || '').trim();
    sentences.push(where ? `${article(noun)} ${noun} in ${where}.` : `${article(noun)} ${noun}.`);
  }

  // 2. What the reviews agree on. The load-bearing sentence: this is the part
  //    that makes the description about *this* place.
  const themes = extractThemes(reviews, { exclude: [place?.name, place?.state, place?.category] });
  if (themes.length) {
    sentences.push(`Visitors most often mention ${list(themes.map((t) => t.display))}.`);
  }

  // 3. Standing. FR-6.16: below the confidence threshold a numeric rating may
  //    not be shown at all, so it says how thin the evidence is instead.
  const rating = Number(place?.rating);
  const reviewCount = Number(place?.reviewCount) || 0;
  if (reviewCount >= REVIEW_CONFIDENCE_SATURATION && Number.isFinite(rating) && rating > 0) {
    sentences.push(`Rated ${rating.toFixed(1)} across ${reviewCount.toLocaleString()} reviews.`);
  } else if (reviewCount > 0) {
    sentences.push(`Only ${reviewCount} ${reviewCount === 1 ? 'review' : 'reviews'} so far.`);
  }

  // 4. Practical. Distance is the traveller's first question; the time of day is
  //    reported as what reviewers describe, not as a recommendation.
  const km = Number(context?.distanceKm);
  const when = dominantTime(reviews);
  const parts = [];
  if (Number.isFinite(km) && km >= 0) {
    // Rounding put "About 0 km away" on the screen for anything inside half a
    // kilometre, which reads as a bug rather than as "very close".
    parts.push(km < 1 ? 'Less than a kilometre away' : `About ${Math.round(km)} km away`);
  }
  if (when) parts.push(`${parts.length ? 'r' : 'R'}eviewers most often describe visiting in the ${when}`);
  if (parts.length) sentences.push(`${parts.join('; ')}.`);

  return { sentences, text: sentences.join(' ') };
}

export const PlaceDescription = { buildPlaceDescription, extractThemes, dominantTime, placeNoun };
