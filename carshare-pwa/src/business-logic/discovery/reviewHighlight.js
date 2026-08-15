// ===== BUSINESS LOGIC (review highlight) =====
//
// `place.description` is deliberately neutral and generic (FR-6.8/6.9/6.10) -
// "KLCC Park is a nature destination in Kuala Lumpur" says what category a
// place is, not what it is actually like. This picks one attributed reviewer
// quote from `place.reviews` to sit alongside that sentence, so a browsing card
// carries some real texture without the module repeating the mistake recorded
// in `027_m6_place_reviews.sql`'s header: writing a review into `description`
// itself, unattributed, as though the application had said it.
//
// Reviews are already fetched and stored - at Enterprise + Atmosphere, the
// most expensive Places API tier - for both the fixture catalogue and live
// data, so this spends nothing extra: it is a pure read of what is already on
// the place record.

const DEFAULT_MAX_CHARS = { card: 110, detail: 220 };

// Cuts inside a clause read as unfinished thoughts in a pull-quote. Preferring
// a sentence boundary keeps the excerpt reading as a complete remark; falling
// back to a word boundary (with an ellipsis) only when no sentence end falls
// far enough into the budget to be worth keeping.
function truncate(text, maxChars) {
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);

  let cut = -1;
  const sentenceEnd = /[.!?](?=\s|$)/g;
  let match;
  while ((match = sentenceEnd.exec(slice))) cut = match.index + 1;
  if (cut > maxChars * 0.4) return slice.slice(0, cut).trim();

  const lastSpace = slice.lastIndexOf(' ');
  const word = slice.slice(0, lastSpace > 0 ? lastSpace : maxChars).trim();
  return `${word}…`;
}

/**
 * The single most substantive review on a place, truncated for display, or
 * null when there is nothing usable. "Most substantive" is simply the longest
 * review text - a longer review is more likely to describe something concrete
 * about the place rather than a one-line reaction, and this needs no judgment
 * call beyond that a student project's ingest cost budget can afford.
 *
 * @param place    a place record carrying `reviews: [{ author, rating, text }]`
 * @param variant  'card' for the compact grid (~110 chars), 'detail' for the
 *                 full-width detail page (~220 chars)
 */
export function selectReviewHighlight(place, { variant = 'card' } = {}) {
  const reviews = place?.reviews || [];
  const candidates = reviews.filter(
    (review) => typeof review?.text === 'string' && review.text.trim().length > 0
  );
  if (candidates.length === 0) return null;

  const longest = candidates.reduce((best, review) => (
    review.text.trim().length > best.text.trim().length ? review : best
  ));

  const maxChars = DEFAULT_MAX_CHARS[variant] || DEFAULT_MAX_CHARS.card;
  return {
    text: truncate(longest.text.trim(), maxChars),
    author: longest.author || 'A visitor'
  };
}
