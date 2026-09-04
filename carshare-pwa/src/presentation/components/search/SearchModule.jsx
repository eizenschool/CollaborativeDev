import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import { getAuthNavigation } from '../../../business-logic/authAccess.js';
import { FavouriteService } from '../../../business-logic/FavouriteService.js';
import {
  SEARCH_PROXIMITY_RADII,
  SEARCH_LANGUAGE_OPTIONS,
  SEARCH_RESTRICTION_OPTIONS,
  SEARCH_VEHICLE_TYPE_OPTIONS,
  SMART_SEARCH_SORTS,
  SmartSearchService,
  expandProximityCriteria,
  normalizeSmartSearchCriteria,
  smartSearchCriteriaFromParams,
  smartSearchCriteriaToParams,
  validateSmartSearchCriteria
} from '../../../business-logic/SmartSearchService.js';
import { DestinationDiscoveryService } from '../../../business-logic/discovery/DestinationDiscoveryService.js';
import { IconFilter, IconMapPin, IconSearch, IconStar, IconX } from '../icons.jsx';
import SearchForm from './SearchForm.jsx';
import { MultiLegItinerary, MultiLegJourneyCard, SearchRideCard } from './RideCards.jsx';
import DestinationRecommendationPicker from './DestinationRecommendationPicker.jsx';
import AdaptiveDialog from '../ui/AdaptiveDialog.jsx';
import '../../styles/search.css';

function FilterPanel({ criteria, onChange, onClear, onChooseRecommendation, mobile, onApply }) {
  const patch = (values) => onChange({ ...criteria, ...values });
  const toggleTag = (tag) => patch({
    tags: criteria.tags.includes(tag)
      ? criteria.tags.filter((current) => current !== tag)
      : [...criteria.tags, tag]
  });

  return (
    <div className={mobile ? 'search-filter-sheet' : 'search-filter-panel'}>
      {!mobile && <div className="search-filter-heading">
        <div><p>REFINE RESULTS</p><h2>Filters and sorting</h2></div>
      </div>}

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

      <fieldset>
        <legend>Recommended destination radius</legend>
        {criteria.destinationPlaceId ? (
          <>
            <div className="search-segmented-control search-radius-control">
              {SEARCH_PROXIMITY_RADII.map((radius) => (
                <button
                  key={radius}
                  type="button"
                  aria-pressed={criteria.proximityKm === radius}
                  onClick={() => patch({ proximityKm: radius })}
                >
                  {radius} km
                </button>
              ))}
            </div>
            <p className="search-filter-helper">Matches confirmed ride destinations near {criteria.destination}.</p>
          </>
        ) : (
          <button type="button" className="search-choose-destination-filter" onClick={onChooseRecommendation}>
            <IconStar size={15} aria-hidden="true" />Choose a recommended place
          </button>
        )}
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

      <div className="search-filter-grid">
        <label>Vehicle category
          <select value={criteria.vehicleType} onChange={(event) => patch({ vehicleType: event.target.value })}>
            <option value="">Any</option>
            {SEARCH_VEHICLE_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>Preferred language
          <select value={criteria.language} onChange={(event) => patch({ language: event.target.value })}>
            <option value="">Any</option>
            {SEARCH_LANGUAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
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
  const [recommendationsOpen, setRecommendationsOpen] = useState(false);
  const [selectedJourney, setSelectedJourney] = useState(null);
  const filterTriggerRef = useRef(null);
  const recommendationButtonRef = useRef(null);
  const recommendationTriggerRef = useRef(null);
  const itineraryTriggerRef = useRef(null);

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

  function closeFilters() {
    setFiltersOpen(false);
  }

  function openRecommendations(event) {
    const trigger = event?.currentTarget;
    recommendationTriggerRef.current = trigger?.closest('.search-filter-sheet')
      ? recommendationButtonRef.current
      : trigger || recommendationButtonRef.current;
    setFiltersOpen(false);
    setRecommendationsOpen(true);
  }

  function closeRecommendations() {
    setRecommendationsOpen(false);
    window.setTimeout(() => recommendationTriggerRef.current?.focus(), 0);
  }

  function selectRecommendation(place) {
    setCriteria((current) => normalizeSmartSearchCriteria({
      ...current,
      destination: place.name,
      destinationSearchPlaceId: '',
      destinationPlaceId: place.sourcePlaceId,
      proximityKm: 10
    }));
    DestinationDiscoveryService.recordInterest(user?.id, place.id, criteria.date).catch(() => {});
    closeRecommendations();
  }

  function clearRecommendedDestination() {
    setCriteria((current) => normalizeSmartSearchCriteria({
      ...current,
      destinationSearchPlaceId: current.destinationPlaceId,
      destinationPlaceId: '',
      proximityKm: 0
    }));
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
      pickupPlaceId: current.pickupPlaceId,
      destination: current.destination,
      destinationSearchPlaceId: current.destinationSearchPlaceId,
      destinationPlaceId: current.destinationPlaceId,
      proximityKm: current.proximityKm,
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

  function applyProximityAlternative() {
    const normalized = expandProximityCriteria(appliedCriteria);
    setCriteria(normalized);
    setSearchParams(smartSearchCriteriaToParams(normalized));
  }

  function removeAppliedFilter(values) {
    const normalized = normalizeSmartSearchCriteria({ ...appliedCriteria, ...values });
    setCriteria(normalized);
    setSearchParams(smartSearchCriteriaToParams(normalized));
  }

  function openItinerary(journey, trigger) {
    itineraryTriggerRef.current = trigger;
    setSelectedJourney(journey);
  }

  function viewItineraryLeg(leg) {
    setSelectedJourney(null);
    navigate(`/ride/${leg.id}`, {
      state: { returnTo: `${location.pathname}${location.search}` }
    });
  }

  const activeFilterCount = [
    criteria.destinationPlaceId,
    criteria.journeyScale,
    criteria.minSeats > 1,
    criteria.minRating > 0,
    criteria.vehicleType,
    criteria.language,
    criteria.contribution,
    ...criteria.tags
  ].filter(Boolean).length;

  const appliedFilterChips = [
    appliedCriteria.destinationPlaceId && {
      key: 'destination-radius',
      label: `Within ${appliedCriteria.proximityKm} km of ${appliedCriteria.destination}`,
      remove: () => removeAppliedFilter({
        destinationSearchPlaceId: appliedCriteria.destinationPlaceId,
        destinationPlaceId: '',
        proximityKm: 0
      })
    },
    appliedCriteria.journeyScale && {
      key: 'journey-scale',
      label: appliedCriteria.journeyScale,
      remove: () => removeAppliedFilter({ journeyScale: '' })
    },
    appliedCriteria.minSeats > 1 && {
      key: 'minimum-seats',
      label: `${appliedCriteria.minSeats}+ seats`,
      remove: () => removeAppliedFilter({ minSeats: 1 })
    },
    appliedCriteria.minRating > 0 && {
      key: 'host-rating',
      label: `${appliedCriteria.minRating}+ host rating`,
      remove: () => removeAppliedFilter({ minRating: 0 })
    },
    appliedCriteria.vehicleType && {
      key: 'vehicle-type',
      label: SEARCH_VEHICLE_TYPE_OPTIONS.find((item) => item.value === appliedCriteria.vehicleType)?.label || appliedCriteria.vehicleType,
      remove: () => removeAppliedFilter({ vehicleType: '' })
    },
    appliedCriteria.language && {
      key: 'language',
      label: SEARCH_LANGUAGE_OPTIONS.find((item) => item.value === appliedCriteria.language)?.label || appliedCriteria.language,
      remove: () => removeAppliedFilter({ language: '' })
    },
    appliedCriteria.contribution && {
      key: 'contribution',
      label: `Contribution: ${appliedCriteria.contribution}`,
      remove: () => removeAppliedFilter({ contribution: '' })
    },
    ...appliedCriteria.tags.map((tag) => ({
      key: `tag-${tag}`,
      label: tag,
      remove: () => removeAppliedFilter({ tags: appliedCriteria.tags.filter((item) => item !== tag) })
    }))
  ].filter(Boolean);

  return (
    <main className="smart-search-page">
      <header className="smart-search-hero">
        <div><p>SMARTER SHARED JOURNEYS</p><h1>Find the right ride</h1><span>Search available seats, then refine the results around your journey.</span></div>
        <span className="smart-search-hero-icon" aria-hidden="true"><IconSearch size={27} /></span>
      </header>

      <section className="smart-search-box">
        <SearchForm criteria={criteria} onChange={setCriteria} onSubmit={submitSearch} loading={loading} />
        <div className={`search-destination-tool${criteria.destinationPlaceId ? ' selected' : ''}`}>
          <span className="search-destination-tool-icon" aria-hidden="true">
            {criteria.destinationPlaceId ? <IconMapPin size={17} /> : <IconStar size={17} />}
          </span>
          <span>
            <strong>{criteria.destinationPlaceId ? `Within ${criteria.proximityKm} km of ${criteria.destination}` : 'Not sure where to go?'}</strong>
            <small>{criteria.destinationPlaceId ? 'Only confirmed ride destinations are matched.' : 'Use Destination Discovery recommendations in this search.'}</small>
          </span>
          <button ref={recommendationButtonRef} type="button" onClick={openRecommendations}>
            {criteria.destinationPlaceId ? 'Change place' : 'Browse recommendations'}
          </button>
          {criteria.destinationPlaceId && (
            <button type="button" className="search-destination-clear" onClick={clearRecommendedDestination}>
              Match exact place
            </button>
          )}
        </div>
        <button ref={filterTriggerRef} className="search-mobile-filter-button" type="button" onClick={() => setFiltersOpen(true)}>
          <IconFilter size={17} aria-hidden="true" /> Filters {activeFilterCount > 0 && <b>{activeFilterCount}</b>}
        </button>
      </section>

      {appliedFilterChips.length > 0 && (
        <section className="search-active-filters" aria-label="Active search filters">
          <strong>Active filters</strong>
          <div>
            {appliedFilterChips.map((chip) => (
              <button key={chip.key} type="button" onClick={chip.remove} aria-label={`Remove ${chip.label} filter`}>
                <span>{chip.label}</span><IconX size={14} aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>
      )}

      {error && <div className="search-feedback error" role="alert">{error}<button type="button" onClick={submitSearch}>Retry</button></div>}
      {notice && <div className="search-feedback success" role="status">{notice}</div>}

      <div className="smart-search-layout">
        <aside className="search-desktop-filters">
          <FilterPanel criteria={criteria} onChange={setCriteria} onClear={clearFilters} onChooseRecommendation={openRecommendations} />
          <button className="search-apply-desktop" type="button" onClick={submitSearch}>Apply filters</button>
        </aside>

        <section className="search-results" aria-busy={loading} aria-labelledby="search-results-title">
          <div className="search-results-heading">
            <div><p>AVAILABLE JOURNEYS</p><h2 id="search-results-title">{loading ? 'Searching rides…' : `${rides.length} journey${rides.length === 1 ? '' : 's'} found`}</h2></div>
            {!loading && <span>{rides.some((ride) => ride.journeyType === 'multi-leg') ? 'Two-leg alternatives' : appliedCriteria.sort === SMART_SEARCH_SORTS.HOST_IMPACT ? 'Highest impact' : 'Earliest first'}</span>}
          </div>

          {!loading && !error && rides.length === 0 && (
            <div className="search-empty-state">
              <IconSearch size={28} />
              <h3>{appliedCriteria.destinationPlaceId ? `No rides within ${appliedCriteria.proximityKm} km` : 'No matching rides yet'}</h3>
              <p>{appliedCriteria.destinationPlaceId
                ? `No available ride currently ends close enough to ${appliedCriteria.destination}.`
                : 'Try a broader route, another date, or fewer filters.'}</p>
              <div className="search-empty-actions">
                {appliedCriteria.destinationPlaceId && (
                  <button type="button" onClick={applyProximityAlternative}>
                    {appliedCriteria.proximityKm < 25 ? 'Expand the radius' : 'Match the exact destination'}
                  </button>
                )}
                <button type="button" className="secondary" onClick={() => { setCriteria(normalizeSmartSearchCriteria()); setSearchParams(new URLSearchParams()); }}>Start over</button>
              </div>
            </div>
          )}

          <div className="search-result-grid">
            {rides.map((ride) => ride.journeyType === 'multi-leg' ? (
              <MultiLegJourneyCard
                key={ride.id}
                journey={ride}
                proximityLabel={appliedCriteria.destinationPlaceId ? appliedCriteria.destination : ''}
                onView={(event) => openItinerary(ride, event.currentTarget)}
              />
            ) : (
              <SearchRideCard
                key={ride.id}
                ride={ride}
                proximityLabel={appliedCriteria.destinationPlaceId ? appliedCriteria.destination : ''}
                saved={favouriteIds.has(ride.id)}
                favouritePending={pendingRideId === ride.id}
                onToggleFavourite={() => toggleFavourite(ride)}
                onView={() => navigate(`/ride/${ride.id}`, {
                  state: { returnTo: `${location.pathname}${location.search}` }
                })}
              />
            ))}
          </div>
        </section>
      </div>

      <AdaptiveDialog
        open={filtersOpen}
        onClose={closeFilters}
        title="Filters and sorting"
        description="Refine available rides without losing your route and date."
        triggerRef={filterTriggerRef}
      >
        <FilterPanel criteria={criteria} onChange={setCriteria} onClear={clearFilters} onChooseRecommendation={openRecommendations} mobile onApply={submitSearch} />
      </AdaptiveDialog>

      <AdaptiveDialog
        open={Boolean(selectedJourney)}
        onClose={() => setSelectedJourney(null)}
        title="Your two-leg itinerary"
        description="Review both independent rides and the transfer before opening either ride detail."
        triggerRef={itineraryTriggerRef}
      >
        <MultiLegItinerary journey={selectedJourney} onViewLeg={viewItineraryLeg} />
      </AdaptiveDialog>

      {recommendationsOpen && (
        <DestinationRecommendationPicker
          userId={user?.id}
          travelDate={criteria.date}
          onSelect={selectRecommendation}
          onClose={closeRecommendations}
          onBrowseDiscover={() => navigate(`/discover${criteria.date ? `?date=${encodeURIComponent(criteria.date)}` : ''}`)}
        />
      )}
    </main>
  );
}
