import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import { getAuthNavigation } from '../../../business-logic/authAccess.js';
import { FavouriteService } from '../../../business-logic/FavouriteService.js';
import {
  SEARCH_RESTRICTION_OPTIONS,
  SMART_SEARCH_SORTS,
  SmartSearchService,
  normalizeSmartSearchCriteria,
  smartSearchCriteriaFromParams,
  smartSearchCriteriaToParams,
  validateSmartSearchCriteria
} from '../../../business-logic/SmartSearchService.js';
import { IconFilter, IconSearch, IconX } from '../icons.jsx';
import SearchForm from './SearchForm.jsx';
import { SearchRideCard } from './RideCards.jsx';
import '../../styles/search.css';

function FilterPanel({ criteria, onChange, onClear, mobile, onClose, onApply }) {
  const patch = (values) => onChange({ ...criteria, ...values });
  const toggleTag = (tag) => patch({
    tags: criteria.tags.includes(tag)
      ? criteria.tags.filter((current) => current !== tag)
      : [...criteria.tags, tag]
  });

  return (
    <div className={mobile ? 'search-filter-sheet' : 'search-filter-panel'} role={mobile ? 'dialog' : undefined} aria-modal={mobile || undefined} aria-label="Search filters">
      <div className="search-filter-heading">
        <div><p>REFINE RESULTS</p><h2>Filters and sorting</h2></div>
        {mobile && <button type="button" autoFocus onClick={onClose} aria-label="Close filters"><IconX size={20} /></button>}
      </div>

      <fieldset>
        <legend>Journey scale</legend>
        <div className="search-segmented-control">
          {['', 'Urban', 'Intercity'].map((scale) => (
            <button key={scale || 'all'} type="button" aria-pressed={criteria.journeyScale === scale} onClick={() => patch({ journeyScale: scale })}>
              {scale || 'All'}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="search-filter-grid">
        <label>Minimum seats
          <select value={criteria.minSeats} onChange={(event) => patch({ minSeats: Number(event.target.value) })}>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((count) => <option value={count} key={count}>{count}+</option>)}
          </select>
        </label>
        <label>Host rating
          <select value={criteria.minRating} onChange={(event) => patch({ minRating: Number(event.target.value) })}>
            <option value="0">Any</option>
            <option value="4">4.0+</option>
            <option value="4.5">4.5+</option>
            <option value="4.8">4.8+</option>
          </select>
        </label>
      </div>

      <label className="search-filter-label" htmlFor="search-contribution">Contribution contains
        <input id="search-contribution" value={criteria.contribution} onChange={(event) => patch({ contribution: event.target.value })} placeholder="e.g. snacks or toll" />
      </label>

      <fieldset>
        <legend>Ride preferences</legend>
        <div className="search-filter-tags">
          {SEARCH_RESTRICTION_OPTIONS.map((tag) => (
            <button type="button" key={tag} aria-pressed={criteria.tags.includes(tag)} onClick={() => toggleTag(tag)}>{tag}</button>
          ))}
        </div>
      </fieldset>

      <label className="search-filter-label" htmlFor="search-sort">Sort results
        <select id="search-sort" value={criteria.sort} onChange={(event) => patch({ sort: event.target.value })}>
          <option value={SMART_SEARCH_SORTS.DEPARTURE}>Earliest departure</option>
          <option value={SMART_SEARCH_SORTS.HOST_IMPACT}>Highest Host Impact</option>
        </select>
      </label>

      <div className="search-filter-actions">
        <button type="button" className="search-clear-button" onClick={onClear}>Clear filters</button>
        {mobile && <button type="button" className="search-apply-button" onClick={onApply}>Apply filters</button>}
      </div>
    </div>
  );
}

export default function SearchModule() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const parameterKey = searchParams.toString();
  const appliedCriteria = useMemo(() => smartSearchCriteriaFromParams(searchParams), [parameterKey]);
  const [criteria, setCriteria] = useState(appliedCriteria);
  const [rides, setRides] = useState([]);
  const [favouriteIds, setFavouriteIds] = useState(new Set());
  const [pendingRideId, setPendingRideId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterTriggerRef = useRef(null);

  useEffect(() => setCriteria(appliedCriteria), [parameterKey]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    SmartSearchService.search(appliedCriteria)
      .then((results) => active && setRides(results))
      .catch((searchError) => active && setError(searchError.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [parameterKey]);

  useEffect(() => {
    let active = true;
    if (!user) {
      setFavouriteIds(new Set());
      return undefined;
    }
    FavouriteService.list(user.id)
      .then((saved) => active && setFavouriteIds(new Set(saved.map((ride) => ride.id))))
      .catch(() => active && setFavouriteIds(new Set()));
    return () => { active = false; };
  }, [user]);

  useEffect(() => {
    if (!filtersOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') closeFilters();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [filtersOpen]);

  function closeFilters() {
    setFiltersOpen(false);
    window.setTimeout(() => filterTriggerRef.current?.focus(), 0);
  }

  function submitSearch(event) {
    event?.preventDefault();
    setError('');
    try {
      const normalized = validateSmartSearchCriteria(criteria);
      if (filtersOpen) closeFilters();
      setSearchParams(smartSearchCriteriaToParams(normalized));
    } catch (validationError) {
      setError(validationError.message);
    }
  }

  function clearFilters() {
    setCriteria((current) => normalizeSmartSearchCriteria({
      pickup: current.pickup,
      destination: current.destination,
      destinationPlaceId: current.destinationPlaceId,
      date: current.date,
      departAfter: current.departAfter
    }));
  }

  async function toggleFavourite(ride) {
    if (!user) {
      const returnPath = `${location.pathname}${location.search}`;
      const target = getAuthNavigation(user, returnPath, 'Sign in to save rides to your favourites.');
      navigate(target.to, { state: target.state });
      return;
    }
    const saved = favouriteIds.has(ride.id);
    setPendingRideId(ride.id);
    setNotice('');
    try {
      if (saved) await FavouriteService.remove(user.id, ride.id);
      else await FavouriteService.add(user.id, ride.id);
      setFavouriteIds((current) => {
        const next = new Set(current);
        saved ? next.delete(ride.id) : next.add(ride.id);
        return next;
      });
      setNotice(saved ? 'Ride removed from favourites.' : 'Ride saved to favourites.');
    } catch (favouriteError) {
      setError(favouriteError.message);
    } finally {
      setPendingRideId('');
    }
  }

  const activeFilterCount = [criteria.journeyScale, criteria.minSeats > 1, criteria.minRating > 0, criteria.contribution, ...criteria.tags].filter(Boolean).length;

  return (
    <main className="smart-search-page">
      <header className="smart-search-hero">
        <div><p>SMARTER SHARED JOURNEYS</p><h1>Find the right ride</h1><span>Search available seats, then refine the results around your journey.</span></div>
        <span className="smart-search-hero-icon" aria-hidden="true"><IconSearch size={27} /></span>
      </header>

      <section className="smart-search-box">
        <SearchForm criteria={criteria} onChange={setCriteria} onSubmit={submitSearch} loading={loading} />
        <button ref={filterTriggerRef} className="search-mobile-filter-button" type="button" onClick={() => setFiltersOpen(true)}>
          <IconFilter size={17} aria-hidden="true" /> Filters {activeFilterCount > 0 && <b>{activeFilterCount}</b>}
        </button>
      </section>

      {error && <div className="search-feedback error" role="alert">{error}<button type="button" onClick={submitSearch}>Retry</button></div>}
      {notice && <div className="search-feedback success" role="status">{notice}</div>}

      <div className="smart-search-layout">
        <aside className="search-desktop-filters">
          <FilterPanel criteria={criteria} onChange={setCriteria} onClear={clearFilters} />
          <button className="search-apply-desktop" type="button" onClick={submitSearch}>Apply filters</button>
        </aside>

        <section className="search-results" aria-busy={loading} aria-labelledby="search-results-title">
          <div className="search-results-heading">
            <div><p>AVAILABLE JOURNEYS</p><h2 id="search-results-title">{loading ? 'Searching rides…' : `${rides.length} ride${rides.length === 1 ? '' : 's'} found`}</h2></div>
            {!loading && <span>{appliedCriteria.sort === SMART_SEARCH_SORTS.HOST_IMPACT ? 'Highest impact' : 'Earliest first'}</span>}
          </div>

          {!loading && !error && rides.length === 0 && (
            <div className="search-empty-state"><IconSearch size={28} /><h3>No matching rides yet</h3><p>Try a broader route, another date, or fewer filters.</p><button type="button" onClick={() => { setCriteria(normalizeSmartSearchCriteria()); setSearchParams(new URLSearchParams()); }}>Start over</button></div>
          )}

          <div className="search-result-grid">
            {rides.map((ride) => (
              <SearchRideCard
                key={ride.id}
                ride={ride}
                saved={favouriteIds.has(ride.id)}
                favouritePending={pendingRideId === ride.id}
                onToggleFavourite={() => toggleFavourite(ride)}
                onView={() => navigate(`/ride/${ride.id}`)}
              />
            ))}
          </div>
        </section>
      </div>

      {filtersOpen && (
        <div className="search-filter-backdrop" onMouseDown={(event) => event.target === event.currentTarget && closeFilters()}>
          <FilterPanel criteria={criteria} onChange={setCriteria} onClear={clearFilters} mobile onClose={closeFilters} onApply={submitSearch} />
        </div>
      )}
    </main>
  );
}
