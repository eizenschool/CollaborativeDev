import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DestinationDiscoveryService } from '../../../business-logic/discovery/DestinationDiscoveryService.js';
import {
  SEARCH_RECOMMENDATION_CATEGORIES,
  SEARCH_RECOMMENDATION_SECTIONS,
  collectSearchRecommendations,
  filterSearchRecommendations,
  recommendationReasonText
} from '../../../business-logic/SearchRecommendationPicker.js';
import { IconArrowRight, IconMapPin, IconSearch, IconStar, IconX } from '../icons.jsx';

function focusableElements(root) {
  return [...root.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
  )];
}

export default function DestinationRecommendationPicker({
  userId,
  travelDate,
  onSelect,
  onClose,
  onBrowseDiscover
}) {
  const dialogRef = useRef(null);
  const [candidates, setCandidates] = useState([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await DestinationDiscoveryService.getRecommendations({ userId, travelDate });
      setCandidates(collectSearchRecommendations(result));
    } catch (cause) {
      console.error('Search destination recommendations failed', cause);
      setCandidates([]);
      setError('Recommendations could not be loaded. Your normal ride search is still available.');
    } finally {
      setLoading(false);
    }
  }, [travelDate, userId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = focusableElements(dialogRef.current);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const filtered = useMemo(
    () => filterSearchRecommendations(candidates, { query, category }),
    [candidates, category, query]
  );

  const groups = useMemo(() => SEARCH_RECOMMENDATION_SECTIONS.map((section) => ({
    ...section,
    candidates: filtered.filter((candidate) => candidate.sectionKey === section.key)
  })).filter((section) => section.candidates.length), [filtered]);

  return (
    <div
      className="search-recommendation-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        ref={dialogRef}
        className="search-recommendation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="search-recommendation-title"
      >
        <header className="search-recommendation-head">
          <div>
            <p>DESTINATION DISCOVERY</p>
            <h2 id="search-recommendation-title">Choose a recommended place</h2>
            <span>Module 6 ranks these for your travel date without loading billable photos.</span>
          </div>
          <button type="button" autoFocus onClick={onClose} aria-label="Close destination recommendations">
            <IconX size={20} aria-hidden="true" />
          </button>
        </header>

        <div className="search-recommendation-controls">
          <label htmlFor="search-recommendation-query">
            <span>Search destinations</span>
            <span className="search-recommendation-input">
              <IconSearch size={16} aria-hidden="true" />
              <input
                id="search-recommendation-query"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Place or state"
              />
            </span>
          </label>
          <div className="search-recommendation-categories" role="group" aria-label="Destination category">
            {SEARCH_RECOMMENDATION_CATEGORIES.map((value) => (
              <button
                type="button"
                key={value}
                aria-pressed={category === value}
                onClick={() => setCategory(value)}
              >
                {value === 'all' ? 'All' : value}
              </button>
            ))}
          </div>
        </div>

        <div className="search-recommendation-content" aria-live="polite">
          {loading && <div className="search-recommendation-state"><span className="spinner" />Finding recommendations…</div>}
          {!loading && error && (
            <div className="search-recommendation-state error" role="alert">
              <p>{error}</p>
              <button type="button" onClick={load}>Try again</button>
            </div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div className="search-recommendation-state">
              <IconSearch size={24} aria-hidden="true" />
              <p>No destinations match this name and category.</p>
              <button type="button" onClick={() => { setQuery(''); setCategory('all'); }}>Clear destination filters</button>
            </div>
          )}

          {!loading && !error && groups.map((group) => (
            <section className="search-recommendation-group" key={group.key} aria-labelledby={`recommendation-${group.key}`}>
              <h3 id={`recommendation-${group.key}`}>{group.label}</h3>
              <div className="search-recommendation-list">
                {group.candidates.map((candidate) => (
                  <button
                    type="button"
                    className="search-recommendation-option"
                    key={candidate.place.sourcePlaceId}
                    onClick={() => onSelect(candidate.place)}
                  >
                    <span className="search-recommendation-option-icon"><IconMapPin size={17} aria-hidden="true" /></span>
                    <span className="search-recommendation-option-copy">
                      <strong>{candidate.place.name}</strong>
                      <small>{candidate.place.state} · {candidate.place.category}</small>
                      {recommendationReasonText(candidate.reasons?.[0]) && (
                        <em>{recommendationReasonText(candidate.reasons[0])}</em>
                      )}
                    </span>
                    <IconArrowRight size={16} aria-hidden="true" />
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>

        <footer className="search-recommendation-footer">
          <span><IconStar size={15} aria-hidden="true" />Want the full score explanation?</span>
          <button type="button" onClick={onBrowseDiscover}>Open Destination Discovery <IconArrowRight size={15} aria-hidden="true" /></button>
        </footer>
      </section>
    </div>
  );
}
