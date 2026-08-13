// ===== PRESENTATION LAYER (DiscoverRail) =====
// Module 6's contribution to the shared home screen.
//
// The rail lives here rather than inside HomeScreen so the shared file needs one
// import and one element, and never has to know about this module's service,
// scoring, or data shape. If Destination Discovery changes, HomeScreen does not.
//
// When there is nothing to recommend it keeps its heading and its link, and
// says so briefly. It used to return null instead, which removed Discovery's
// only entry point from the home screen on exactly the days a traveller with no
// destination in mind most needs it - and did the same, silently, whenever the
// catalogue read failed.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import { DestinationDiscoveryService } from '../../../business-logic/discovery/DestinationDiscoveryService.js';
import { IconArrowRight, IconCar, IconUsers } from '../icons.jsx';
import PlacePoster from './PlacePoster.jsx';
import '../../styles/discover.css';

const DEFAULT_ORIGIN = { lat: 3.1390, lng: 101.6869, label: 'Kuala Lumpur' };
const RAIL_SIZE = 6;

export default function DiscoverRail() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [travelDate, setTravelDate] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const today = new Date().toISOString().slice(0, 10);

      try {
        // Ask which dates have departures before scoring anything. The rail used to
        // run a full recommendation pass on today, discover there were no rides,
        // then run a second one on the next departure date - paying for two rounds
        // of weather and ride lookups to render one row of cards.
        const dates = await DestinationDiscoveryService.getDepartureDates();
        const date = dates.find((d) => d >= today) || dates[0] || today;

        const data = await DestinationDiscoveryService.getRecommendations({
          userId: user?.id, origin: DEFAULT_ORIGIN, travelDate: date
        });

        if (cancelled) return;
        setTravelDate(date);
        setItems([...data.primary, ...data.unserved].slice(0, RAIL_SIZE));
      } catch (cause) {
        // Home must not lose its Discovery entry because one read failed.
        console.error('Discover rail failed to load', cause);
        if (!cancelled) setFailed(true);
      }
    })();

    return () => { cancelled = true; };
  }, [user?.id]);

  const open = async (placeId) => {
    await DestinationDiscoveryService.recordInterest(user?.id, placeId, travelDate);
    navigate(`/discover/${placeId}?date=${travelDate}`);
  };

  return (
    <section className="dsc-rail">
      <div className="dsc-rail-head">
        <h2>Where to today?</h2>
        <button type="button" className="dsc-rail-link" onClick={() => navigate('/discover')}>
          See all <IconArrowRight size={14} />
        </button>
      </div>
      <p className="dsc-rail-sub">
        {items.length > 0
          ? 'Destinations picked for you, and the seats going there.'
          : failed
            ? 'We could not load destinations just now.'
            : 'Nothing is ranked for today yet - browse the full catalogue by category.'}
      </p>

      {items.length === 0 ? (
        <button type="button" className="dsc-rail-cta" onClick={() => navigate('/discover')}>
          Discover destinations <IconArrowRight size={14} />
        </button>
      ) : (
      <div className="dsc-rail-track">
        {items.map((candidate) => {
          const place = candidate.place;
          const seatsLeft = candidate.rides.reduce((best, r) => Math.max(best, r.seatsAvailable || 0), 0);
          return (
            <button
              type="button"
              className="dsc-rail-item"
              key={candidate.placeId}
              onClick={() => open(place.id)}
            >
              <span className="dsc-rail-media">
                <PlacePoster seed={place.id} category={place.category} />
              </span>
              <span className="dsc-rail-body">
                <span className="dsc-rail-title">{place.name}</span>
                <span className="dsc-rail-meta">
                  {candidate.servedByRide ? (
                    <><IconCar size={12} /> {seatsLeft} seat{seatsLeft === 1 ? '' : 's'} left</>
                  ) : (
                    <><IconUsers size={12} /> Needs a driver</>
                  )}
                  {' · '}{place.state}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      )}
    </section>
  );
}
