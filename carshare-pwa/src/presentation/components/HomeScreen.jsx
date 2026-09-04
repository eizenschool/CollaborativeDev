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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { DestinationDiscoveryService } from '../../business-logic/discovery/DestinationDiscoveryService.js';
import { CATEGORY } from '../../business-logic/discovery/constants.js';
import { todayIso } from '../../business-logic/discovery/localDate.js';
import { GUIDE_FEATURE_ENABLED } from '../../business-logic/guide/constants.js';
import { RideRequestService } from '../../business-logic/RideRequestService.js';
import { RideService } from '../../business-logic/RideService.js';
import {
  IconAlertTriangle, IconArrowRight, IconEye, IconEyeOff, IconMessage, IconSearch, IconStar
} from './icons.jsx';
import DestinationCard from './discover/DestinationCard.jsx';
import PreferencePrompt from './discover/PreferencePrompt.jsx';
import { PHOTO_WIDTH_LARGE } from '../../business-logic/discovery/placePhotos.js';
import PlaceImage from './discover/PlaceImage.jsx';
import { useMediaEnabled } from './discover/useMediaMode.js';
import { toggleMediaMode } from '../../business-logic/discovery/mediaMode.js';
import AudienceSwitch from './discover/AudienceSwitch.jsx';
import DemoControls, { DemoActiveBanner } from './discover/DemoControls.jsx';
import '../styles/discover.css';
import { Chip, Skeleton } from './ui/Primitives.jsx';

// Kuala Lumpur city centre, standing in for the device location until the
// geolocation permission flow lands. UC6.1 A1 asks for a location rather than
// requiring one, so a default keeps the journey-cost signal meaningful instead
// of dropping it entirely.
const DEFAULT_ORIGIN = { lat: 3.1390, lng: 101.6869, label: 'Kuala Lumpur' };

const today = todayIso;
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

function Hero({ candidate, onOpen }) {
  const place = candidate.place;
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
            {Number.isFinite(candidate.distanceKm) && ` · ${Math.round(candidate.distanceKm)} km away`}
            {candidate.rides.length > 0 && ` · ${candidate.rides.length} ride${candidate.rides.length > 1 ? 's' : ''} going`}
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

  useEffect(() => {
    if (!userId) { setStatus(null); return; }
    let cancelled = false;

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
      }
    })();

    return () => { cancelled = true; };
  }, [userId]);

  return status;
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

export default function HomeScreen() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const demo = searchParams.get('demo') === '1';

  const [travelDate, setTravelDate] = useState(() => searchParams.get('date') || today());
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateAdjusted, setDateAdjusted] = useState(false);
  const [showAllWithheld, setShowAllWithheld] = useState(false);
  const [primaryLimit, setPrimaryLimit] = useState(RESULT_PAGE_SIZE);
  const [unservedLimit, setUnservedLimit] = useState(RESULT_PAGE_SIZE);
  const [categoryLimit, setCategoryLimit] = useState(RESULT_PAGE_SIZE);
  const [withheldLimit, setWithheldLimit] = useState(RESULT_PAGE_SIZE);
  const mediaEnabled = useMediaEnabled();
  const accountStatus = useAccountStatus(user?.id);

  const load = useCallback(async (date) => {
    setLoading(true);
    setFailed(false);
    try {
      const data = await DestinationDiscoveryService.getRecommendations({
        userId: user?.id,
        origin: DEFAULT_ORIGIN,
        travelDate: date
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
  }, [user?.id]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const data = await load(travelDate);
      // `load` reports its own failure; there is nothing further to decide
      // without a result, and the date-adjustment below would read undefined.
      if (cancelled || !data) return;

      // Open on a date that actually has departures. Landing on a day with none
      // shows an empty served list and misrepresents the platform as having no
      // rides at all, when it simply has none that day.
      if (!dateAdjusted && data.primary.length === 0 && data.departureDates?.length) {
        const upcoming = data.departureDates.find((d) => d >= travelDate) || data.departureDates[0];
        if (upcoming && upcoming !== travelDate) {
          setDateAdjusted(true);
          setTravelDate(upcoming);
          return;
        }
      }

      // The prompt is an enhancement, not part of the result. If asking whether
      // to show it fails, the destinations are still on screen and stay there.
      try {
        if (await DestinationDiscoveryService.shouldPromptForPreferences(user?.id)) {
          if (!cancelled) setShowPrompt(true);
        }
      } catch (cause) {
        console.error('Preference prompt check failed', cause);
      }
    })();

    return () => { cancelled = true; };
  }, [load, travelDate, dateAdjusted, user?.id]);

  const savePreferences = async (categories) => {
    await DestinationDiscoveryService.savePreferences(user?.id, { preferredCategories: categories });
    setShowPrompt(false);
    load(travelDate);
  };

  const dismissPrompt = async () => {
    await DestinationDiscoveryService.savePreferences(user?.id, { promptDismissed: true });
    setShowPrompt(false);
  };

  // FR-6.30: interest is recorded on selection, before any onward commitment,
  // because choosing to look at a destination is itself the weak signal.
  const openDestination = async (placeId) => {
    await DestinationDiscoveryService.recordInterest(user?.id, placeId, travelDate);
    navigate(`/discover/${placeId}?date=${travelDate}${demo ? '&demo=1' : ''}`);
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
    () => selectWithheldForCategory(result?.withheld, categoryFilter),
    [result, categoryFilter]
  );
  // Unlike moreInCategory, this is every withheld candidate regardless of
  // category - the disclosure a reader on "All" opens explicitly, rather than
  // the per-category list the filter buttons produce.
  const allWithheld = useMemo(() => result?.withheld || [], [result]);

  // Leaving "All" and coming back should not carry over an expanded state from
  // a previous visit - the reader chose to look, once, at a specific moment.
  useEffect(() => {
    setShowAllWithheld(false);
    setPrimaryLimit(RESULT_PAGE_SIZE);
    setUnservedLimit(RESULT_PAGE_SIZE);
    setCategoryLimit(RESULT_PAGE_SIZE);
    setWithheldLimit(RESULT_PAGE_SIZE);
  }, [categoryFilter, searchQuery, result]);

  // The hero is the strongest served candidate; the grid below then starts from
  // the second, so the same place is never shown twice on one screen.
  const hero = categoryFilter === 'all' ? primary[0] : null;
  const gridPrimary = hero ? primary.slice(1) : primary;

  return (
    <div className="dsc-page">
      <header className="dsc-header">
        <p className="dsc-eyebrow">{user ? `Hi, ${(user.fullName || '').split(' ')[0] || 'there'}` : 'Kuala Lumpur'}</p>
        <h1>Where should you go?</h1>
        <p className="dsc-lede">Ranked by how well each place suits you and how easily you can get there.</p>

        {GUIDE_FEATURE_ENABLED && (
          <button type="button" className="dsc-ask" onClick={() => navigate('/assistant')}>
            <span className="dsc-ask-icon" aria-hidden="true"><IconMessage size={20} /></span>
            <span className="dsc-ask-ph">Describe the day you want, and Tumpang Guide only suggests places already here</span>
            <span className="dsc-ask-go">Plan my day <IconArrowRight size={16} /></span>
          </button>
        )}
      </header>

      <AccountStatusStrip status={accountStatus} />

      <AudienceSwitch active="explore" travelDate={travelDate} demo={demo} />
      <DemoActiveBanner />

      {demo && (
        <DemoControls
          travelDate={travelDate}
          onTravelDateChange={(date) => { setDateAdjusted(true); setTravelDate(date); }}
          onChanged={() => load(travelDate)}
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
            onChange={(event) => setSearchQuery(event.target.value)}
            aria-label="Search destinations"
          />
        </label>

        <label className="dsc-field">
          <span>Travel date</span>
          <input
            type="date"
            value={travelDate}
            onChange={(event) => { setDateAdjusted(true); setTravelDate(event.target.value); }}
          />
        </label>

        <div className="dsc-filters" role="group" aria-label="Filter by category">
          {['all', ...Object.values(CATEGORY)].map((value) => (
            <Chip
              key={value}
              selected={categoryFilter === value}
              onClick={() => setCategoryFilter(value)}
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

      {loading && <ResultsSkeleton />}

      {/* A failed read is not an empty catalogue. Saying "no destinations"
          here would blame the data for what is actually an access or network
          problem, and leave the reader with nothing to act on. */}
      {!loading && failed && (
        <div className="dsc-empty dsc-failed" role="alert">
          {user ? (
            <>
              <p className="dsc-failed-title">We could not load destinations.</p>
              <p>The place catalogue did not respond. It may be a connection problem.</p>
              <button type="button" className="dsc-failed-action" onClick={() => load(travelDate)}>
                Try again
              </button>
            </>
          ) : (
            <>
              <p className="dsc-failed-title">Sign in to see destinations.</p>
              <p>The place catalogue is available to signed-in members.</p>
              <button
                type="button"
                className="dsc-failed-action"
                onClick={() => navigate('/auth', {
                  state: {
                    from: `${location.pathname}${location.search}`,
                    reason: 'Sign in to discover destinations.'
                  }
                })}
              >
                Sign in
              </button>
            </>
          )}
        </div>
      )}

      {!loading && !failed && (
        <>
          {hero && <Hero candidate={hero} onOpen={openDestination} />}

          <section className="dsc-section">
            <div className="dsc-section-head">
              <h2>Rides are already going here</h2>
              {gridPrimary.length > 0 && (
                <span className="dsc-count">{gridPrimary.length} more</span>
              )}
            </div>
            <p className="dsc-section-note">Take a seat that is already on the road.</p>

            {gridPrimary.length === 0 ? (
              <p className="dsc-empty">
                {hero
                  ? 'That is the only destination with a ride on this date.'
                  : 'No ride serves a recommended destination on this date. The places below still need a driver.'}
              </p>
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
              <h2>Nobody is driving here yet</h2>
              {/* UC6.7 is a different question for a different person, so it gets
                  its own screen rather than another filter on this one. */}
              <button
                type="button"
                className="dsc-rail-link"
                onClick={() => navigate(`/discover/demand?date=${travelDate}`)}
              >
                Where is demand? <IconArrowRight size={14} />
              </button>
            </div>
            <p className="dsc-section-note">
              Places people want to reach. Offer to drive and the seats fill themselves.
            </p>

            {unserved.length === 0 ? (
              <p className="dsc-empty">Every destination people want is already covered.</p>
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
                Below the recommendation threshold for this date - no ride serves them and
                nobody has asked to go yet. Open one to register interest.
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
