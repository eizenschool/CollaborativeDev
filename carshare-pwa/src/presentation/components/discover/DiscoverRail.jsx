// ===== PRESENTATION LAYER (DiscoverRail) =====
// Module 6's contribution to the shared home screen.
//
// The rail lives here rather than inside HomeScreen so the shared file needs one
// import and one element, and never has to know about this module's service,
// scoring, or data shape. If Destination Discovery changes, HomeScreen does not.
//
// It renders nothing at all when there is nothing worth showing - a home screen
// should not carry an empty section explaining why it is empty.
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

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const today = new Date().toISOString().slice(0, 10);
      let data = await DestinationDiscoveryService.getRecommendations({
        userId: user?.id, origin: DEFAULT_ORIGIN, travelDate: today
      });

      // Prefer a date that actually has departures, so the rail leads with places
      // someone is already driving to rather than with an all-unserved list.
      const upcoming = data.departureDates?.find((d) => d >= today) || data.departureDates?.[0];
      let date = today;
      if (data.primary.length === 0 && upcoming && upcoming !== today) {
        date = upcoming;
        data = await DestinationDiscoveryService.getRecommendations({
          userId: user?.id, origin: DEFAULT_ORIGIN, travelDate: date
        });
      }

      if (cancelled) return;
      setTravelDate(date);
      setItems([...data.primary, ...data.unserved].slice(0, RAIL_SIZE));
    })();

    return () => { cancelled = true; };
  }, [user?.id]);

  if (items.length === 0) return null;

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
      <p className="dsc-rail-sub">Destinations picked for you, and the seats going there.</p>

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
    </section>
  );
}
