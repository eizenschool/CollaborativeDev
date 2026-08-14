// ===== PRESENTATION LAYER (PublishRide) =====
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import { isRouteQuoteFresh, RideService } from '../../../business-logic/RideService.js';
import { departureParts, formatMalaysiaDeparture } from '../../../business-logic/rideDateTime.js';
import { hasRegisteredVehicle, VehicleService } from '../../../business-logic/VehicleService.js';
import {
  GooglePlacesService,
  MAX_GPS_ACCURACY_METRES
} from '../../../business-logic/GooglePlacesService.js';
import GoogleRouteMap from '../maps/GoogleRouteMap.jsx';
import ConfirmedLocationInput from '../maps/ConfirmedLocationInput.jsx';
import { IconArrowLeft, IconArrowRight, IconMapPin, IconCar, IconCheck, IconPlus, IconX } from '../icons.jsx';
import RideVehicleSelector from './RideVehicleSelector.jsx';
import { canNavigateToPublishStep, getPublishStepError } from './publishRideSteps.js';
import '../../styles/ride.css';

const STEPS = ['Route', 'Schedule', 'Vehicle', 'Trip Details', 'Review & Publish'];
const STEP_DESCRIPTIONS = [
  'Set the fixed pickup and destination for this journey.',
  'Choose when you leave and how many seats you can share.',
  'Select the vehicle passengers should expect.',
  'Add contribution details, preferences, and optional stops.',
  'Check every detail before your ride becomes visible.'
];
const RESTRICTION_OPTIONS = ['Pet-friendly', 'No smoking', 'Women-only', 'Child seat available', 'Luggage-friendly', 'Toll contribution', 'Music OK', 'Quiet ride'];

const emptyForm = {
  pickup: '', pickupLocation: null,
  destination: '', destinationLocation: null,
  pickupInstructions: '', journeyScale: 'Urban',
  date: '', time: '', seatsTotal: 3,
  vehicleId: null, vehicleCapacity: null,
  contribution: '', restrictionTags: [],
  waypoints: []
};

export default function PublishRide() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [furthestStep, setFurthestStep] = useState(0);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [vehicles, setVehicles] = useState(null);
  const [vehicleGateError, setVehicleGateError] = useState('');
  const [vehicleGateAttempt, setVehicleGateAttempt] = useState(0);
  const [previewLocation, setPreviewLocation] = useState(null);
  const [previewStatus, setPreviewStatus] = useState({ state: 'idle', message: '' });
  const [routeQuote, setRouteQuote] = useState(null);
  const [quoteStatus, setQuoteStatus] = useState({ state: 'idle', message: '' });
  const locationRequested = useRef(false);

  useEffect(() => {
    let active = true;
    setVehicles(null);
    setVehicleGateError('');
    VehicleService.listVehicles(user.id)
      .then((items) => {
        if (active) setVehicles(items);
      })
      .catch((err) => {
        if (active) setVehicleGateError(err.message || 'Your vehicles could not be checked.');
      });
    return () => { active = false; };
  }, [user.id, vehicleGateAttempt]);

  useEffect(() => {
    if (!hasRegisteredVehicle(vehicles) || locationRequested.current) return;
    locationRequested.current = true;
    let active = true;
    setPreviewStatus({ state: 'locating', message: 'Finding your current location to place a pin on the map…' });
    GooglePlacesService.getCurrentLocationPreview()
      .then((location) => {
        if (!active) return;
        setPreviewLocation(location);
        setPreviewStatus({
          state: 'ready',
          message: `Current-location pin shown (±${Math.round(location.accuracy)} m). This is not your pickup until you confirm it.`
        });
      })
      .catch((err) => {
        if (!active) return;
        setPreviewStatus({ state: 'error', message: err.message });
      });
    return () => { active = false; };
  }, [vehicles]);

  function patch(fields) {
    setForm((f) => ({ ...f, ...fields }));
    setRouteQuote(null);
    setQuoteStatus({ state: 'idle', message: '' });
  }

  async function calculateRouteQuote() {
    setQuoteStatus({ state: 'loading', message: 'Calculating traffic-aware route and ETA…' });
    try {
      const quote = await RideService.quoteRide(form);
      setRouteQuote(quote);
      setQuoteStatus({ state: 'ready', message: 'Route verified. Your Driver schedule is locked and rechecked when you publish.' });
      return quote;
    } catch (err) {
      setRouteQuote(null);
      setQuoteStatus({ state: 'error', message: err.message });
      throw err;
    }
  }

  useEffect(() => {
    if (step !== STEPS.length - 1 || routeQuote || quoteStatus.state === 'loading') return;
    calculateRouteQuote().catch(() => {});
  // The form is intentionally excluded: patch() invalidates the quote before
  // the review step can request a new one.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  function next() {
    setError('');
    const validationError = getPublishStepError(form, step);
    if (validationError) {
      setError(validationError);
      return;
    }
    const nextStep = Math.min(step + 1, STEPS.length - 1);
    setFurthestStep((current) => Math.max(current, nextStep));
    setStep(nextStep);
  }

  function back() {
    setError('');
    setStep((s) => Math.max(s - 1, 0));
  }

  function goToStep(targetStep) {
    if (!canNavigateToPublishStep({ targetStep, currentStep: step, furthestStep, form })) return;
    setError('');
    setStep(targetStep);
  }

  async function saveAsDraft() {
    setSaving(true);
    setError('');
    try {
      await RideService.publishRide(user.id, form, 'Draft');
      navigate('/ride');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    const scheduleError = getPublishStepError(form, 1);
    if (scheduleError) {
      setError(scheduleError);
      setStep(1);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const quote = isRouteQuoteFresh(routeQuote) ? routeQuote : await calculateRouteQuote();
      await RideService.publishRide(user.id, { ...form, routeQuote: quote }, 'Published');
      navigate('/ride');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!vehicles && !vehicleGateError) {
    return <main className="publish-access-state" role="status">Checking that you have a vehicle…</main>;
  }

  if (vehicleGateError) {
    return (
      <main className="publish-access-state">
        <section className="publish-access-card" role="alert">
          <span className="publish-access-icon"><IconCar size={24} /></span>
          <h1>We couldn't check your vehicles</h1>
          <p>{vehicleGateError} Location permission has not been requested.</p>
          <div>
            <button className="btn-secondary" onClick={() => navigate('/ride')}>Back to rides</button>
            <button className="btn-primary" onClick={() => setVehicleGateAttempt((attempt) => attempt + 1)}>Try again</button>
          </div>
        </section>
      </main>
    );
  }

  if (!hasRegisteredVehicle(vehicles)) {
    return (
      <main className="publish-access-state">
        <section className="publish-access-card" role="alert">
          <span className="publish-access-icon"><IconCar size={24} /></span>
          <h1>Add a vehicle before publishing</h1>
          <p>You need at least one registered vehicle to publish a ride. We did not request your location.</p>
          <div>
            <button className="btn-secondary" onClick={() => navigate('/ride')}>Back to rides</button>
            <button className="btn-primary" onClick={() => navigate('/profile')}>Add a vehicle</button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="publish-ride">
      <header className="publish-mobile-header">
        <button className="round-icon-button" onClick={step === 0 ? () => navigate('/ride') : back} aria-label="Go back"><IconArrowLeft size={18} /></button>
        <div><p>Step {step + 1} of {STEPS.length}</p><h1>{STEPS[step]}</h1></div>
        {step === STEPS.length - 1 && <button className="save-draft-mobile" onClick={saveAsDraft} disabled={saving}>Save draft</button>}
        <div className="publish-progress-dots" role="progressbar" aria-label="Publish ride progress" aria-valuemin="1" aria-valuemax={STEPS.length} aria-valuenow={step + 1}>{STEPS.map((label, index) => <i key={label} className={index <= step ? 'active' : ''} />)}</div>
      </header>
      <div className="publish-left">
        <button className="back-link" onClick={() => navigate('/ride')}><IconArrowLeft size={15} /> Back</button>
        <div className="step-list" aria-label="Publish ride steps">
          {STEPS.map((label, i) => (
            <button
              type="button"
              key={label}
              className={'step-item' + (i === step ? ' active' : '') + (i < furthestStep ? ' done' : '')}
              aria-current={i === step ? 'step' : undefined}
              disabled={!canNavigateToPublishStep({ targetStep: i, currentStep: step, furthestStep, form })}
              onClick={() => goToStep(i)}
            >
              <span className="step-num">{i < furthestStep ? <IconCheck size={12} /> : i + 1}</span>
              {label}
            </button>
          ))}
        </div>
        <div className="rail-divider" />
        {step === STEPS.length - 1 && <button className="btn-link" onClick={saveAsDraft} disabled={saving}>Save as draft</button>}
      </div>

      <div className="publish-right">
        <p className="step-eyebrow">Step {step + 1} of {STEPS.length}</p>
        <h2 className="step-title">{STEPS[step]}</h2>
        <p className="step-description">{STEP_DESCRIPTIONS[step]}</p>

        {error && <div className="alert alert-error publish-error" role="alert"><span>{error}</span>{/In Transit/i.test(error) && <button type="button" className="btn-link" onClick={() => navigate('/ride')}>Open My rides to complete it</button>}</div>}

        {step === 0 && <RouteStep form={form} patch={patch} previewLocation={previewLocation} previewStatus={previewStatus} />}
        {step === 1 && <ScheduleStep form={form} patch={patch} />}
        {step === 2 && <RideVehicleSelector vehicles={vehicles} vehicleId={form.vehicleId} onSelect={(vehicle) => patch({ vehicleId: vehicle.id, vehicleCapacity: vehicle.seats, seatsTotal: Math.min(form.seatsTotal, vehicle.seats) })} />}
        {step === 3 && <TripDetailsStep form={form} patch={patch} />}
        {step === 4 && <ReviewStep form={form} routeQuote={routeQuote} quoteStatus={quoteStatus} onRefreshQuote={() => calculateRouteQuote().catch(() => {})} onBack={back} onPublish={publish} onDraft={saveAsDraft} saving={saving} />}

        {step < STEPS.length - 1 && (
          <div className="step-actions">
            {step > 0 && <button className="btn-secondary" onClick={back}>Back</button>}
            <button className="btn-primary continue-button" onClick={next}>
              Continue <IconArrowRight size={15} />
            </button>
          </div>
        )}
        <div className="publish-mobile-actions">
          {step < STEPS.length - 1 ? <button className="btn-primary" onClick={next}>Continue <IconArrowRight size={15} /></button> : <div><button className="btn-secondary" onClick={back} disabled={saving}>Back</button><button className="btn-primary" onClick={publish} disabled={saving || quoteStatus.state === 'loading'}>Publish ride</button></div>}
        </div>
      </div>
    </main>
  );
}

// ---------- STEP 1: ROUTE ----------
function RouteStep({ form, patch, previewLocation, previewStatus }) {
  return (
    <>
      <div className="route-inputs">
        <ConfirmedLocationInput
          id="ride-pickup"
          label="Pickup point"
          placeholder="Search in Malaysia, e.g. KL Sentral"
          value={form.pickup}
          location={form.pickupLocation}
          onChange={(pickup, pickupLocation) => patch({ pickup, pickupLocation })}
          allowCurrentLocation
          currentLocationPreview={previewLocation?.accuracy <= MAX_GPS_ACCURACY_METRES ? previewLocation : null}
        />
        <ConfirmedLocationInput
          id="ride-destination"
          label="Destination"
          placeholder="Search in Malaysia, e.g. Georgetown"
          value={form.destination}
          location={form.destinationLocation}
          onChange={(destination, destinationLocation) => patch({ destination, destinationLocation })}
        />
      </div>

      <GoogleRouteMap pickup={form.pickupLocation ? form.pickup : ''} pickupLocation={form.pickupLocation} destination={form.destinationLocation ? form.destination : ''} destinationLocation={form.destinationLocation} previewLocation={previewLocation} waypoints={form.waypoints} className="map-placeholder">
        {previewLocation && !form.pickupLocation && <span className="map-pin map-pin-current"><span className="pin-dot" /> Current location</span>}
        <span className="map-pin map-pin-start"><span className="pin-dot" /> {form.pickup || 'Pickup point'}</span>
        <span className="map-pin map-pin-end"><span className="pin-dot pin-dot-end" /> {form.destination || 'Destination'}</span>
        <span className="map-attribution">Google Maps preview appears when the Embed key is configured</span>
      </GoogleRouteMap>
      {!form.pickupLocation && previewStatus.message && (
        <p className={`map-location-status ${previewStatus.state === 'error' ? 'error' : ''}`} role="status">
          {previewStatus.message}
        </p>
      )}

      <p className="field-label-standalone">Journey scale</p>
      <div className="scale-toggle">
        <button
          type="button"
          className={'scale-option' + (form.journeyScale === 'Urban' ? ' active' : '')}
          aria-pressed={form.journeyScale === 'Urban'}
          onClick={() => patch({ journeyScale: 'Urban' })}
        >
          Urban Route
        </button>
        <button
          type="button"
          className={'scale-option' + (form.journeyScale === 'Intercity' ? ' active' : '')}
          aria-pressed={form.journeyScale === 'Intercity'}
          onClick={() => patch({ journeyScale: 'Intercity' })}
        >
          Intercity Route
        </button>
      </div>
    </>
  );
}

// ---------- STEP 2: SCHEDULE ----------
function ScheduleStep({ form, patch }) {
  const today = departureParts(new Date().toISOString()).date;
  const selectedDeparture = form.date && form.time ? formatMalaysiaDeparture(form.date, form.time) : '';
  return (
    <>
      <div className="schedule-grid">
        <div className="field">
          <label htmlFor="ride-date">Departure date</label>
          <div className="input-wrap"><input id="ride-date" type="date" min={today} value={form.date} onChange={(e) => patch({ date: e.target.value })} /></div>
        </div>
        <div className="field">
          <label htmlFor="ride-time">Departure time</label>
          <div className="input-wrap"><input id="ride-time" type="time" value={form.time} onChange={(e) => patch({ time: e.target.value })} /></div>
        </div>
      </div>
      <p className="schedule-time-hint" aria-live="polite">
        {selectedDeparture || 'Times use Malaysia time.'} Enter afternoon times as 13:00–23:59 when your device uses a 24-hour clock.
      </p>
      <div className="field">
        <label>Available seats</label>
        <div className="seat-stepper" aria-label="Available seats">
          <button type="button" aria-label="Decrease available seats" onClick={() => patch({ seatsTotal: Math.max(1, form.seatsTotal - 1) })}>−</button>
          <output aria-live="polite">{form.seatsTotal}</output>
          <button type="button" aria-label="Increase available seats" onClick={() => patch({ seatsTotal: Math.min(8, form.seatsTotal + 1) })}>+</button>
        </div>
      </div>
    </>
  );
}

// ---------- STEP 4: TRIP DETAILS ----------
function TripDetailsStep({ form, patch }) {
  const [waypoint, setWaypoint] = useState('');
  const [waypointLocation, setWaypointLocation] = useState(null);
  const [stopMinutes, setStopMinutes] = useState(10);
  const [waypointError, setWaypointError] = useState('');
  function toggleTag(tag) {
    const has = form.restrictionTags.includes(tag);
    patch({ restrictionTags: has ? form.restrictionTags.filter((t) => t !== tag) : [...form.restrictionTags, tag] });
  }

  function addWaypoint() {
    const name = waypoint.trim();
    if (!name || !waypointLocation?.placeId) {
      setWaypointError('Choose a confirmed Google suggestion before adding this waypoint.');
      return;
    }
    if (form.waypoints.length >= 10) {
      setWaypointError('A ride can have at most 10 waypoints.');
      return;
    }
    patch({ waypoints: [...form.waypoints, { name, description: '', placeId: waypointLocation.placeId, stopMinutes }] });
    setWaypoint('');
    setWaypointLocation(null);
    setStopMinutes(10);
    setWaypointError('');
  }

  return (
    <>
      <div className="field">
        <label>Non-monetary contribution requirement</label>
        <div className="input-wrap">
          <input
            placeholder="e.g. Snacks & drinks, help with directions"
            value={form.contribution}
            onChange={(e) => patch({ contribution: e.target.value })}
          />
        </div>
      </div>

      <div className="field pickup-instructions-field">
        <label htmlFor="pickup-instructions">Pickup instructions <span>(optional)</span></label>
        <textarea
          id="pickup-instructions"
          rows="3"
          maxLength="300"
          placeholder="e.g. Meet beside Entrance A, next to the taxi stand"
          value={form.pickupInstructions}
          onChange={(event) => patch({ pickupInstructions: event.target.value })}
        />
        <small>{form.pickupInstructions.length}/300</small>
      </div>

      <p className="field-label-standalone">Trip restriction tags</p>
      <div className="chip-select-row">
        {RESTRICTION_OPTIONS.map((tag) => (
          <button
            type="button"
            key={tag}
            className={'chip-select' + (form.restrictionTags.includes(tag) ? ' active' : '')}
            aria-pressed={form.restrictionTags.includes(tag)}
            onClick={() => toggleTag(tag)}
          >
            {tag}
          </button>
        ))}
      </div>

      <div className="field" style={{ marginTop: 18 }}>
        <label>Culinary &amp; cultural waypoints</label>
        <div className="waypoint-builder">
          <ConfirmedLocationInput
            id="ride-waypoint"
            label="Confirmed stop"
            placeholder="Search for a stop in Malaysia"
            value={waypoint}
            location={waypointLocation}
            onChange={(name, location) => { setWaypoint(name); setWaypointLocation(location); setWaypointError(''); }}
          />
          <div className="waypoint-stop-row">
            <label htmlFor="waypoint-stop-minutes">Stop duration</label>
            <div><input id="waypoint-stop-minutes" type="number" min="0" max="180" step="5" value={stopMinutes} onChange={(event) => setStopMinutes(Math.max(0, Math.min(180, Number(event.target.value) || 0)))} /><span>minutes</span></div>
          </div>
          <button type="button" className="btn-secondary waypoint-confirm-add" onClick={addWaypoint}><IconPlus size={16} /> Add confirmed stop</button>
        </div>
        {waypointError && <p className="location-field-message error" role="alert">{waypointError}</p>}
        {form.waypoints.length > 0 && <div className="waypoint-lines">{form.waypoints.map((item, index) => <div key={`${item.placeId || item.name}-${index}`}><span><IconMapPin size={14} />{item.name}<small>{item.stopMinutes} min stop</small></span><button type="button" onClick={() => patch({ waypoints: form.waypoints.filter((_, itemIndex) => itemIndex !== index) })} aria-label={`Remove ${item.name}`}><IconX size={15} /></button></div>)}</div>}
      </div>
    </>
  );
}

// ---------- STEP 5: REVIEW & PUBLISH ----------
function ReviewStep({ form, routeQuote, quoteStatus, onRefreshQuote, onBack, onPublish, onDraft, saving }) {
  const fresh = isRouteQuoteFresh(routeQuote);
  return (
    <>
      <div className="card">
        <p className="card-title">Trip summary</p>
        <div className="review-row"><span>Route</span><strong>{form.pickup || '—'} → {form.destination || '—'}</strong></div>
        <div className="review-row"><span>Pickup instructions</span><strong>{form.pickupInstructions || 'None'}</strong></div>
        <div className="review-row"><span>Journey scale</span><strong>{form.journeyScale}</strong></div>
        <div className="review-row"><span>Departure</span><strong>{formatMalaysiaDeparture(form.date, form.time)}</strong></div>
        <div className="review-row"><span>Seats available</span><strong>{form.seatsTotal}</strong></div>
        <div className="review-row"><span>Contribution</span><strong>{form.contribution || 'No contribution needed'}</strong></div>
        <div className="review-row"><span>Restriction tags</span><strong>{form.restrictionTags.length ? form.restrictionTags.join(', ') : 'None'}</strong></div>
        <div className="review-row"><span>Waypoints</span><strong>{form.waypoints.length ? form.waypoints.map((item) => `${item.name} (${item.stopMinutes} min)`).join(', ') : 'None'}</strong></div>
      </div>
      <section className={`route-quote-card ${quoteStatus.state === 'error' ? 'error' : ''}`} aria-live="polite">
        <div><p className="card-title">Traffic-aware route</p><span>{quoteStatus.message || 'A server route quote is required before publishing.'}</span></div>
        {routeQuote && <div className="route-quote-grid">
          <span><small>Distance</small><strong>{formatDistance(routeQuote.distanceMeters)}</strong></span>
          <span><small>Travel + stops</small><strong>{formatDuration(routeQuote.totalDurationSeconds)}</strong></span>
          <span><small>Estimated arrival</small><strong>{formatArrival(routeQuote.estimatedArrivalAt)}</strong></span>
        </div>}
        {routeQuote?.attribution && <small className="google-route-attribution">{routeQuote.attribution}</small>}
        {!fresh && quoteStatus.state !== 'loading' && <button type="button" className="btn-secondary" onClick={onRefreshQuote}>Calculate route again</button>}
      </section>
      <div className="step-actions review-actions">
        <button className="btn-secondary" onClick={onBack} disabled={saving}>Back</button>
        <button className="btn-secondary" onClick={onDraft} disabled={saving}>Save as Draft</button>
        <button className="btn-primary publish-confirm-button" onClick={onPublish} disabled={saving || quoteStatus.state === 'loading'}>
          {saving ? 'Publishing…' : 'Publish Ride'}
        </button>
      </div>
    </>
  );
}

function formatDistance(metres) {
  if (!Number.isFinite(Number(metres))) return '—';
  return Number(metres) >= 1000 ? `${(Number(metres) / 1000).toFixed(1)} km` : `${Number(metres)} m`;
}

function formatDuration(seconds) {
  const minutes = Math.max(0, Math.round(Number(seconds || 0) / 60));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? `${hours} hr ${remainder} min` : `${remainder} min`;
}

function formatArrival(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur' });
}
