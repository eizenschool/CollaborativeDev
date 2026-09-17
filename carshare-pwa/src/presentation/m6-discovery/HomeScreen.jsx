// ===== PRESENTATION LAYER (HomeScreen) =====
// The public landing page, and Module 6's UC6.1 discovery view. The two used to
// be separate screens - a landing page whose five action cards duplicated the
// shared navigation exactly, and a "/discover" page one click further in for
// the actual content. They are merged: Home now answers "where should I go?"
// directly, "/discover" redirects here, and only /discover/:placeId and
// /discover/demand remain as their own routes. See docs/ai/DECISIONS.md.
//
// Ranking, filtering and pagination logic below is carried over unchanged from
// the former DiscoverHub.jsx (see git history for that file) - this is a
// presentation-layer merge, not a rewrite of the recommendation rules.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../shared/context/AuthContext.jsx';
import { DEFAULT_EXPLORATION_RADIUS_KM, DestinationDiscoveryService } from '../../business-logic/m6-discovery/discovery/DestinationDiscoveryService.js';
import { CATEGORY } from '../../business-logic/m6-discovery/discovery/constants.js';
import { GUIDE_FEATURE_ENABLED } from '../../business-logic/m6-discovery/guide/constants.js';
import { RideRequestService } from '../../business-logic/m2-rides/RideRequestService.js';
import { RideService } from '../../business-logic/m2-rides/RideService.js';
import {
  IconAlertTriangle, IconArrowRight, IconEdit, IconEye, IconEyeOff, IconMapPin, IconMessage, IconSearch, IconStar
} from '../shared/components/icons.jsx';
import AdaptiveDialog from '../shared/components/ui/AdaptiveDialog.jsx';
import ConfirmedLocationInput from '../shared/components/maps/ConfirmedLocationInput.jsx';
import DestinationCard from './components/discover/DestinationCard.jsx';
import PreferencePrompt from './components/discover/PreferencePrompt.jsx';
import { PHOTO_WIDTH_LARGE } from '../../business-logic/m6-discovery/discovery/placePhotos.js';
import PlaceImage from './components/discover/PlaceImage.jsx';
import { useMediaEnabled } from './components/discover/useMediaMode.js';
import { toggleMediaMode } from '../../business-logic/m6-discovery/discovery/mediaMode.js';
import AudienceSwitch from './components/discover/AudienceSwitch.jsx';
import DemoControls, { DemoActiveBanner } from './components/discover/DemoControls.jsx';
import './styles/discover.css';
import { Chip, Skeleton } from '../shared/components/ui/Primitives.jsx';
import {
  consumeExploreReturn, discoveryFilters, readOrigin, saveExploreReturn, saveOrigin
} from '../../business-logic/m6-discovery/discovery/DiscoveryJourney.js';
import { resolveKnownGuideOrigin } from '../../business-logic/m6-discovery/guide/GuideOriginResolver.js';
import { todayIso } from '../../business-logic/m6-discovery/discovery/localDate.js';
const RESULT_PAGE_SIZE = 6;

function ShowMore({ onClick, remaining }) {
  if (remaining <= 0) return null;
  const nextCount = Math.min(RESULT_PAGE_SIZE, remaining);
  return (
    <button type="button" className="dsc-show-more" onClick={onClick}>
      Show {nextCount} more <span>({remaining} remaining)</span>
    </button>
  );
}

// Candidates below both thresholds are withheld from the default view, and the
// presentation rule has always allowed reaching them by category instead.
// Selecting a category is a narrower, explicit request, so it is the moment to
// show them; `All` stays the ranked recommendation list it was.
//
// Exported for test because the include patterns cover business-logic only, and
// this is the rule worth pinning rather than the markup around it.
export function selectWithheldForCategory(withheld, categoryFilter) {
  if (categoryFilter === 'all') return [];
  return (withheld || []).filter((candidate) => candidate.place?.category === categoryFilter);
}

export function homeEyebrow(user, origin) {
  if (user) return `Hi, ${(user.fullName || '').split(' ')[0] || 'there'}`;
  return `Starting from ${origin?.label || 'your starting point'}`;
}

export function buildGuidePlanningHandoff({ origin, travelDate, categoryFilter, returnTo }) {
  const explicitCategories = categoryFilter && categoryFilter !== 'all' ? [categoryFilter] : [];
  const preciseOrigin = origin && Number.isFinite(Number(origin.lat)) && Number.isFinite(Number(origin.lng))
    ? {
      label: String(origin.label || '').slice(0, 80),
      ...(origin.placeId ? { placeId: String(origin.placeId).slice(0, 180) } : {}),
      ...(origin.state ? { state: String(origin.state).slice(0, 80) } : {}),
      lat: Number(origin.lat),
      lng: Number(origin.lng)
    }
    : null;
  return {
    origin: preciseOrigin,
    travelDate: /^20\d{2}-\d{2}-\d{2}$/.test(String(travelDate || '')) ? travelDate : null,
    explicitCategories,
    returnTo: typeof returnTo === 'string' && /^\/home(?:\?|$)/.test(returnTo) ? returnTo : '/home'
  };
}

function Hero({ candidate, onOpen }) {
  const place = candidate.place;
  const seatsLeft = candidate.rides.reduce((best, ride) => Math.max(best, Number(ride.seatsAvailable) || 0), 0);
  const trafficLabel = candidate.rideStatus !== 'available'
    ? 'Ride information unavailable'
    : candidate.rides.length > 0
      ? `${candidate.rides.length} listed ride${candidate.rides.length > 1 ? 's' : ''} · ${seatsLeft > 0 ? `up to ${seatsLeft} seat${seatsLeft === 1 ? '' : 's'} in one listed ride` : 'no seats remaining'}`
      : 'No listed ride for this date';
  return (
    <button type="button" className="dsc-hero" onClick={() => onOpen(place.id)}>
      <span className="dsc-hero-media">
        <PlaceImage key={place.id} place={place} widthPx={PHOTO_WIDTH_LARGE} revealable />
        <span className="dsc-hero-scrim" />
        <span className="dsc-hero-text">
          <span className="dsc-hero-eyebrow"><IconStar size={12} /> Top pick for you</span>
          <span className="dsc-hero-title">{place.name}</span>
          <span className="dsc-hero-sub">
            {place.state}
            {Number.isFinite(candidate.distanceKm) && ` · ${Math.round(candidate.distanceKm)} km straight line`}
            {` · ${trafficLabel}`}
          </span>
        </span>
      </span>
    </button>
  );
}

const RESULT_SKELETON_ITEMS = [0, 1, 2, 3];

function ResultsSkeleton() {
  return (
    <div className="dsc-list dsc-list-skeleton" aria-hidden="true">
      {RESULT_SKELETON_ITEMS.map((item) => (
        <div className="dsc-card dsc-card-skeleton" key={item}>
          <Skeleton className="dsc-card-media" radius="var(--radius-lg)" />
          <span className="dsc-card-body">
            <Skeleton height={16} width="70%" />
            <Skeleton height={12} width="95%" />
            <Skeleton height={12} width="55%" />
          </span>
        </div>
      ))}
    </div>
  );
}

// A short, honest "what's happening" line above the fold - only when there
// genuinely is something. Deliberately built from two existing, already-scoped
// service calls rather than a new cross-ride query: pending requests the
// visitor made (RideRequestService.listMyRequests) and their own next hosted
// ride (RideService.listMyRides). Both fetch after the main recommendation
// load, and a failure here never blocks or replaces the destinations below.
function useAccountStatus(userId) {
  const [status, setStatus] = useState(null);
  // Exposed so HomeScreen's scroll-restore effect can wait for this strip's
  // own independent fetch to settle before applying a saved scrollY - it
  // mounts above the destination grid and would otherwise shift the list out
  // from under an already-applied restore.
  const [loading, setLoading] = useState(Boolean(userId));

  useEffect(() => {
    if (!userId) { setStatus(null); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const [requests, rides] = await Promise.all([
          RideRequestService.listMyRequests(userId),
          RideService.listMyRides(userId)
        ]);
        if (cancelled) return;

        const pendingRequests = (requests || []).filter((request) => request.status === 'Pending');
        const nextHostedRide = (rides?.hosting || [])
          .filter((ride) => ride.status === 'Published' && ride.departureAt)
          .sort((a, b) => new Date(a.departureAt) - new Date(b.departureAt))[0];

        setStatus({ pendingCount: pendingRequests.length, nextHostedRide: nextHostedRide || null });
      } catch (cause) {
        // A status strip is a convenience, not the page's job - fail silently
        // and simply show nothing rather than risk the destinations below.
        console.error('Account status check failed', cause);
        if (!cancelled) setStatus(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [userId]);

  return { status, loading };
}

function AccountStatusStrip({ status }) {
  const navigate = useNavigate();
  if (!status || (!status.pendingCount && !status.nextHostedRide)) return null;

  if (status.pendingCount > 0) {
    return (
      <div className="dsc-status">
        <span className="dsc-status-dot" aria-hidden="true" />
        <span>
          <strong>{status.pendingCount}</strong> join request{status.pendingCount === 1 ? '' : 's'} awaiting a host&apos;s reply
        </span>
        <button type="button" onClick={() => navigate('/ride/requests')}>My requests <IconArrowRight size={14} /></button>
      </div>
    );
  }

  const ride = status.nextHostedRide;
  return (
    <div className="dsc-status">
      <span className="dsc-status-dot" aria-hidden="true" />
      <span>Your ride to <strong>{ride.destination}</strong> departs {new Date(ride.departureAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</span>
      <button type="button" onClick={() => navigate(`/ride/${ride.id}`)}>Open ride <IconArrowRight size={14} /></button>
    </div>
  );
}

function OriginSummary({ origin, onChange }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(origin);

  useEffect(() => {
    if (open) setDraft(origin);
  }, [open, origin]);

  const draftLocation = draft && {
    placeId: draft.placeId,
    latitude: draft.lat,
    longitude: draft.lng
  };

  function save() {
    const next = saveOrigin({ ...draft, isDefault: false });
    if (!next) return;
    onChange(next);
    setOpen(false);
  }

  return (
    <div className="dsc-origin-summary">
      <button
        type="button"
        className="dsc-origin-summary__button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <IconMapPin size={15} aria-hidden="true" />
        <span>
          <span className="dsc-origin-summary__label">Starting point</span>
          <strong>{origin.label}</strong>
          {origin.isDefault && <span className="dsc-origin-summary__default"> · default</span>}
        </span>
        <span className="dsc-origin-summary__change"><IconEdit size={14} /> Change</span>
      </button>
      {origin.isDefault && (
        <p className="dsc-origin-summary__hint">Add your starting point for a more useful distance ranking.</p>
      )}

      <AdaptiveDialog
        open={open}
        className="dsc-origin-dialog"
        title="Where are you starting from?"
        description="This helps us rank nearby destinations. Distances are straight-line estimates, not driving times."
        onClose={() => setOpen(false)}
        footer={(
          <>
            <button type="button" className="dsc-btn" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="dsc-btn dsc-btn-primary" onClick={save} disabled={!draft?.label || !Number.isFinite(draft?.lat) || !Number.isFinite(draft?.lng)}>
              Use this starting point
            </button>
          </>
        )}
      >
        <ConfirmedLocationInput
          id="discovery-origin"
          label="Starting point"
          placeholder="Search for a place in Malaysia"
          value={draft?.label || ''}
          location={draftLocation}
          allowCurrentLocation
          purpose="starting-point"
          deferCurrentLocationConfirmation
          onChange={(label, location) => setDraft(location
            ? { label, lat: Number(location.latitude), lng: Number(location.longitude), placeId: location.placeId }
            : { label, lat: null, lng: null })}
          resolvePreferredLocation={(query) => {
            const resolved = resolveKnownGuideOrigin(query);
            return resolved ? {
              label: `${resolved.label}, ${resolved.state}, Malaysia`,
              latitude: resolved.lat,
              longitude: resolved.lng
            } : null;
          }}
        />
        <p className="dsc-origin-summary__dialog-note">
          Your starting point is kept in this browser tab and is not put in the public URL.
        </p>
      </AdaptiveDialog>
    </div>
  );
}

function AlternativeDateNotice({ dates, selectedDate, onSelect }) {
  if (!dates.length) return null;
  const format = (value) => new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric'
  });
  return (
    <div className="dsc-date-notice" role="status">
      <span>No listed rides match {format(selectedDate)}.</span>
      <span>Related destinations have rides on:</span>
      <span className="dsc-date-notice__options">
        {dates.slice(0, 3).map((date) => (
          <button type="button" key={date} onClick={() => onSelect(date)}>{format(date)}</button>
        ))}
      </span>
    </div>
  );
}

export default function HomeScreen() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const demo = searchParams.get('demo') === '1';
  const searchKey = searchParams.toString();
  const filters = useMemo(() => discoveryFilters(searchParams), [searchKey]);
  const { date: travelDate, category: categoryFilter, query: searchQuery } = filters;
  const includeDistant = searchParams.get('range') === 'all';
  const [origin, setOrigin] = useState(readOrigin);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [showAllWithheld, setShowAllWithheld] = useState(false);
  const [primaryLimit, setPrimaryLimit] = useState(RESULT_PAGE_SIZE);
  const [unservedLimit, setUnservedLimit] = useState(RESULT_PAGE_SIZE);
  const [categoryLimit, setCategoryLimit] = useState(RESULT_PAGE_SIZE);
  const [withheldLimit, setWithheldLimit] = useState(RESULT_PAGE_SIZE);
  const [promptChecked, setPromptChecked] = useState(false);
  const restoreAttempted = useRef(false);
  const mediaEnabled = useMediaEnabled();
  const { status: accountStatus, loading: accountStatusLoading } = useAccountStatus(user?.id);

  const updateFilter = useCallback((key, value, defaultValue = '') => {
    const next = new URLSearchParams(searchParams);
    if (value && value !== defaultValue) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const load = useCallback(async (date = travelDate, nextOrigin = origin, nextCategory = categoryFilter) => {
    setLoading(true);
    setFailed(false);
    try {
      const data = await DestinationDiscoveryService.getRecommendations({
        userId: user?.id,
        origin: nextOrigin,
        travelDate: date,
        preferredCategories: nextCategory === 'all' ? undefined : [nextCategory],
        maxDistanceKm: includeDistant ? null : DEFAULT_EXPLORATION_RADIUS_KM
      });
      setResult(data);
      return data;
    } catch (cause) {
      // A failure here is not an empty catalogue, and must not be shown as one.
      // Against the live backend the catalogue is readable by authenticated
      // users only, so a signed-out session is the likeliest cause - which the
      // screen distinguishes below, because the two remedies differ.
      console.error('Discovery recommendations failed', cause);
      setFailed(true);
      setResult(null);
      return null;
    } finally {
      // In `finally` so the screen leaves its loading state on both paths. It
      // used to sit on "Finding destinations…" forever whenever the read threw.
      setLoading(false);
    }
  }, [categoryFilter, includeDistant, origin, travelDate, user?.id]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const data = await load(travelDate);
      if (cancelled) return;
      if (!data) { setPromptChecked(true); return; }

      // The prompt is an enhancement, not part of the result. If asking whether
      // to show it fails, the destinations are still on screen and stay there.
      try {
        if (await DestinationDiscoveryService.shouldPromptForPreferences(user?.id)) {
          if (!cancelled) setShowPrompt(true);
        }
      } catch (cause) {
        console.error('Preference prompt check failed', cause);
      } finally {
        if (!cancelled) setPromptChecked(true);
      }
    })();

    return () => { cancelled = true; };
  }, [load, travelDate, user?.id]);

  const savePreferences = async (categories) => {
    await DestinationDiscoveryService.savePreferences(user?.id, { preferredCategories: categories });
    setShowPrompt(false);
    load();
  };

  const dismissPrompt = async () => {
    await DestinationDiscoveryService.savePreferences(user?.id, { promptDismissed: true });
    setShowPrompt(false);
  };

  // Opening a card is only a view. Browsing interest is an explicit action on
  // the detail screen; recording it here made every authenticated visitor look
  // interested before they had made that choice.
  const openDestination = async (placeId) => {
    saveExploreReturn(`${location.pathname}${location.search}`, window.scrollY);
    navigate(`/discover/${placeId}?date=${travelDate}${includeDistant ? '&range=all' : ''}${demo ? '&demo=1' : ''}`);
  };

  const changeOrigin = (nextOrigin) => {
    setOrigin(nextOrigin);
    saveOrigin(nextOrigin);
    if (includeDistant) updateFilter('range', '');
  };

  const startGuidePlanning = () => {
    const returnTo = `${location.pathname}${location.search}`;
    saveExploreReturn(returnTo, window.scrollY);
    navigate('/assistant', {
      state: {
        guidePlanningHandoff: buildGuidePlanningHandoff({
          origin, travelDate, categoryFilter, returnTo
        })
      }
    });
  };

  const filter = useCallback((list) => {
    const query = searchQuery.trim().toLowerCase();
    return list
      .filter((c) => categoryFilter === 'all' || c.place?.category === categoryFilter)
      .filter((c) => !query || [c.place?.name, c.place?.state, c.place?.category]
        .some((field) => field?.toLowerCase().includes(query)));
  }, [categoryFilter, searchQuery]);

  const primary = useMemo(() => filter(result?.primary || []), [result, filter]);
  const unserved = useMemo(() => filter(result?.unserved || []), [result, filter]);
  const moreInCategory = useMemo(
    () => filter(selectWithheldForCategory(result?.withheld, categoryFilter)),
    [result, categoryFilter, filter]
  );
  // Unlike moreInCategory, this is every withheld candidate regardless of
  // category - the disclosure a reader on "All" opens explicitly, rather than
  // the per-category list the filter buttons produce.
  const allWithheld = useMemo(() => filter(result?.withheld || []), [result, filter]);

  const alternativeDates = useMemo(() => {
    // Alternative dates belong to the currently visible destination set. A
    // category or text filter must never surface a date discovered only for a
    // place the traveller has filtered out.
    const visiblePlaceIds = new Set([
      ...primary, ...unserved, ...moreInCategory, ...allWithheld
    ].map((candidate) => candidate.placeId));
    return [...new Set([...visiblePlaceIds].flatMap((placeId) => result?.alternativeDates?.[placeId] || []))].sort();
  }, [allWithheld, moreInCategory, primary, result, unserved]);
  const hasActiveFilter = Boolean(searchQuery.trim()) || categoryFilter !== 'all';
  const hasVisibleResults = primary.length + unserved.length + moreInCategory.length + allWithheld.length > 0;

  // Leaving "All" and coming back should not carry over an expanded state from
  // a previous visit - the reader chose to look, once, at a specific moment.
  useEffect(() => {
    setShowAllWithheld(false);
    setPrimaryLimit(RESULT_PAGE_SIZE);
    setUnservedLimit(RESULT_PAGE_SIZE);
    setCategoryLimit(RESULT_PAGE_SIZE);
    setWithheldLimit(RESULT_PAGE_SIZE);
  }, [categoryFilter, searchQuery, result]);

  useEffect(() => {
    // Waits on every async piece that can insert content above the destination
    // grid (the account-status strip, the preference prompt) in addition to
    // the destinations themselves, so the one-shot scrollTo below is not
    // undermined by a banner mounting after it already ran.
    if (restoreAttempted.current || loading || accountStatusLoading || !promptChecked) return;
    restoreAttempted.current = true;
    // Reads sessionStorage directly rather than router state, so this applies
    // equally whether the user returned via the in-app back button (the only
    // path that used to inject restoreExploreScrollY into navigate's state) or
    // a native OS/browser back gesture (a plain history POP, which never
    // carried that state) - saveExploreReturn already runs on every
    // openDestination regardless of how the user later returns.
    const saved = consumeExploreReturn();
    const currentUrl = `${location.pathname}${location.search}`;
    if (saved.url !== currentUrl || !(saved.scrollY > 0)) return;
    window.requestAnimationFrame(() => window.scrollTo({ top: saved.scrollY, behavior: 'auto' }));
  }, [loading, accountStatusLoading, promptChecked, location.pathname, location.search]);

  // The hero is the strongest served candidate; the grid below then starts from
  // the second, so the same place is never shown twice on one screen.
  const hero = categoryFilter === 'all' ? primary[0] : null;
  const gridPrimary = hero ? primary.slice(1) : primary;

  return (
    <div className="dsc-page">
      <header className="dsc-header">
        <p className="dsc-eyebrow">{homeEyebrow(user, origin)}</p>
        <h1>Where should you go?</h1>
        <p className="dsc-lede">Ranked by how well each place suits you and the shared-ride options listed for your date.</p>

        {GUIDE_FEATURE_ENABLED && (
          <button type="button" className="dsc-ask" onClick={startGuidePlanning}>
            <span className="dsc-ask-icon" aria-hidden="true"><IconMessage size={20} /></span>
            <span className="dsc-ask-ph">Describe the day you want, and Tumpang Guide only suggests places already here</span>
            <span className="dsc-ask-go">Plan my day <IconArrowRight size={16} /></span>
          </button>
        )}
      </header>

      <AccountStatusStrip status={accountStatus} />

      <AudienceSwitch active="explore" travelDate={travelDate} demo={demo} />
      <OriginSummary origin={origin} onChange={changeOrigin} />
      {!loading && !failed && result && (includeDistant || result.outsideRadiusCount > 0) && (
        <div className="dsc-range-note" role="status">
          <span>{includeDistant
            ? 'Showing destinations across Malaysia.'
            : `Showing destinations within ${DEFAULT_EXPLORATION_RADIUS_KM} km of your starting point.`}</span>
          <button type="button" onClick={() => updateFilter('range', includeDistant ? '' : 'all')}>
            {includeDistant ? 'Show nearby only' : `Explore ${result.outsideRadiusCount} farther places`}
          </button>
        </div>
      )}
      <DemoActiveBanner />

      {demo && (
        <DemoControls
          travelDate={travelDate}
          onTravelDateChange={(date) => updateFilter('date', date)}
          onChanged={() => load()}
          userId={user?.id}
        />
      )}

      {showPrompt && <PreferencePrompt onSave={savePreferences} onDismiss={dismissPrompt} />}

      <div className="dsc-controls">
        <label className="dsc-search-field">
          <IconSearch size={16} />
          <input
            type="text"
            placeholder="Search by name, state, or category"
            value={searchQuery}
            onChange={(event) => updateFilter('q', event.target.value)}
            aria-label="Search destinations"
          />
        </label>

        <label className="dsc-field">
            <span>Travel date</span>
            <input
              type="date"
              value={travelDate}
              min={todayIso()}
              onChange={(event) => updateFilter('date', event.target.value)}
          />
        </label>

        <div className="dsc-filters" role="group" aria-label="Filter by category">
          {['all', ...Object.values(CATEGORY)].map((value) => (
            <Chip
              key={value}
              selected={categoryFilter === value}
              onClick={() => updateFilter('category', value, 'all')}
            >
              {value === 'all' ? 'All' : value}
            </Chip>
          ))}
        </div>

        {/* Off by default: every photo is a billable Places Photo request and
            Street View reloads Google's embed bootstrap, so nothing loads
            until this is on, or a specific slot is revealed one at a time
            (the top pick, the detail carousel). This is SDG 12's responsible
            consumption applied to this module's one real ongoing cost, not a
            hidden dev switch - see docs/MODULE6-API-SETUP.md §3.3. */}
        <Chip
          className="dsc-media-toggle"
          selected={mediaEnabled}
          onClick={() => toggleMediaMode()}
          title={mediaEnabled
            ? 'Photos and Street View load automatically. Turn off to browse without spending photo requests.'
            : 'Photos and Street View stay hidden until you ask - each one is a billable Google request.'}
        >
          {mediaEnabled ? <IconEye size={14} /> : <IconEyeOff size={14} />}
          {mediaEnabled ? 'Photos on' : 'Photos off'}
        </Chip>
      </div>

      {!loading && !failed && result?.rideStatus === 'unavailable' && (
        <p className="dsc-traffic-notice" role="status">
          Ride information is temporarily unavailable. Destinations are still shown; try again later to see current ride options.
        </p>
      )}

      {!loading && !failed && result && primary.length === 0 && result.rideStatus === 'available' && (
        <AlternativeDateNotice
          dates={alternativeDates}
          selectedDate={travelDate}
          onSelect={(date) => updateFilter('date', date)}
        />
      )}

      {loading && <ResultsSkeleton />}

      {/* A failed read is not an empty catalogue. Saying "no destinations"
          here would blame the data for what is actually an access or network
          problem, and leave the reader with nothing to act on. */}
      {!loading && failed && (
        <div className="dsc-empty dsc-failed" role="alert">
          <p className="dsc-failed-title">We could not load destinations.</p>
          <p>The place catalogue did not respond. It may be a connection problem.</p>
          <button type="button" className="dsc-failed-action" onClick={() => load()}>
            Try again
          </button>
        </div>
      )}

      {!loading && !failed && (
        hasActiveFilter && !hasVisibleResults ? (
          <div className="dsc-empty dsc-filtered-empty" role="status">
            <p>No destinations match these filters.</p>
            <button
              type="button"
              className="dsc-failed-action"
              onClick={() => {
                const next = new URLSearchParams(searchParams);
                next.delete('q');
                next.delete('category');
                setSearchParams(next, { replace: true });
              }}
            >
              Clear filters
            </button>
          </div>
        ) : <>
          {hero && <Hero candidate={hero} onOpen={openDestination} />}

          <section className="dsc-section">
            <div className="dsc-section-head">
              <h2>Best matches for your day</h2>
              {gridPrimary.length > 0 && (
                <span className="dsc-count">{gridPrimary.length} more</span>
              )}
            </div>
            <p className="dsc-section-note">Ranked by fit, distance and the signals available for your selected date.</p>

            {gridPrimary.length === 0 ? (
              <div className="dsc-empty">
                <p>
                  {hero
                    ? 'That is the only destination in the top matches for these conditions.'
                    : 'No recommended destinations match this date and your current conditions.'}
                </p>
                {/* A blank top section next to a populated catalogue reads as
                    "the app is broken" to a first-time visitor. Point at the
                    section that actually holds the candidates instead of
                    leaving the page looking empty. */}
                {!hero && unserved.length > 0 && (
                  <p className="dsc-empty-hint">
                    {unserved.length} more destination{unserved.length === 1 ? '' : 's'} did not
                    meet today's ranking thresholds but {unserved.length === 1 ? 'is' : 'are'} listed
                    under "More places to explore" below.
                  </p>
                )}
              </div>
            ) : (
              <div className="dsc-list">
                {gridPrimary.slice(0, primaryLimit).map((candidate, index) => (
                  <DestinationCard key={candidate.placeId} candidate={candidate} onOpen={openDestination} index={index} />
                ))}
              </div>
            )}
            <ShowMore
              remaining={Math.max(0, gridPrimary.length - primaryLimit)}
              onClick={() => setPrimaryLimit((limit) => limit + RESULT_PAGE_SIZE)}
            />
          </section>

          <section className="dsc-section">
            <div className="dsc-section-head">
              <h2>More places to explore</h2>
              {/* UC6.7 is a different question for a different person, so it gets
                  its own screen rather than another filter on this one. */}
              <button
                type="button"
                className="dsc-rail-link"
                onClick={() => navigate(`/discover/demand?date=${travelDate}`)}
              >
                For drivers: see travel demand <IconArrowRight size={14} />
              </button>
            </div>
            <p className="dsc-section-note">
              Further matches for this date. Check each card for its current travel option.
            </p>

            {unserved.length === 0 ? (
              <p className="dsc-empty">No more destinations match these conditions.</p>
            ) : (
              <div className="dsc-list">
                {unserved.slice(0, unservedLimit).map((candidate, index) => (
                  <DestinationCard key={candidate.placeId} candidate={candidate} onOpen={openDestination} index={index} />
                ))}
              </div>
            )}
            <ShowMore
              remaining={Math.max(0, unserved.length - unservedLimit)}
              onClick={() => setUnservedLimit((limit) => limit + RESULT_PAGE_SIZE)}
            />
          </section>

          {/* FR-6.19: reachable by category, withheld from the default view.
              Named for what it is, so an empty ranked list plus a populated
              catalogue does not read as "the API returned nothing". */}
          {moreInCategory.length > 0 && (
            <section className="dsc-section">
              <div className="dsc-section-head">
                <h2>More {categoryFilter} places</h2>
                <span className="dsc-count">{moreInCategory.length}</span>
              </div>
              <p className="dsc-section-note">
                Other places in this category are available to explore below the main recommendations.
              </p>
              <div className="dsc-list">
                {moreInCategory.slice(0, categoryLimit).map((candidate, index) => (
                  <DestinationCard key={candidate.placeId} candidate={candidate} onOpen={openDestination} index={index} />
                ))}
              </div>
              <ShowMore
                remaining={Math.max(0, moreInCategory.length - categoryLimit)}
                onClick={() => setCategoryLimit((limit) => limit + RESULT_PAGE_SIZE)}
              />
            </section>
          )}

          {result?.weatherWithheld?.length > 0 && (
            <p className="dsc-withheld">
              <IconAlertTriangle size={14} />
              {result.weatherWithheld.length} outdoor destination
              {result.weatherWithheld.length > 1 ? 's are' : ' is'} hidden — a severe weather
              warning applies to this date.
            </p>
          )}

          {/* "All" keeps selectWithheldForCategory's tested "always []" contract
              intact - this reads straight from result.withheld instead, so a
              reader who has not narrowed to one category can still ask to see
              everything below the threshold in one place. */}
          {categoryFilter === 'all' && allWithheld.length > 0 && (
            <section className="dsc-section">
              <button
                type="button"
                className="dsc-working-toggle"
                onClick={() => setShowAllWithheld((open) => !open)}
                aria-expanded={showAllWithheld}
              >
                <IconArrowRight size={14} className={showAllWithheld ? 'dsc-caret-open' : ''} />
                {showAllWithheld
                  ? 'Hide the rest'
                  : `${allWithheld.length} further destination${allWithheld.length > 1 ? 's are' : ' is'} below the recommendation thresholds for this date — see them`}
              </button>

              {showAllWithheld && (
                <div className="dsc-list">
                  {allWithheld.slice(0, withheldLimit).map((candidate, index) => (
                    <DestinationCard key={candidate.placeId} candidate={candidate} onOpen={openDestination} index={index} />
                  ))}
                </div>
              )}
              {showAllWithheld && (
                <ShowMore
                  remaining={Math.max(0, allWithheld.length - withheldLimit)}
                  onClick={() => setWithheldLimit((limit) => limit + RESULT_PAGE_SIZE)}
                />
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
