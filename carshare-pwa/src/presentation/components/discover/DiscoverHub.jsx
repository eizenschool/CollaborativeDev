// ===== PRESENTATION LAYER (DiscoverHub) =====
// UC6.1 - the discovery view for a traveller with no destination in mind.
//
// Laid out as two sections because they ask for different things: destinations a
// ride already serves lead with the seats remaining, and destinations nobody
// serves lead with the demand that would justify driving there. Candidates below
// both thresholds are withheld from the default view and reachable only by
// category browsing, as the presentation rule requires.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import { DestinationDiscoveryService } from '../../../business-logic/discovery/DestinationDiscoveryService.js';
import { CATEGORY } from '../../../business-logic/discovery/constants.js';
import { todayIso } from '../../../business-logic/discovery/localDate.js';
import { IconSearch, IconAlertTriangle, IconStar, IconArrowRight } from '../icons.jsx';
import DestinationCard from './DestinationCard.jsx';
import PreferencePrompt from './PreferencePrompt.jsx';
import PlacePoster from './PlacePoster.jsx';
import AudienceSwitch from './AudienceSwitch.jsx';
import DemoControls, { DemoActiveBanner } from './DemoControls.jsx';

// Kuala Lumpur city centre, standing in for the device location until the
// geolocation permission flow lands. UC6.1 A1 asks for a location rather than
// requiring one, so a default keeps the journey-cost signal meaningful instead
// of dropping it entirely.
const DEFAULT_ORIGIN = { lat: 3.1390, lng: 101.6869, label: 'Kuala Lumpur' };

const today = todayIso;

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
        <PlacePoster seed={place.id} category={place.category} />
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

export default function DiscoverHub() {
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
  const [dateAdjusted, setDateAdjusted] = useState(false);

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

  const filter = useCallback((list) => (
    categoryFilter === 'all' ? list : list.filter((c) => c.place?.category === categoryFilter)
  ), [categoryFilter]);

  const primary = useMemo(() => filter(result?.primary || []), [result, filter]);
  const unserved = useMemo(() => filter(result?.unserved || []), [result, filter]);
  const moreInCategory = useMemo(
    () => selectWithheldForCategory(result?.withheld, categoryFilter),
    [result, categoryFilter]
  );

  // The hero is the strongest served candidate; the grid below then starts from
  // the second, so the same place is never shown twice on one screen.
  const hero = categoryFilter === 'all' ? primary[0] : null;
  const gridPrimary = hero ? primary.slice(1) : primary;

  return (
    <div className="dsc-page">
      <header className="dsc-header">
        <h1>Where should you go?</h1>
        <p>Ranked by how well each place suits you and how easily you can get there.</p>
      </header>

      <AudienceSwitch active="explore" travelDate={travelDate} demo={demo} />
      <DemoActiveBanner />

      {demo && (
        <DemoControls
          travelDate={travelDate}
          onTravelDateChange={(date) => { setDateAdjusted(true); setTravelDate(date); }}
          onChanged={() => load(travelDate)}
        />
      )}

      {showPrompt && <PreferencePrompt onSave={savePreferences} onDismiss={dismissPrompt} />}

      <div className="dsc-controls">
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
            <button
              key={value}
              type="button"
              className={'dsc-filter' + (categoryFilter === value ? ' active' : '')}
              onClick={() => setCategoryFilter(value)}
              aria-pressed={categoryFilter === value}
            >
              {value === 'all' ? 'All' : value}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="dsc-empty">Finding destinations…</p>}

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
                {gridPrimary.map((candidate) => (
                  <DestinationCard key={candidate.placeId} candidate={candidate} onOpen={openDestination} />
                ))}
              </div>
            )}
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
                {unserved.map((candidate) => (
                  <DestinationCard key={candidate.placeId} candidate={candidate} onOpen={openDestination} />
                ))}
              </div>
            )}
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
                {moreInCategory.map((candidate) => (
                  <DestinationCard key={candidate.placeId} candidate={candidate} onOpen={openDestination} />
                ))}
              </div>
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

          {categoryFilter === 'all' && result?.withheld?.length > 0 && (
            <p className="dsc-withheld">
              <IconSearch size={14} />
              {result.withheld.length} further destination
              {result.withheld.length > 1 ? 's are' : ' is'} below the recommendation thresholds
              for this date — pick a category above to browse them.
            </p>
          )}
        </>
      )}
    </div>
  );
}
