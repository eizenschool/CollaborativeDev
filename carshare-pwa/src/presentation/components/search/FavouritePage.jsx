import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import { FavouriteService } from '../../../business-logic/FavouriteService.js';
import { buildSimilarSearchCriteria, smartSearchCriteriaToParams } from '../../../business-logic/SmartSearchService.js';
import { IconHeart, IconSearch } from '../icons.jsx';
import { SearchRideCard } from './RideCards.jsx';
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

      {error && <div className="search-feedback error" role="alert">{error}<button type="button" onClick={load}>Retry</button></div>}
      {loading && <div className="favourite-loading" role="status">Refreshing saved rides…</div>}

      {!loading && rides.length === 0 && (
        <section className="search-empty-state favourite-empty">
          <IconHeart size={30} /><h2>No favourite rides yet</h2><p>Save a promising ride from Smart Search and it will appear here.</p><button type="button" onClick={() => navigate('/search')}><IconSearch size={15} /> Browse rides</button>
        </section>
      )}

      <section className="favourite-grid" aria-label="Saved rides">
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
