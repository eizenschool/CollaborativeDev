import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DestinationDiscoveryService } from '../../../business-logic/m6-discovery/discovery/DestinationDiscoveryService.js';
import { getCurrentLocationPreview } from '../../../business-logic/shared/GooglePlacesService.js';
import {
  SEARCH_NEARBY_RADIUS_KM,
  SEARCH_RECOMMENDATION_CATEGORIES,
  SEARCH_RECOMMENDATION_SECTIONS,
  buildSearchRecommendationRequest,
  collectSearchRecommendations,
  filterSearchRecommendations,
  loadNearbySearchRecommendations,
  nearbyLocationErrorText,
  recommendationDistanceText,
  recommendationReasonText
} from '../../../business-logic/m4-search/SearchRecommendationPicker.js';
import { IconArrowRight, IconMapPin, IconSearch, IconStar, IconX } from '../../shared/components/icons.jsx';

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
  const [nearbyOrigin, setNearbyOrigin] = useState(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [locationRetryMode, setLocationRetryMode] = useState('nearby');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await DestinationDiscoveryService.getRecommendations(
        buildSearchRecommendationRequest({ userId, travelDate })
      );
      setCandidates(collectSearchRecommendations(result));
    } catch (cause) {
      console.error('Search destination recommendations failed', cause);
      setCandidates([]);
      setError('Recommendations could not be loaded. Your normal ride search is still available.');
    } finally {
      setLoading(false);
    }
  }, [travelDate, userId]);

  const loadForOrigin = useCallback(async (origin) => {
    const result = await DestinationDiscoveryService.getRecommendations(
      buildSearchRecommendationRequest({ userId, travelDate, origin })
    );
    return collectSearchRecommendations(result);
  }, [travelDate, userId]);

  const useCurrentLocation = async () => {
    if (locating || loading) return;
    setLocating(true);
    setLocationError('');
    setLocationRetryMode('nearby');
    try {
      const { origin, candidates: nearbyCandidates } = await loadNearbySearchRecommendations({
        userId,
        travelDate,
        locate: getCurrentLocationPreview,
        search: (request) => DestinationDiscoveryService.getRecommendations(request)
      });
      setCandidates(nearbyCandidates);
      setNearbyOrigin(origin);
    } catch (cause) {
      console.error('Nearby destination recommendations failed', cause);
      setLocationError(nearbyLocationErrorText(cause));
    } finally {
      setLocating(false);
    }
  };

  const showAllDestinations = async () => {
    if (locating || loading) return;
    setLocating(true);
    setLocationError('');
    setLocationRetryMode('all');
    try {
      const allCandidates = await loadForOrigin(null);
      setCandidates(allCandidates);
      setNearbyOrigin(null);
    } catch (cause) {
      console.error('All destination recommendations failed', cause);
      setLocationError('All recommendations could not be restored. Your nearby recommendations are still available.');
    } finally {
      setLocating(false);
    }
  };

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

  return createPortal(
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
            <span>Ranked for your travel date using ride availability and destination fit.</span>
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
          <div className="search-recommendation-nearby">
            <button
              type="button"
              className="search-recommendation-nearby-button"
              aria-pressed={Boolean(nearbyOrigin)}
              disabled={locating || loading}
              onClick={useCurrentLocation}
            >
              <IconMapPin size={16} aria-hidden="true" />
              {locating
                ? 'Finding your location…'
                : nearbyOrigin
                  ? `Near me · ${SEARCH_NEARBY_RADIUS_KM} km`
                  : 'Use my location'}
            </button>
            {nearbyOrigin ? (
              <button
                type="button"
                className="search-recommendation-show-all"
                disabled={locating || loading}
                onClick={showAllDestinations}
              >
                Show all destinations
              </button>
            ) : (
              <span>Find places within {SEARCH_NEARBY_RADIUS_KM} km of your current location.</span>
            )}
          </div>
          {locationError && (
            <div className="search-recommendation-location-error" role="alert">
              <span>{locationError}</span>
              <button
                type="button"
                disabled={locating}
                onClick={locationRetryMode === 'all' ? showAllDestinations : useCurrentLocation}
              >
                Try again
              </button>
            </div>
          )}
        </div>

        <div className="search-recommendation-content" aria-live="polite">
          {loading && <div className="search-recommendation-state"><span className="spinner" />Finding recommendations…</div>}
          {!loading && error && (
            <div className="search-recommendation-state error" role="alert">
              <p>{error}</p>
              <button type="button" onClick={load}>Try again</button>
            </div>
          )}
          {!loading && !error && nearbyOrigin && candidates.length === 0 && (
            <div className="search-recommendation-state">
              <IconMapPin size={24} aria-hidden="true" />
              <p>No recommended destinations were found within {SEARCH_NEARBY_RADIUS_KM} km of your current location.</p>
              <button type="button" disabled={locating} onClick={showAllDestinations}>Show all destinations</button>
            </div>
          )}
          {!loading && !error && !nearbyOrigin && candidates.length === 0 && (
            <div className="search-recommendation-state">
              <IconSearch size={24} aria-hidden="true" />
              <p>No recommended destinations are available right now.</p>
              <button type="button" onClick={load}>Try again</button>
            </div>
          )}
          {!loading && !error && candidates.length > 0 && filtered.length === 0 && (
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
                      <small>
                        {candidate.place.state} · {candidate.place.category}
                        {nearbyOrigin && recommendationDistanceText(candidate.distanceKm)
                          ? ` · ${recommendationDistanceText(candidate.distanceKm)}`
                          : ''}
                      </small>
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
          <span><IconStar size={15} aria-hidden="true" />Explore more places and trip-planning details.</span>
          <button type="button" onClick={onBrowseDiscover}>View all destinations <IconArrowRight size={15} aria-hidden="true" /></button>
        </footer>
      </section>
    </div>,
    document.body
  );
}
