import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { RideService } from '../../../business-logic/RideService.js';
import { VehicleService } from '../../../business-logic/VehicleService.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import ConfirmedLocationInput from '../maps/ConfirmedLocationInput.jsx';
import { IconArrowLeft, IconLock, IconMapPin, IconPlus, IconX } from '../icons.jsx';
import RideVehicleSelector from './RideVehicleSelector.jsx';
import PickupPhotoField from './PickupPhotoField.jsx';
import { RidePickupPhotoService } from '../../../business-logic/RidePickupPhotoService.js';
import '../../styles/ride.css';

const restrictionOptions = ['Pet-friendly', 'No smoking', 'Women-only', 'Child seat available', 'Luggage-friendly', 'Toll contribution', 'Music OK', 'Quiet ride'];

function rideForm(ride) {
  return {
    pickup: ride.pickup,
    pickupLocation: ride.pickupLocation,
    destination: ride.destination,
    destinationLocation: ride.destinationLocation,
    pickupInstructions: ride.pickupInstructions || '',
    date: ride.date,
    time: ride.time,
    journeyScale: ride.journeyScale,
    vehicleId: ride.vehicleId,
    seatsTotal: ride.seatsTotal,
    contribution: ride.contribution || '',
    restrictionTags: ride.restrictionTags || [],
    waypoints: ride.waypoints || []
  };
}

export default function EditRide() {
  const { rideId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [ride, setRide] = useState(null);
  const [form, setForm] = useState(null);
  const [newWaypoint, setNewWaypoint] = useState('');
  const [newWaypointLocation, setNewWaypointLocation] = useState(null);
  const [stopMinutes, setStopMinutes] = useState(10);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [quote, setQuote] = useState(null);
  const [quoteMessage, setQuoteMessage] = useState('');
  const [vehicles, setVehicles] = useState(null);
  const [vehicleError, setVehicleError] = useState('');
  const [pickupPhotoFile, setPickupPhotoFile] = useState(null);
  const [pickupPhotoRemoved, setPickupPhotoRemoved] = useState(false);
  const [pickupPhotoHasExisting, setPickupPhotoHasExisting] = useState(false);
  const [photoRetry, setPhotoRetry] = useState(false);

  useEffect(() => {
    RideService.getRide(rideId).then((found) => {
      setRide(found);
      setForm(found ? rideForm(found) : null);
      setPickupPhotoHasExisting(Boolean(found?.pickupPhotoPath || found?.hasPickupPhoto));
      setPickupPhotoRemoved(false);
    }).catch((err) => setError(err.message));
  }, [rideId]);

  useEffect(() => {
    if (!user?.id) return undefined;
    let active = true;
    setVehicles(null);
    setVehicleError('');
    VehicleService.listVehicles(user.id)
      .then((items) => { if (active) setVehicles(items); })
      .catch((err) => { if (active) setVehicleError(err.message || 'Your vehicles could not be loaded.'); });
    return () => { active = false; };
  }, [user?.id]);

  useEffect(() => {
    if (ride?.status === 'Draft') navigate(`/ride/${rideId}/publish`, { replace: true });
  }, [navigate, ride?.status, rideId]);

  if (!ride || !form) return <div className="ride-page-loading">Loading ride…</div>;
  const locked = !['Draft', 'Published'].includes(ride.status) || (ride.status === 'Published' && ride.hasAcceptedRequests);

  function patch(fields) {
    setForm((current) => ({ ...current, ...fields }));
    setQuote(null);
    setQuoteMessage('');
    setSaved(false);
  }

  function toggleTag(tag) {
    if (locked) return;
    patch({ restrictionTags: form.restrictionTags.includes(tag)
      ? form.restrictionTags.filter((item) => item !== tag)
      : [...form.restrictionTags, tag] });
  }

  function addWaypoint() {
    if (!newWaypoint.trim() || !newWaypointLocation?.placeId) {
      setError('Choose a confirmed Google suggestion before adding the waypoint.');
      return;
    }
    if (form.waypoints.length >= 10) {
      setError('A ride can have at most 10 waypoints.');
      return;
    }
    patch({ waypoints: [...form.waypoints, {
      name: newWaypoint.trim(), description: '',
      placeId: newWaypointLocation.placeId, stopMinutes
    }] });
    setNewWaypoint('');
    setNewWaypointLocation(null);
    setStopMinutes(10);
    setError('');
  }

  async function calculateQuote() {
    setQuoteMessage('Calculating traffic-aware route and checking your Driver schedule…');
    const next = await RideService.quoteRide(form, { rideId });
    setQuote(next);
    setQuoteMessage('Route verified. Your Driver schedule is locked and rechecked when you save.');
    return next;
  }

  async function syncPickupPhoto() {
    if (pickupPhotoFile) {
      await RidePickupPhotoService.replace(rideId, pickupPhotoFile);
      setPickupPhotoFile(null);
      setPickupPhotoHasExisting(true);
      setPickupPhotoRemoved(false);
    } else if (pickupPhotoRemoved && pickupPhotoHasExisting) {
      await RidePickupPhotoService.remove(rideId);
      setPickupPhotoHasExisting(false);
      setPickupPhotoRemoved(false);
    }
  }

  async function retryPickupPhoto() {
    setSaving(true);
    setError('');
    try {
      await syncPickupPhoto();
      navigate(`/ride/${rideId}`, { state: { notice: 'Pickup photo updated.' } });
    } catch (photoError) {
      setError(`Ride changes are saved, but the pickup photo still failed: ${photoError.message}`);
    } finally { setSaving(false); }
  }

  async function save() {
    if (!form.vehicleId) {
      setError('Choose one of your vehicles before saving.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const routeQuote = ride.status === 'Published' ? await calculateQuote() : null;
      const updated = await RideService.updateRide(rideId, { ...form, ...(routeQuote ? { routeQuote } : {}) });
      setRide(updated);
      setForm(rideForm(updated));
      try {
        await syncPickupPhoto();
      } catch (photoError) {
        setPhotoRetry(true);
        setError(`Ride changes were saved, but the pickup photo was not updated: ${photoError.message}`);
        return;
      }
      setSaved(true);
      window.setTimeout(() => navigate(`/ride/${rideId}`), 700);
    } catch (err) {
      setQuote(null);
      setQuoteMessage('');
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="phone-ride-page edit-ride-page">
      <header className="mobile-page-header"><button className="round-icon-button" onClick={() => navigate(`/ride/${rideId}`)} aria-label="Go back"><IconArrowLeft size={18} /></button><h1>Edit ride</h1></header>
      <div className={`edit-ride-content ${locked ? 'locked-form' : ''}`}>
        {locked && <section className="locked-banner"><IconLock size={16} /><span>{ride.hasAcceptedRequests ? 'This ride already has an accepted request and can no longer be edited.' : <>This ride is <strong>{ride.status.toLowerCase()}</strong> and can no longer be edited.</>}</span></section>}
        {error && <div className="alert alert-error edit-ride-error" role="alert"><span>{error}</span>{photoRetry && <><button type="button" className="btn-secondary" disabled={saving} onClick={retryPickupPhoto}>Retry photo</button><button type="button" className="btn-link" disabled={saving} onClick={() => navigate(`/ride/${rideId}`, { state: { notice: 'Ride changes saved without updating the pickup photo.' } })}>Continue without photo</button></>}{/In Transit/i.test(error) && <button type="button" className="btn-link" onClick={() => navigate('/ride')}>Open My rides to complete it</button>}</div>}

        <section className="ride-info-card edit-route-fields">
          <p className="eyebrow">CONFIRMED ROUTE</p>
          <ConfirmedLocationInput id="edit-ride-pickup" label="Pickup point" placeholder="Search in Malaysia" value={form.pickup} location={form.pickupLocation} disabled={locked} onChange={(pickup, pickupLocation) => patch({ pickup, pickupLocation })} />
          <ConfirmedLocationInput id="edit-ride-destination" label="Destination" placeholder="Search in Malaysia" value={form.destination} location={form.destinationLocation} disabled={locked} onChange={(destination, destinationLocation) => patch({ destination, destinationLocation })} />
        </section>

        <section className="ride-info-card">
          <p className="eyebrow">SCHEDULE</p>
          <div className="schedule-grid">
            <div className="field"><label htmlFor="edit-ride-date">Departure date</label><input id="edit-ride-date" type="date" disabled={locked} value={form.date} onChange={(event) => patch({ date: event.target.value })} /></div>
            <div className="field"><label htmlFor="edit-ride-time">Departure time</label><input id="edit-ride-time" type="time" disabled={locked} value={form.time} onChange={(event) => patch({ time: event.target.value })} /></div>
          </div>
          {ride.status === 'Published' && <small>Saving recalculates ETA and rechecks schedule conflicts.</small>}
        </section>

        <section className="ride-info-card edit-vehicle-section">
          <p className="eyebrow">VEHICLE</p>
          {vehicles === null && !vehicleError && <p className="form-helper" role="status">Loading your vehicles…</p>}
          {vehicleError && <p className="location-field-message error" role="alert">{vehicleError}</p>}
          {vehicles?.length > 0 && (
            <RideVehicleSelector
              vehicles={vehicles}
              vehicleId={form.vehicleId}
              disabled={locked}
              onSelect={(vehicle) => patch({
                vehicleId: vehicle.id,
                vehicleCapacity: vehicle.seats,
                seatsTotal: Math.min(form.seatsTotal, vehicle.seats)
              })}
            />
          )}
          {vehicles?.length === 0 && <div className="edit-vehicle-empty"><p>No vehicles are available for this account.</p><button type="button" className="btn-secondary" onClick={() => navigate('/profile')}>Manage vehicles</button></div>}
          {!locked && vehicles?.length > 0 && !form.vehicleId && <p className="location-field-message error">Choose the vehicle passengers should expect.</p>}
        </section>

        <section className="ride-info-card pickup-instructions-field"><label className="eyebrow" htmlFor="edit-pickup-instructions">PICKUP INSTRUCTIONS</label><textarea id="edit-pickup-instructions" disabled={locked} rows="3" maxLength="300" value={form.pickupInstructions} onChange={(event) => patch({ pickupInstructions: event.target.value })} placeholder="e.g. Meet beside Entrance A" /><small>{form.pickupInstructions.length}/300</small><PickupPhotoField rideId={rideId} file={pickupPhotoFile} hasExisting={pickupPhotoHasExisting} removed={pickupPhotoRemoved} disabled={locked} onFileChange={(file) => { setPickupPhotoFile(file); setPickupPhotoRemoved(false); setPhotoRetry(false); }} onRemove={() => { setPickupPhotoFile(null); setPickupPhotoRemoved(pickupPhotoHasExisting); setPhotoRetry(false); }} /></section>
        <section className="ride-info-card"><p className="eyebrow">JOURNEY SCALE</p><div className="scale-picker">{['Urban', 'Intercity'].map((scale) => <button type="button" aria-pressed={form.journeyScale === scale} key={scale} disabled={locked} className={form.journeyScale === scale ? 'selected' : ''} onClick={() => patch({ journeyScale: scale })}>{scale} route</button>)}</div></section>
        <section className="ride-info-card"><label className="eyebrow" htmlFor="contribution">NON-MONETARY CONTRIBUTION</label><input id="contribution" disabled={locked} value={form.contribution} onChange={(event) => patch({ contribution: event.target.value })} placeholder="e.g. Snacks, toll fee, coffee…" /></section>
        <section className="ride-info-card"><p className="eyebrow">TRIP RESTRICTIONS</p><div className="restriction-picker">{restrictionOptions.map((tag) => <button type="button" aria-pressed={form.restrictionTags.includes(tag)} key={tag} disabled={locked} className={form.restrictionTags.includes(tag) ? 'selected' : ''} onClick={() => toggleTag(tag)}>{tag}</button>)}</div></section>

        <section className="ride-info-card">
          <p className="eyebrow">CONFIRMED WAYPOINTS</p>
          {!locked && <div className="waypoint-builder">
            <ConfirmedLocationInput id="edit-ride-waypoint" label="Add a stop" placeholder="Search in Malaysia" value={newWaypoint} location={newWaypointLocation} onChange={(name, location) => { setNewWaypoint(name); setNewWaypointLocation(location); }} />
            <div className="waypoint-stop-row"><label htmlFor="edit-waypoint-stop">Stop duration</label><div><input id="edit-waypoint-stop" type="number" min="0" max="180" step="5" value={stopMinutes} onChange={(event) => setStopMinutes(Math.max(0, Math.min(180, Number(event.target.value) || 0)))} /><span>minutes</span></div></div>
            <button type="button" className="btn-secondary waypoint-confirm-add" onClick={addWaypoint}><IconPlus size={16} /> Add confirmed stop</button>
          </div>}
          {form.waypoints.length ? <div className="waypoint-lines">{form.waypoints.map((waypoint, index) => <div key={`${waypoint.placeId || waypoint.name}-${index}`}><span><IconMapPin size={14} />{waypoint.name}<small>{waypoint.placeId ? 'Confirmed Google stop' : 'Reconfirm before publishing'}</small></span>{waypoint.placeId && <label className="waypoint-selected-duration"><span>Stop duration</span><input type="number" min="0" max="180" step="5" disabled={locked} value={waypoint.stopMinutes} aria-label={`${waypoint.name} stop duration in minutes`} onChange={(event) => { const minutes = Number(event.target.value); if (!Number.isInteger(minutes) || minutes < 0 || minutes > 180) { setError('Stop duration must be a whole number from 0 to 180 minutes.'); return; } patch({ waypoints: form.waypoints.map((item, itemIndex) => itemIndex === index ? { ...item, stopMinutes: minutes } : item) }); setError(''); }} /><small>minutes</small></label>}{!locked && <button type="button" onClick={() => patch({ waypoints: form.waypoints.filter((_, itemIndex) => itemIndex !== index) })} aria-label={`Remove ${waypoint.name}`}><IconX size={15} /></button>}</div>)}</div> : <p className="empty-waypoints">No waypoints added</p>}
        </section>

        {quoteMessage && <section className="route-quote-card" role="status"><p className="card-title">Route verification</p><span>{quoteMessage}</span>{quote && <strong>ETA {new Date(quote.estimatedArrivalAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur' })}</strong>}</section>}
      </div>
      {!locked && <div className="ride-bottom-actions"><button type="button" className="primary-action full" disabled={saving || saved || photoRetry || vehicles === null || Boolean(vehicleError)} onClick={save}>{saved ? '✓ Changes saved' : saving ? (ride.status === 'Published' ? 'Checking route…' : 'Saving…') : 'Save changes'}</button></div>}
    </main>
  );
}
