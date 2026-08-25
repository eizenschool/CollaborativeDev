import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import { FavouriteService } from '../../../business-logic/FavouriteService.js';
import { buildSimilarSearchCriteria, smartSearchCriteriaToParams } from '../../../business-logic/SmartSearchService.js';
import { IconHeart, IconSearch } from '../icons.jsx';
import { SearchRideCard } from './RideCards.jsx';
import { AsyncState } from '../ui/Primitives.jsx';
import { Button } from '../ui/Button.jsx';
import { RouteLoading } from '../ui/RouteState.jsx';
import '../../styles/search.css';

export default function FavouritePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [rides, setRides] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pendingRideId, setPendingRideId] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      setRides(await FavouriteService.list(user.id));
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [user.id]);

  async function remove(rideId) {
    setPendingRideId(rideId);
    setError('');
    try {
      await FavouriteService.remove(user.id, rideId);
      setRides((current) => current.filter((ride) => ride.id !== rideId));
    } catch (removeError) {
      setError(removeError.message);
    } finally {
      setPendingRideId('');
    }
  }

  function findSimilar(ride) {
    const params = smartSearchCriteriaToParams(buildSimilarSearchCriteria(ride));
    navigate(`/search?${params.toString()}`);
  }

  return (
    <main className="favourite-page">
      <header className="favourite-hero">
        <span aria-hidden="true"><IconHeart size={25} /></span>
        <div><p>YOUR SHORTLIST</p><h1>Favourite rides</h1><small>Saved journeys stay here even when their availability changes.</small></div>
      </header>

      {error && (
        <AsyncState title="Favourite rides could not be loaded" tone="error" action={<Button onClick={load}>Try again</Button>}>
          <p>{error}</p>
        </AsyncState>
      )}
      {loading && <RouteLoading label="Refreshing saved rides" />}

      {!loading && !error && rides.length === 0 && (
        <AsyncState
          className="favourite-empty"
          icon={<IconHeart size={30} />}
          title="No favourite rides yet"
          action={<Button onClick={() => navigate('/search')}><IconSearch size={15} aria-hidden="true" /> Browse rides</Button>}
        >
          <p>Save a promising ride from Smart Search and it will appear here.</p>
        </AsyncState>
      )}

      <section className="favourite-grid" aria-label="Saved rides" aria-busy={loading}>
        {rides.map((ride) => (
          <SearchRideCard
            key={ride.id}
            ride={ride}
            saved
            unavailable={!ride.favouriteAvailable}
            favouritePending={pendingRideId === ride.id}
            onToggleFavourite={() => remove(ride.id)}
            onView={() => navigate(`/ride/${ride.id}`, { state: { returnTo: '/favourite' } })}
            onFindSimilar={() => findSimilar(ride)}
          />
        ))}
      </section>
    </main>
  );
}
