// ===== PRESENTATION LAYER (PublishRide) =====
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import { RideService } from '../../../business-logic/RideService.js';
import { hasRegisteredVehicle, VehicleService } from '../../../business-logic/VehicleService.js';
import {
  GooglePlacesService,
  isConfirmedLocation,
  MAX_GPS_ACCURACY_METRES
} from '../../../business-logic/GooglePlacesService.js';
import GoogleRouteMap from '../maps/GoogleRouteMap.jsx';
import ConfirmedLocationInput from '../maps/ConfirmedLocationInput.jsx';
import { IconArrowLeft, IconArrowRight, IconMapPin, IconCar, IconCheck, IconPlus, IconX } from '../icons.jsx';
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

  // Optional destination prefill, so offering to drive from Module 6's unserved
  // list (FR-6.35) carries the destination across rather than opening a blank
  // form. Only the free-text field is filled: `destinationLocation` stays null
  // because a confirmed Place ID must still come from a Google prediction the
  // Host actually selects, per D013.
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(() => {
    const destination = searchParams.get('destination');
    return destination ? { ...emptyForm, destination } : emptyForm;
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [vehicles, setVehicles] = useState(null);
  const [vehicleGateError, setVehicleGateError] = useState('');
  const [vehicleGateAttempt, setVehicleGateAttempt] = useState(0);
  const [previewLocation, setPreviewLocation] = useState(null);
  const [previewStatus, setPreviewStatus] = useState({ state: 'idle', message: '' });
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
  }

  function next() {
    setError('');
    if (step === 0 && (!isConfirmedLocation(form.pickupLocation) || !form.destinationLocation?.placeId)) {
      setError('Choose a confirmed Google location for both the pickup point and destination.');
      return;
    }
    if (step === 1 && (!form.date || !form.time)) {
      setError('Pick a departure date and time to continue.');
      return;
    }
    if (step === 2 && !form.vehicleId) {
      setError('Choose one of your vehicles to continue.');
      return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function back() {
    setError('');
    setStep((s) => Math.max(s - 1, 0));
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
    setSaving(true);
    setError('');
    try {
      await RideService.publishRide(user.id, form, 'Published');
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
            <div key={label} className={'step-item' + (i === step ? ' active' : '') + (i < step ? ' done' : '')}>
              <span className="step-num">{i < step ? <IconCheck size={12} /> : i + 1}</span>
              {label}
            </div>
          ))}
        </div>
        <div className="rail-divider" />
        {step === STEPS.length - 1 && <button className="btn-link" onClick={saveAsDraft} disabled={saving}>Save as draft</button>}
      </div>

      <div className="publish-right">
        <p className="step-eyebrow">Step {step + 1} of {STEPS.length}</p>
        <h2 className="step-title">{STEPS[step]}</h2>
        <p className="step-description">{STEP_DESCRIPTIONS[step]}</p>

        {error && <div className="alert alert-error publish-error" role="alert">{error}</div>}

        {step === 0 && <RouteStep form={form} patch={patch} previewLocation={previewLocation} previewStatus={previewStatus} />}
        {step === 1 && <ScheduleStep form={form} patch={patch} />}
        {step === 2 && <VehicleStep form={form} patch={patch} vehicles={vehicles} />}
        {step === 3 && <TripDetailsStep form={form} patch={patch} />}
        {step === 4 && <ReviewStep form={form} onPublish={publish} onDraft={saveAsDraft} saving={saving} />}

        {step < STEPS.length - 1 && (
          <div className="step-actions">
            {step > 0 && <button className="btn-secondary" onClick={back}>Back</button>}
            <button className="btn-primary continue-button" onClick={next}>
              Continue <IconArrowRight size={15} />
            </button>
          </div>
        )}
        <div className="publish-mobile-actions">
          {step < STEPS.length - 1 ? <button className="btn-primary" onClick={next}>Continue <IconArrowRight size={15} /></button> : <div><button className="btn-secondary" onClick={saveAsDraft} disabled={saving}>Save draft</button><button className="btn-primary" onClick={publish} disabled={saving}>Publish ride</button></div>}
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
  return (
    <>
      <div className="schedule-grid">
        <div className="field">
          <label htmlFor="ride-date">Departure date</label>
          <div className="input-wrap"><input id="ride-date" type="date" value={form.date} onChange={(e) => patch({ date: e.target.value })} /></div>
        </div>
        <div className="field">
          <label htmlFor="ride-time">Departure time</label>
          <div className="input-wrap"><input id="ride-time" type="time" value={form.time} onChange={(e) => patch({ time: e.target.value })} /></div>
        </div>
      </div>
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

// ---------- STEP 3: VEHICLE ----------
function VehicleStep({ form, patch, vehicles }) {
  return (
    <div className="vehicle-select-grid">
      {vehicles.map((v) => (
        <button
          type="button"
          key={v.id}
          className={'vehicle-select-card' + (form.vehicleId === v.id ? ' active' : '')}
          aria-pressed={form.vehicleId === v.id}
          onClick={() => patch({ vehicleId: v.id, vehicleCapacity: v.seats, seatsTotal: Math.min(form.seatsTotal, v.seats) })}
        >
          <span className="vehicle-select-icon"><IconCar size={16} /></span>
          <div>
            <div className="vehicle-select-name">{v.make} {v.model}</div>
            <div className="vehicle-select-meta">{v.plate} · {v.seats} seats</div>
          </div>
          {form.vehicleId === v.id && <span className="vehicle-select-check"><IconCheck size={14} /></span>}
        </button>
      ))}
    </div>
  );
}

// ---------- STEP 4: TRIP DETAILS ----------
function TripDetailsStep({ form, patch }) {
  const [waypoint, setWaypoint] = useState('');
  function toggleTag(tag) {
    const has = form.restrictionTags.includes(tag);
    patch({ restrictionTags: has ? form.restrictionTags.filter((t) => t !== tag) : [...form.restrictionTags, tag] });
  }

  function addWaypoint() {
    const name = waypoint.trim();
    if (!name) return;
    patch({ waypoints: [...form.waypoints, { name, description: '' }] });
    setWaypoint('');
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
        <div className="waypoint-add">
          <input value={waypoint} onChange={(event) => setWaypoint(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addWaypoint(); } }} placeholder="Add an optional waypoint" />
          <button type="button" onClick={addWaypoint} aria-label="Add waypoint"><IconPlus size={16} /></button>
        </div>
        {form.waypoints.length > 0 && <div className="waypoint-lines">{form.waypoints.map((item, index) => <div key={`${item.name}-${index}`}><span><IconMapPin size={14} />{item.name}</span><button type="button" onClick={() => patch({ waypoints: form.waypoints.filter((_, itemIndex) => itemIndex !== index) })} aria-label={`Remove ${item.name}`}><IconX size={15} /></button></div>)}</div>}
      </div>
    </>
  );
}

// ---------- STEP 5: REVIEW & PUBLISH ----------
function ReviewStep({ form, onPublish, onDraft, saving }) {
  return (
    <>
      <div className="card">
        <p className="card-title">Trip summary</p>
        <div className="review-row"><span>Route</span><strong>{form.pickup || '—'} → {form.destination || '—'}</strong></div>
        <div className="review-row"><span>Pickup instructions</span><strong>{form.pickupInstructions || 'None'}</strong></div>
        <div className="review-row"><span>Journey scale</span><strong>{form.journeyScale}</strong></div>
        <div className="review-row"><span>Departure</span><strong>{form.date || '—'} {form.time}</strong></div>
        <div className="review-row"><span>Seats available</span><strong>{form.seatsTotal}</strong></div>
        <div className="review-row"><span>Contribution</span><strong>{form.contribution || 'No contribution needed'}</strong></div>
        <div className="review-row"><span>Restriction tags</span><strong>{form.restrictionTags.length ? form.restrictionTags.join(', ') : 'None'}</strong></div>
        <div className="review-row"><span>Waypoints</span><strong>{form.waypoints.length ? form.waypoints.map((item) => item.name).join(', ') : 'None'}</strong></div>
      </div>
      <div className="step-actions review-actions">
        <button className="btn-secondary" onClick={onDraft} disabled={saving}>Save as Draft</button>
        <button className="btn-primary publish-confirm-button" onClick={onPublish} disabled={saving}>
          {saving ? 'Publishing…' : 'Publish Ride'}
        </button>
      </div>
    </>
  );
}
