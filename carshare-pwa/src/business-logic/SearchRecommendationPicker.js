import { CATEGORY } from './discovery/constants.js';

export const SEARCH_RECOMMENDATION_SECTIONS = Object.freeze([
  { key: 'recommended', label: 'Recommended for you', source: 'primary' },
  { key: 'unserved', label: 'Places needing a ride', source: 'unserved' },
  { key: 'more', label: 'More destinations', source: 'withheld' }
]);

export const SEARCH_RECOMMENDATION_CATEGORIES = Object.freeze(['all', ...Object.values(CATEGORY)]);

export function recommendationReasonText(reason) {
  return typeof reason === 'string' ? reason : reason?.text || '';
}

export function collectSearchRecommendations(result) {
  const seen = new Set();
  return SEARCH_RECOMMENDATION_SECTIONS.flatMap((section) => (result?.[section.source] || []).map((candidate) => ({
    ...candidate,
    sectionKey: section.key,
    sectionLabel: section.label
  }))).filter((candidate) => {
    const sourcePlaceId = candidate.place?.sourcePlaceId?.trim();
    if (!sourcePlaceId || seen.has(sourcePlaceId)) return false;
    seen.add(sourcePlaceId);
    return true;
  });
}

export function filterSearchRecommendations(candidates, { query = '', category = 'all' } = {}) {
  const wanted = query.trim().toLowerCase();
  return candidates.filter((candidate) => {
    const place = candidate.place;
    const categoryMatches = category === 'all' || place?.category === category;
    const textMatches = !wanted || [
      place?.name,
      place?.state,
      ...(candidate.reasons || []).map(recommendationReasonText)
    ]
      .some((value) => String(value || '').toLowerCase().includes(wanted));
    return categoryMatches && textMatches;
  });
}
