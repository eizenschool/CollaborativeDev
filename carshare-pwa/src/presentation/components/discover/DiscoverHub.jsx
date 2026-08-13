// ===== PRESENTATION LAYER (DiscoverHub) =====
// UC6.1 - the discovery view for a traveller who has no destination in mind.
//
// Two sections, because they call for different actions: destinations a ride
// already serves lead with the seats remaining, and destinations nobody serves
// lead with the group-formation prompt. Candidates below both thresholds are
// withheld from the default view entirely, reachable only by category browsing.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import { DestinationDiscoveryService } from '../../../business-logic/discovery/DestinationDiscoveryService.js';
import { CATEGORY } from '../../../business-logic/discovery/constants.js';
import { IconSearch, IconAlertTriangle } from '../icons.jsx';
import DestinationCard from './DestinationCard.jsx';
import PreferencePrompt from './PreferencePrompt.jsx';

// Kuala Lumpur city centre. Stands in for the device location until the browser
// geolocation permission flow lands - UC6.1 A1 asks for a location rather than
// making one mandatory, so a default keeps the journey-cost signal meaningful
// instead of dropping it.
const DEFAULT_ORIGIN = { lat: 3.1390, lng: 101.6869, label: 'Kuala Lumpur' };

const today = () => new Date().toISOString().slice(0, 10);

export default function DiscoverHub() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [travelDate, setTravelDate] = useState(today);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showPrompt, setShowPrompt] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [notice, setNotice] = useState('');
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
      // would show an empty served list and misrepresent the platform as having
      // no rides at all, when it simply has none *that* day.
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
    navigate(`/discover/${placeId}`);
  };

  const findRide = async (place) => {
    await DestinationDiscoveryService.recordInterest(user?.id, place.id, travelDate);
    navigate('/ride');
  };

  const offerDrive = async (place) => {
    await DestinationDiscoveryService.recordInterest(user?.id, place.id, travelDate);
    navigate('/ride/publish');
  };

  const notifyMe = async (place) => {
    const { alreadyExisted } = await DestinationDiscoveryService
      .registerForNotification(user?.id, place.id, travelDate);
    setNotice(alreadyExisted
      ? `You are already registered for ${place.name}.`
      : `We will tell you when a ride to ${place.name} is published.`);
    load(travelDate);
  };

  const filter = useCallback((list) => (
    categoryFilter === 'all' ? list : list.filter((c) => c.place?.category === categoryFilter)
  ), [categoryFilter]);

  const primary = useMemo(() => filter(result?.primary || []), [result, filter]);
  const unserved = useMemo(() => filter(result?.unserved || []), [result, filter]);

  const cardHandlers = {
    onOpen: openDestination,
    onFindRide: findRide,
    onOfferDrive: offerDrive,
    onNotify: notifyMe
  };

  return (
    <div className="dsc-page">
      <header className="dsc-header">
        <h1>Where should you go?</h1>
        <p>Destinations near you, ranked by how well they suit you and how easily you can get there.</p>
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
            >
              {value === 'all' ? 'All' : value}
            </button>
          ))}
        </div>
      </div>

      {notice && <p className="dsc-notice">{notice}</p>}

      {loading && <p className="dsc-empty">Finding destinations…</p>}

      {!loading && (
        <>
          <section className="dsc-section">
            <h2>Rides are already going here</h2>
            {primary.length === 0 ? (
              <p className="dsc-empty">
                No ride serves a recommended destination on this date. The
                destinations below still need a driver.
              </p>
            ) : (
              <div className="dsc-list">
                {primary.map((candidate) => (
                  <DestinationCard key={candidate.placeId} candidate={candidate} {...cardHandlers} />
                ))}
              </div>
            )}
          </section>

          <section className="dsc-section">
            <h2>Nobody is driving here yet</h2>
            {unserved.length === 0 ? (
              <p className="dsc-empty">Every destination people want is already covered.</p>
            ) : (
              <div className="dsc-list">
                {unserved.map((candidate) => (
                  <DestinationCard key={candidate.placeId} candidate={candidate} {...cardHandlers} />
                ))}
              </div>
            )}
          </section>

          {result?.weatherWithheld?.length > 0 && (
            <p className="dsc-withheld">
              <IconAlertTriangle size={14} />
              {result.weatherWithheld.length} outdoor destination
              {result.weatherWithheld.length > 1 ? 's are' : ' is'} hidden because a severe
              weather warning applies to this date.
            </p>
          )}

          {result?.withheld?.length > 0 && (
            <p className="dsc-withheld">
              <IconSearch size={14} />
              {result.withheld.length} further destination
              {result.withheld.length > 1 ? 's are' : ' is'} below the recommendation
              thresholds for this date.
            </p>
          )}
        </>
      )}
    </div>
  );
}
