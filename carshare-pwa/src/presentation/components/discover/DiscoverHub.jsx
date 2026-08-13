// ===== PRESENTATION LAYER (DiscoverHub) =====
// UC6.1 - the discovery view for a traveller with no destination in mind.
//
// Laid out as two sections because they ask for different things: destinations a
// ride already serves lead with the seats remaining, and destinations nobody
// serves lead with the demand that would justify driving there. Candidates below
// both thresholds are withheld from the default view and reachable only by
// category browsing, as the presentation rule requires.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import { DestinationDiscoveryService } from '../../../business-logic/discovery/DestinationDiscoveryService.js';
import { CATEGORY } from '../../../business-logic/discovery/constants.js';
import { IconSearch, IconAlertTriangle, IconStar, IconArrowRight } from '../icons.jsx';
import DestinationCard from './DestinationCard.jsx';
import PreferencePrompt from './PreferencePrompt.jsx';
import PlacePoster from './PlacePoster.jsx';

// Kuala Lumpur city centre, standing in for the device location until the
// geolocation permission flow lands. UC6.1 A1 asks for a location rather than
// requiring one, so a default keeps the journey-cost signal meaningful instead
// of dropping it entirely.
const DEFAULT_ORIGIN = { lat: 3.1390, lng: 101.6869, label: 'Kuala Lumpur' };

const today = () => new Date().toISOString().slice(0, 10);

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

  const [travelDate, setTravelDate] = useState(today);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showPrompt, setShowPrompt] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [dateAdjusted, setDateAdjusted] = useState(false);

  const load = useCallback(async (date) => {
    setLoading(true);
    const data = await DestinationDiscoveryService.getRecommendations({
      userId: user?.id,
      origin: DEFAULT_ORIGIN,
      travelDate: date
    });
    setResult(data);
    setLoading(false);
    return data;
  }, [user?.id]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const data = await load(travelDate);
      if (cancelled) return;

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

      if (await DestinationDiscoveryService.shouldPromptForPreferences(user?.id)) {
        if (!cancelled) setShowPrompt(true);
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
    navigate(`/discover/${placeId}?date=${travelDate}`);
  };

  const filter = useCallback((list) => (
    categoryFilter === 'all' ? list : list.filter((c) => c.place?.category === categoryFilter)
  ), [categoryFilter]);

  const primary = useMemo(() => filter(result?.primary || []), [result, filter]);
  const unserved = useMemo(() => filter(result?.unserved || []), [result, filter]);

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

      {!loading && (
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

          {result?.weatherWithheld?.length > 0 && (
            <p className="dsc-withheld">
              <IconAlertTriangle size={14} />
              {result.weatherWithheld.length} outdoor destination
              {result.weatherWithheld.length > 1 ? 's are' : ' is'} hidden — a severe weather
              warning applies to this date.
            </p>
          )}

          {result?.withheld?.length > 0 && (
            <p className="dsc-withheld">
              <IconSearch size={14} />
              {result.withheld.length} further destination
              {result.withheld.length > 1 ? 's are' : ' is'} below the recommendation thresholds
              for this date.
            </p>
          )}
        </>
      )}
    </div>
  );
}
