// ===== PRESENTATION LAYER (PublishRide) =====
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import { RideService } from '../../../business-logic/RideService.js';
import { VehicleService } from '../../../business-logic/VehicleService.js';
import GoogleRouteMap from '../maps/GoogleRouteMap.jsx';
import { IconArrowLeft, IconArrowRight, IconMapPin, IconCar, IconCheck, IconPlus, IconX } from '../icons.jsx';
import '../../styles/ride.css';

const STEPS = ['Route', 'Schedule', 'Vehicle', 'Trip Details', 'Review & Publish'];
const RESTRICTION_OPTIONS = ['Pet-friendly', 'No smoking', 'Women-only', 'Child seat available', 'Luggage-friendly', 'Toll contribution', 'Music OK', 'Quiet ride'];

const emptyForm = {
  pickup: '', destination: '', journeyScale: 'Urban',
  date: '', time: '', seatsTotal: 3,
  vehicleId: null, vehicleCapacity: null,
  contribution: '', restrictionTags: [],
  waypoints: []
};

export default function PublishRide() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function patch(fields) {
    setForm((f) => ({ ...f, ...fields }));
  }

  function next() {
    setError('');
    if (step === 0 && (!form.pickup.trim() || !form.destination.trim())) {
      setError('Enter both a pickup point and a destination to continue.');
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

  return (
    <div className="publish-ride">
      <header className="publish-mobile-header">
        <button className="round-icon-button" onClick={step === 0 ? () => navigate('/ride') : back} aria-label="Go back"><IconArrowLeft size={18} /></button>
        <div><p>Step {step + 1} of {STEPS.length}</p><h1>{STEPS[step]}</h1></div>
        {step === STEPS.length - 1 && <button className="save-draft-mobile" onClick={saveAsDraft} disabled={saving}>Save draft</button>}
        <div className="publish-progress-dots">{STEPS.map((label, index) => <i key={label} className={index <= step ? 'active' : ''} />)}</div>
      </header>
      <div className="publish-left">
        <button className="back-link" onClick={() => navigate('/ride')}><IconArrowLeft size={15} /> Back</button>
        <div className="step-list">
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

        {error && <div className="alert alert-error" style={{ marginTop: 14 }}>{error}</div>}

        {step === 0 && <RouteStep form={form} patch={patch} />}
        {step === 1 && <ScheduleStep form={form} patch={patch} />}
        {step === 2 && <VehicleStep form={form} patch={patch} userId={user.id} />}
        {step === 3 && <TripDetailsStep form={form} patch={patch} />}
        {step === 4 && <ReviewStep form={form} onPublish={publish} onDraft={saveAsDraft} saving={saving} />}

        {step < STEPS.length - 1 && (
          <div className="step-actions">
            {step > 0 && <button className="btn-secondary" onClick={back}>Back</button>}
            <button className="btn-primary" style={{ width: 'auto', padding: '11px 24px', marginLeft: 'auto' }} onClick={next}>
              Continue <IconArrowRight size={15} />
            </button>
          </div>
        )}
        <div className="publish-mobile-actions">
          {step < STEPS.length - 1 ? <button className="btn-primary" onClick={next}>Continue <IconArrowRight size={15} /></button> : <div><button className="btn-secondary" onClick={saveAsDraft} disabled={saving}>Save draft</button><button className="btn-primary" onClick={publish} disabled={saving}>Publish ride</button></div>}
        </div>
      </div>
    </div>
  );
}

// ---------- STEP 1: ROUTE ----------
function RouteStep({ form, patch }) {
  return (
    <>
      <div className="route-inputs">
        <div className="input-wrap">
          <span className="prefix-icon" style={{ color: 'var(--teal)' }}><IconMapPin size={14} /></span>
          <input placeholder="Pickup point" value={form.pickup} onChange={(e) => patch({ pickup: e.target.value })} />
        </div>
        <div className="input-wrap">
          <span className="prefix-icon" style={{ color: 'var(--danger)' }}><IconMapPin size={14} /></span>
          <input placeholder="Destination" value={form.destination} onChange={(e) => patch({ destination: e.target.value })} />
        </div>
      </div>

      <GoogleRouteMap pickup={form.pickup} destination={form.destination} waypoints={form.waypoints} className="map-placeholder">
        <span className="map-pin map-pin-start"><span className="pin-dot" /> {form.pickup || 'Pickup point'}</span>
        <span className="map-pin map-pin-end"><span className="pin-dot pin-dot-end" /> {form.destination || 'Destination'}</span>
        <span className="map-attribution">Google Maps preview appears when the Embed key is configured</span>
      </GoogleRouteMap>

      <p className="field-label-standalone">Journey Scale</p>
      <div className="scale-toggle">
        <button
          type="button"
          className={'scale-option' + (form.journeyScale === 'Urban' ? ' active' : '')}
          onClick={() => patch({ journeyScale: 'Urban' })}
        >
          Urban Route
        </button>
        <button
          type="button"
          className={'scale-option' + (form.journeyScale === 'Intercity' ? ' active' : '')}
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
      <div className="field">
        <label>Departure date</label>
        <div className="input-wrap"><input type="date" value={form.date} onChange={(e) => patch({ date: e.target.value })} /></div>
      </div>
      <div className="field">
        <label>Departure time</label>
        <div className="input-wrap"><input type="time" value={form.time} onChange={(e) => patch({ time: e.target.value })} /></div>
      </div>
      <div className="field">
        <label>Available seats</label>
        <div className="seat-stepper">
          <button type="button" onClick={() => patch({ seatsTotal: Math.max(1, form.seatsTotal - 1) })}>−</button>
          <span>{form.seatsTotal}</span>
          <button type="button" onClick={() => patch({ seatsTotal: Math.min(8, form.seatsTotal + 1) })}>+</button>
        </div>
      </div>
    </>
  );
}

// ---------- STEP 3: VEHICLE ----------
function VehicleStep({ form, patch, userId }) {
  const [vehicles, setVehicles] = useState(null);

  useEffect(() => {
    VehicleService.listVehicles(userId).then(setVehicles);
  }, [userId]);

  if (!vehicles) return <p style={{ color: 'var(--muted)' }}>Loading your vehicles…</p>;

  if (vehicles.length === 0) {
    return (
      <div className="alert alert-info">
        You haven't added a vehicle yet. Add one from My Profile → My Vehicles, then come back to select it here.
      </div>
    );
  }

  return (
    <div className="vehicle-select-grid">
      {vehicles.map((v) => (
        <button
          type="button"
          key={v.id}
          className={'vehicle-select-card' + (form.vehicleId === v.id ? ' active' : '')}
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

      <p className="field-label-standalone">Trip restriction tags</p>
      <div className="chip-select-row">
        {RESTRICTION_OPTIONS.map((tag) => (
          <button
            type="button"
            key={tag}
            className={'chip-select' + (form.restrictionTags.includes(tag) ? ' active' : '')}
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
        <div className="review-row"><span>Journey scale</span><strong>{form.journeyScale}</strong></div>
        <div className="review-row"><span>Departure</span><strong>{form.date || '—'} {form.time}</strong></div>
        <div className="review-row"><span>Seats available</span><strong>{form.seatsTotal}</strong></div>
        <div className="review-row"><span>Contribution</span><strong>{form.contribution || 'No contribution needed'}</strong></div>
        <div className="review-row"><span>Restriction tags</span><strong>{form.restrictionTags.length ? form.restrictionTags.join(', ') : 'None'}</strong></div>
        <div className="review-row"><span>Waypoints</span><strong>{form.waypoints.length ? form.waypoints.map((item) => item.name).join(', ') : 'None'}</strong></div>
      </div>
      <div className="step-actions">
        <button className="btn-secondary" onClick={onDraft} disabled={saving}>Save as Draft</button>
        <button className="btn-primary" style={{ width: 'auto', padding: '11px 24px', marginLeft: 'auto' }} onClick={onPublish} disabled={saving}>
          {saving ? 'Publishing…' : 'Publish Ride'}
        </button>
      </div>
    </>
  );
}
