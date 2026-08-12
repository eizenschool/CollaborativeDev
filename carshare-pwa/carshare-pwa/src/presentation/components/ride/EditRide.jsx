import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { RideService } from '../../../business-logic/RideService.js';
import { IconArrowLeft, IconLock, IconMapPin, IconPlus, IconX } from '../icons.jsx';
import '../../styles/ride.css';

const restrictionOptions = ['Pet-friendly', 'No smoking', 'Women-only', 'Child seat available', 'Luggage-friendly', 'Toll contribution', 'Music OK', 'Quiet ride'];

export default function EditRide() {
  const { rideId } = useParams();
  const navigate = useNavigate();
  const [ride, setRide] = useState(null);
  const [contribution, setContribution] = useState('');
  const [journeyScale, setJourneyScale] = useState('Urban');
  const [tags, setTags] = useState([]);
  const [waypoints, setWaypoints] = useState([]);
  const [newWaypoint, setNewWaypoint] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    RideService.getRide(rideId).then((found) => {
      setRide(found);
      setContribution(found?.contribution || '');
      setJourneyScale(found?.journeyScale || 'Urban');
      setTags(found?.restrictionTags || []);
      setWaypoints(found?.waypoints?.map((item) => item.name || item) || []);
    });
  }, [rideId]);

  if (!ride) return <div className="ride-page-loading">Loading ride…</div>;
  const locked = !['Draft', 'Published'].includes(ride.status) || (ride.status === 'Published' && ride.hasAcceptedRequests);
  const toggleTag = (tag) => !locked && setTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]);
  const addWaypoint = () => {
    const value = newWaypoint.trim();
    if (value && !locked) { setWaypoints((current) => [...current, value]); setNewWaypoint(''); }
  };
  async function save() {
    setError('');
    try {
      await RideService.updateRide(rideId, { contribution, journeyScale, restrictionTags: tags, waypoints: waypoints.map((name) => ({ name, description: '' })) });
      setSaved(true);
      window.setTimeout(() => navigate(`/ride/${rideId}`), 600);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="phone-ride-page edit-ride-page">
      <header className="mobile-page-header"><button className="round-icon-button" onClick={() => navigate(`/ride/${rideId}`)} aria-label="Go back"><IconArrowLeft size={18} /></button><h1>Edit ride</h1></header>
      <div className={`edit-ride-content ${locked ? 'locked-form' : ''}`}>
        {locked && <section className="locked-banner"><IconLock size={16} /><span>{ride.hasAcceptedRequests ? 'This ride already has an accepted request and can no longer be edited.' : <>This ride is <strong>{ride.status.toLowerCase()}</strong> and can no longer be edited.</>}</span></section>}
        {error && <div className="alert alert-error">{error}</div>}
        <section className="ride-info-card"><p className="eyebrow">JOURNEY SCALE</p><div className="scale-picker">{['Urban', 'Intercity'].map((scale) => <button key={scale} disabled={locked} className={journeyScale === scale ? 'selected' : ''} onClick={() => setJourneyScale(scale)}>{scale} route</button>)}</div></section>
        <section className="ride-info-card"><label className="eyebrow" htmlFor="contribution">NON-MONETARY CONTRIBUTION</label><input id="contribution" disabled={locked} value={contribution} onChange={(event) => setContribution(event.target.value)} placeholder="e.g. Snacks, toll fee, coffee…" /></section>
        <section className="ride-info-card"><p className="eyebrow">TRIP RESTRICTIONS</p><div className="restriction-picker">{restrictionOptions.map((tag) => <button key={tag} disabled={locked} className={tags.includes(tag) ? 'selected' : ''} onClick={() => toggleTag(tag)}>{tag}</button>)}</div></section>
        <section className="ride-info-card"><p className="eyebrow">CULINARY & CULTURAL WAYPOINTS</p>{!locked && <div className="waypoint-add"><input value={newWaypoint} onChange={(event) => setNewWaypoint(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && addWaypoint()} placeholder="Add a waypoint…" /><button onClick={addWaypoint} aria-label="Add waypoint"><IconPlus size={16} /></button></div>}{waypoints.length ? <div className="waypoint-lines">{waypoints.map((name, index) => <div key={`${name}-${index}`}><span><IconMapPin size={14} />{name}</span>{!locked && <button onClick={() => setWaypoints((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${name}`}><IconX size={15} /></button>}</div>)}</div> : <p className="empty-waypoints">No waypoints added</p>}</section>
      </div>
      {!locked && <div className="ride-bottom-actions"><button className="primary-action full" onClick={save}>{saved ? '✓ Changes saved' : 'Save changes'}</button></div>}
    </main>
  );
}
