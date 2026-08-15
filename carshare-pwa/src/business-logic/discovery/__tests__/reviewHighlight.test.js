// The review highlight is a quote, never a summary, and the attribution must
// travel with the text - see the compliance lesson recorded in
// 027_m6_place_reviews.sql. These tests pin the selection and truncation
// rules, not any particular wording.

import { describe, expect, it } from 'vitest';
import { selectReviewHighlight } from '../reviewHighlight.js';

const review = (author, text, rating = 5) => ({ author, rating, text });

describe('selectReviewHighlight', () => {
  it('picks the longest review as the most substantive one', () => {
    const place = {
      reviews: [
        review('Amir', 'Nice.'),
        review('Grace', 'A hillside temple complex with a bronze statue and a genuinely long queue on weekends, but worth the wait for the view alone.'),
        review('Priya', 'Good food.')
      ]
    };
    const highlight = selectReviewHighlight(place);
    expect(highlight.author).toBe('Grace');
  });

  it('returns the full text untouched when it already fits the budget', () => {
    const place = { reviews: [review('Amir', 'Short and sweet.')] };
    expect(selectReviewHighlight(place)).toEqual({ text: 'Short and sweet.', author: 'Amir' });
  });

  it('keeps every complete sentence that fits, cutting at the last one in budget', () => {
    const text = 'The fountain show at night is the highlight. Bring a jacket, it gets breezy by the water. '
      + 'This part should never appear because it runs well past the card budget.';
    const highlight = selectReviewHighlight({ reviews: [review('Wei', text)] }, { variant: 'card' });
    expect(highlight.text).toBe('The fountain show at night is the highlight. Bring a jacket, it gets breezy by the water.');
    expect(highlight.text.length).toBeLessThanOrEqual(110);
  });

  it('does not reach past a sentence boundary for a few more words', () => {
    // The next sentence ends outside the budget, so it must not appear at all -
    // a half-sentence added past a clean boundary reads worse than stopping.
    const text = 'The fountain show at night is genuinely the highlight of the whole visit. '
      + 'x'.repeat(120);
    const highlight = selectReviewHighlight({ reviews: [review('Wei', text)] }, { variant: 'card' });
    expect(highlight.text).toBe('The fountain show at night is genuinely the highlight of the whole visit.');
  });

  it('falls back to a word boundary with an ellipsis when no sentence end is in budget', () => {
    const text = 'a'.repeat(50) + ' ' + 'b'.repeat(80);
    const highlight = selectReviewHighlight({ reviews: [review('Wei', text)] }, { variant: 'card' });
    expect(highlight.text.endsWith('…')).toBe(true);
    expect(highlight.text).not.toMatch(/\s…$/);
  });

  it('uses the wider detail budget on the detail variant', () => {
    const text = 'x'.repeat(300);
    const card = selectReviewHighlight({ reviews: [review('Wei', text)] }, { variant: 'card' });
    const detail = selectReviewHighlight({ reviews: [review('Wei', text)] }, { variant: 'detail' });
    expect(card.text.length).toBeLessThan(detail.text.length);
  });

  it('returns null when there are no reviews', () => {
    expect(selectReviewHighlight({ reviews: [] })).toBeNull();
    expect(selectReviewHighlight({})).toBeNull();
    expect(selectReviewHighlight(null)).toBeNull();
  });

  it('ignores reviews with empty or missing text', () => {
    const place = { reviews: [{ author: 'Amir', rating: 4, text: '' }, { author: 'Grace', rating: 5 }] };
    expect(selectReviewHighlight(place)).toBeNull();
  });

  it('falls back to a neutral attribution when a review has no author', () => {
    const place = { reviews: [{ rating: 5, text: 'Lovely spot, worth the detour.' }] };
    expect(selectReviewHighlight(place).author).toBe('A visitor');
  });
});
