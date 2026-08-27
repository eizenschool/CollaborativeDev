// ===== PRESENTATION LAYER (PublishRide) =====
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import { isRouteQuoteFresh, RideService } from '../../../business-logic/RideService.js';
import { departureParts, formatMalaysiaDeparture } from '../../../business-logic/rideDateTime.js';
import { hasRegisteredVehicle, VehicleService } from '../../../business-logic/VehicleService.js';
import { ReputationService } from '../../../business-logic/ReputationService.js';
import {
  GooglePlacesService,
  MAX_AUTOCOMPLETE_BIAS_ACCURACY_METRES,
  MAX_GPS_ACCURACY_METRES
} from '../../../business-logic/GooglePlacesService.js';
import GoogleRouteMap from '../maps/GoogleRouteMap.jsx';
import ConfirmedLocationInput from '../maps/ConfirmedLocationInput.jsx';
import { IconArrowLeft, IconArrowRight, IconMapPin, IconCar, IconCheck, IconPlus, IconX } from '../icons.jsx';
import RideVehicleSelector from './RideVehicleSelector.jsx';
import { canNavigateToPublishStep, getPublishStepError } from './publishRideSteps.js';
import { M2WaypointRecommendationService } from '../../../business-logic/M2WaypointRecommendationService.js';
import { RidePickupPhotoService } from '../../../business-logic/RidePickupPhotoService.js';
import PickupPhotoField, { PickupPhotoPreview } from './PickupPhotoField.jsx';
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

export function validWaypointStopMinutes(value) {
  if (String(value ?? '').trim() === '') return null;
  const minutes = Number(value);
  return Number.isInteger(minutes) && minutes >= 0 && minutes <= 180 ? minutes : null;
}

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
  const location = useLocation();
  const navigate = useNavigate();
  const { rideId: draftRideId } = useParams();

  // Optional destination prefill, so offering to drive from Module 6's unserved
  // list (FR-6.35) carries the destination across rather than opening a blank
  // form. Only the free-text field is filled: `destinationLocation` stays null
  // because a confirmed Place ID must still come from a Google prediction the
  // Host actually selects, per D013.
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState(0);
  const [furthestStep, setFurthestStep] = useState(0);
  const [form, setForm] = useState(() => {
    const destination = searchParams.get('destination');
    return destination ? { ...emptyForm, destination } : emptyForm;
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [vehicles, setVehicles] = useState(null);
  const [vehicleGateError, setVehicleGateError] = useState('');
  const [vehicleGateAttempt, setVehicleGateAttempt] = useState(0);
  const [reputationEligibility, setReputationEligibility] = useState(null);
  const [reputationGateError, setReputationGateError] = useState('');
  const [previewLocation, setPreviewLocation] = useState(null);
  const [previewStatus, setPreviewStatus] = useState({ state: 'idle', message: '' });
  const [routeQuote, setRouteQuote] = useState(null);
  const [waypointRecommendationRoute, setWaypointRecommendationRoute] = useState(null);
  const [quoteStatus, setQuoteStatus] = useState({ state: 'idle', message: '' });
  const [draftLoading, setDraftLoading] = useState(Boolean(draftRideId));
  const [draftLoadError, setDraftLoadError] = useState('');
  const [pickupPhotoFile, setPickupPhotoFile] = useState(null);
  const [pickupPhotoRemoved, setPickupPhotoRemoved] = useState(false);
  const [pickupPhotoHasExisting, setPickupPhotoHasExisting] = useState(false);
  const [photoRecovery, setPhotoRecovery] = useState(null);
  const locationRequested = useRef(false);
  const stepHeadingRef = useRef(null);
  const errorRef = useRef(null);

  useEffect(() => {
    stepHeadingRef.current?.focus({ preventScroll: true });
  }, [step]);

  useEffect(() => {
    if (error) errorRef.current?.focus({ preventScroll: true });
  }, [error]);

  useEffect(() => {
    if (!draftRideId) return undefined;
    let active = true;
    setDraftLoading(true);
    setDraftLoadError('');
    RideService.getRide(draftRideId).then((draft) => {
      if (!active) return;
      if (!draft || draft.hostId !== user.id || draft.status !== 'Draft') throw new Error('This Draft is unavailable or no longer editable.');
      setForm({
        pickup: draft.pickup || '', pickupLocation: draft.pickupLocation || null,
        destination: draft.destination || '', destinationLocation: draft.destinationLocation || null,
        pickupInstructions: draft.pickupInstructions || '', journeyScale: draft.journeyScale || 'Urban',
        date: draft.date || '', time: draft.time || '', seatsTotal: draft.seatsTotal || 1,
        vehicleId: draft.vehicleId || null, vehicleCapacity: null,
        contribution: draft.contribution || '', restrictionTags: draft.restrictionTags || [],
        waypoints: draft.waypoints || []
      });
      setPickupPhotoHasExisting(Boolean(draft.pickupPhotoPath || draft.hasPickupPhoto));
      setPickupPhotoRemoved(false);
      setFurthestStep(STEPS.length - 1);
    }).catch((loadError) => active && setDraftLoadError(loadError.message)).finally(() => active && setDraftLoading(false));
    return () => { active = false; };
  }, [draftRideId, user.id]);

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
    let active = true;
    setReputationEligibility(null);
    setReputationGateError('');
    ReputationService.getEligibility(user.id, 'host')
      .then((result) => active && setReputationEligibility(result))
      .catch((err) => active && setReputationGateError(err.message || 'Your reputation standing could not be checked.'));
    return () => { active = false; };
  }, [user.id, vehicleGateAttempt]);

  useEffect(() => {
    if (!draftRideId || !vehicles?.length || !form.vehicleId || form.vehicleCapacity) return;
    const vehicle = vehicles.find((item) => item.id === form.vehicleId);
    if (vehicle) setForm((current) => ({ ...current, vehicleCapacity: vehicle.seats }));
  }, [draftRideId, form.vehicleCapacity, form.vehicleId, vehicles]);

  useEffect(() => {
    if (!reputationEligibility?.eligible || !hasRegisteredVehicle(vehicles) || locationRequested.current) return;
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
  }, [reputationEligibility, vehicles]);

  function patch(fields) {
    setForm((f) => ({ ...f, ...fields }));
    setRouteQuote(null);
    setQuoteStatus({ state: 'idle', message: '' });
    if (['pickup', 'pickupLocation', 'destination', 'destinationLocation']
      .some((field) => Object.prototype.hasOwnProperty.call(fields, field))) {
      setWaypointRecommendationRoute(null);
    }
  }

  async function calculateRouteQuote() {
    setQuoteStatus({ state: 'loading', message: 'Calculating traffic-aware route and ETA…' });
    try {
      const quote = await RideService.quoteRide(form, { rideId: draftRideId || null });
      setRouteQuote(quote);
      setWaypointRecommendationRoute(quote?.recommendationRoute || null);
      setQuoteStatus({ state: 'ready', message: 'Route verified. Your Driver schedule is locked and rechecked when you publish.' });
      return quote;
    } catch (err) {
      setRouteQuote(null);
      setQuoteStatus({ state: 'error', message: err.message });
      throw err;
    }
  }

  useEffect(() => {
    // Obtain the host-only base quote as soon as route, departure and vehicle
    // are complete (Trip Details entry). Review reuses it until a waypoint or
    // other route-affecting field invalidates the fingerprint.
    if (step < 3 || routeQuote || quoteStatus.state === 'loading') return;
    calculateRouteQuote().catch(() => {});
  // The form is intentionally excluded: patch() invalidates the quote before
  // the next step can request a new one.
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

  async function syncPickupPhoto(rideId) {
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

  async function finishSavedRide(savedRide, navigation) {
    try {
      await syncPickupPhoto(savedRide.id);
      navigate(navigation.path, navigation.options);
    } catch (photoError) {
      setPhotoRecovery({ savedRide, navigation, message: photoError.message });
    }
  }

  async function retryPickupPhoto() {
    if (!photoRecovery) return;
    setSaving(true);
    try {
      await syncPickupPhoto(photoRecovery.savedRide.id);
      navigate(photoRecovery.navigation.path, photoRecovery.navigation.options);
    } catch (photoError) {
      setPhotoRecovery((current) => ({ ...current, message: photoError.message }));
    } finally {
      setSaving(false);
    }
  }

  async function saveAsDraft() {
    setSaving(true);
    setError('');
    try {
      const saved = draftRideId
        ? await RideService.updateRide(draftRideId, form)
        : await RideService.publishRide(user.id, form, 'Draft');
      await finishSavedRide(saved, { path: '/ride', options: { state: { notice: 'Draft saved.' } } });
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
      const published = draftRideId
        ? await RideService.publishDraft(draftRideId, form, quote)
        : await RideService.publishRide(user.id, { ...form, routeQuote: quote }, 'Published');
      await finishSavedRide(published, {
        path: `/ride/${published.id}`,
        options: { replace: true, state: { returnTo: '/ride', notice: 'Ride published.' } },
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (draftLoading) return <main className="publish-access-state" role="status">Loading your Draft…</main>;

  if (draftLoadError) return <main className="publish-access-state"><section className="publish-access-card" role="alert"><h1>Draft unavailable</h1><p>{draftLoadError}</p><button className="btn-primary" onClick={() => navigate('/ride')}>Back to My rides</button></section></main>;

  if ((!vehicles && !vehicleGateError) || (!reputationEligibility && !reputationGateError)) {
    return <main className="publish-access-state" role="status">Checking your Driver eligibility…</main>;
  }

  if (vehicleGateError || reputationGateError) {
    return (
      <main className="publish-access-state">
        <section className="publish-access-card" role="alert">
          <span className="publish-access-icon"><IconCar size={24} /></span>
          <h1>We couldn't check your Driver access</h1>
          <p>{vehicleGateError || reputationGateError} Location permission has not been requested.</p>
          <div>
            <button className="btn-secondary" onClick={() => navigate('/ride')}>Back to rides</button>
            <button className="btn-primary" onClick={() => setVehicleGateAttempt((attempt) => attempt + 1)}>Try again</button>
          </div>
        </section>
      </main>
    );
  }

  if (!reputationEligibility.eligible) {
    return (
      <main className="publish-access-state">
        <section className="publish-access-card" role="alert">
          <span className="publish-access-icon"><IconCar size={24} /></span>
          <h1>Ride publishing is paused</h1>
          <p>{reputationEligibility.reason} Your location was not requested.</p>
          <div>
            <button className="btn-secondary" onClick={() => navigate('/ride')}>Back to rides</button>
            <button className="btn-primary" onClick={() => navigate('/profile')}>View reputation</button>
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
        <div><p>{draftRideId ? 'Resume Draft · ' : ''}Step {step + 1} of {STEPS.length}</p><h1>{STEPS[step]}</h1></div>
        {step === STEPS.length - 1 && <button className="save-draft-mobile" onClick={saveAsDraft} disabled={saving || Boolean(photoRecovery)}>Save draft</button>}
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
        {step === STEPS.length - 1 && <button className="btn-link" onClick={saveAsDraft} disabled={saving || Boolean(photoRecovery)}>Save as draft</button>}
      </div>

      <div className="publish-right">
        <p className="step-eyebrow">Step {step + 1} of {STEPS.length}</p>
        <h2 ref={stepHeadingRef} className="step-title" tabIndex={-1}>{STEPS[step]}</h2>
        <p className="step-description">{STEP_DESCRIPTIONS[step]}</p>

        {location.state?.republishedFromRideId && <div className="alert alert-info" role="status">New Draft created from your Ride history. Review the old departure date and time before publishing. The previous Ride's pickup photo was not copied.</div>}
        {error && <div ref={errorRef} className="alert alert-error publish-error" role="alert" tabIndex={-1}><span>{error}</span>{/In Transit/i.test(error) && <button type="button" className="btn-link" onClick={() => navigate('/ride')}>Open My rides to complete it</button>}</div>}
        {photoRecovery && <div className="alert alert-error pickup-photo-recovery" role="alert"><div><strong>Ride saved, but the pickup photo was not uploaded.</strong><span>{photoRecovery.message}</span></div><button type="button" className="btn-secondary" disabled={saving} onClick={retryPickupPhoto}>Retry photo</button><button type="button" className="btn-link" onClick={() => navigate(photoRecovery.navigation.path, photoRecovery.navigation.options)}>Continue without photo</button></div>}

        {step === 0 && <RouteStep form={form} patch={patch} previewLocation={previewLocation} previewStatus={previewStatus} />}
        {step === 1 && <ScheduleStep form={form} patch={patch} />}
        {step === 2 && <RideVehicleSelector vehicles={vehicles} vehicleId={form.vehicleId} onSelect={(vehicle) => patch({ vehicleId: vehicle.id, vehicleCapacity: vehicle.seats, seatsTotal: Math.min(form.seatsTotal, vehicle.seats) })} />}
        {step === 3 && <TripDetailsStep form={form} patch={patch} previewLocation={previewLocation} recommendationRoute={waypointRecommendationRoute} quoteStatus={quoteStatus} pickupPhoto={{ file: pickupPhotoFile, hasExisting: pickupPhotoHasExisting, removed: pickupPhotoRemoved, rideId: draftRideId || null }} onPickupPhoto={(file) => { setPickupPhotoFile(file); setPickupPhotoRemoved(false); }} onRemovePickupPhoto={() => { setPickupPhotoFile(null); setPickupPhotoRemoved(pickupPhotoHasExisting); }} />}
        {step === 4 && <ReviewStep form={form} routeQuote={routeQuote} quoteStatus={quoteStatus} onRefreshQuote={() => calculateRouteQuote().catch(() => {})} onBack={back} onPublish={publish} onDraft={saveAsDraft} saving={saving || Boolean(photoRecovery)} pickupPhoto={{ file: pickupPhotoFile, hasExisting: pickupPhotoHasExisting, removed: pickupPhotoRemoved, rideId: draftRideId || null }} />}

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
  const autocompleteOrigin = previewLocation?.accuracy <= MAX_AUTOCOMPLETE_BIAS_ACCURACY_METRES
    ? previewLocation
    : null;
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
          currentLocationPreview={autocompleteOrigin}
          loadNearbySuggestions={GooglePlacesService.searchNearbyPickupLocations}
        />
        <ConfirmedLocationInput
          id="ride-destination"
          label="Destination"
          placeholder="Search in Malaysia, e.g. Georgetown"
          value={form.destination}
          location={form.destinationLocation}
          onChange={(destination, destinationLocation) => patch({ destination, destinationLocation })}
          currentLocationPreview={autocompleteOrigin}
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
function TripDetailsStep({ form, patch, previewLocation, recommendationRoute, quoteStatus, pickupPhoto, onPickupPhoto, onRemovePickupPhoto }) {
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

  function addRecommendedWaypoint(recommendation, customMinutes) {
    if (form.waypoints.length >= 10) {
      setWaypointError('A ride can have at most 10 waypoints.');
      return;
    }
    patch({
      waypoints: [...form.waypoints, {
        name: recommendation.name,
        description: recommendation.description,
        placeId: recommendation.placeId,
        stopMinutes: customMinutes,
      }],
    });
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
        <PickupPhotoField
          rideId={pickupPhoto.rideId}
          file={pickupPhoto.file}
          hasExisting={pickupPhoto.hasExisting}
          removed={pickupPhoto.removed}
          onFileChange={onPickupPhoto}
          onRemove={onRemovePickupPhoto}
        />
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
          <WaypointRecommendationPanel
            recommendationRoute={recommendationRoute}
            quoteStatus={quoteStatus}
            selectedWaypoints={form.waypoints}
            onAdd={addRecommendedWaypoint}
          />
          <div className="waypoint-manual-divider"><span>Or add your own stop</span></div>
          <ConfirmedLocationInput
            id="ride-waypoint"
            label="Confirmed stop"
            placeholder="Search for a stop in Malaysia"
            value={waypoint}
            location={waypointLocation}
            onChange={(name, location) => { setWaypoint(name); setWaypointLocation(location); setWaypointError(''); }}
            currentLocationPreview={previewLocation?.accuracy <= MAX_AUTOCOMPLETE_BIAS_ACCURACY_METRES ? previewLocation : null}
          />
          <div className="waypoint-stop-row">
            <label htmlFor="waypoint-stop-minutes">Stop duration</label>
            <div><input id="waypoint-stop-minutes" type="number" min="0" max="180" step="5" value={stopMinutes} onChange={(event) => setStopMinutes(Math.max(0, Math.min(180, Number(event.target.value) || 0)))} /><span>minutes</span></div>
          </div>
          <button type="button" className="btn-secondary waypoint-confirm-add" onClick={addWaypoint}><IconPlus size={16} /> Add confirmed stop</button>
        </div>
        {waypointError && <p className="location-field-message error" role="alert">{waypointError}</p>}
        {form.waypoints.length > 0 && <div className="waypoint-lines">{form.waypoints.map((item, index) => <div key={`${item.placeId || item.name}-${index}`}><span><IconMapPin size={14} />{item.name}<small>{item.placeId ? 'Confirmed Google stop' : 'Reconfirm before publishing'}</small></span><label className="waypoint-selected-duration"><span>Stop duration</span><input type="number" min="0" max="180" step="5" value={item.stopMinutes} disabled={!item.placeId} aria-label={`${item.name} stop duration in minutes`} onChange={(event) => { const minutes = validWaypointStopMinutes(event.target.value); if (minutes === null) { setWaypointError('Stop duration must be a whole number from 0 to 180 minutes.'); return; } patch({ waypoints: form.waypoints.map((waypointItem, itemIndex) => itemIndex === index ? { ...waypointItem, stopMinutes: minutes } : waypointItem) }); setWaypointError(''); }} /><small>minutes</small></label><button type="button" onClick={() => patch({ waypoints: form.waypoints.filter((_, itemIndex) => itemIndex !== index) })} aria-label={`Remove ${item.name}`}><IconX size={15} /></button></div>)}</div>}
      </div>
    </>
  );
}

// ---------- STEP 5: REVIEW & PUBLISH ----------
function ReviewStep({ form, routeQuote, quoteStatus, onRefreshQuote, onBack, onPublish, onDraft, saving, pickupPhoto }) {
  const fresh = isRouteQuoteFresh(routeQuote);
  const hasPickupPhoto = Boolean(pickupPhoto.file || (pickupPhoto.hasExisting && !pickupPhoto.removed));
  return (
    <>
      <div className="card">
        <p className="card-title">Trip summary</p>
        <div className="review-row"><span>Route</span><strong>{form.pickup || '—'} → {form.destination || '—'}</strong></div>
        <div className="review-row"><span>Pickup instructions</span><strong>{form.pickupInstructions || 'None'}</strong></div>
        <div className="review-row review-pickup-photo"><span>Pickup photo</span>{hasPickupPhoto ? <div className="review-pickup-photo-media"><PickupPhotoPreview file={pickupPhoto.file} rideId={pickupPhoto.rideId} hasExisting={pickupPhoto.hasExisting} removed={pickupPhoto.removed} /></div> : <strong>None</strong>}</div>
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

function WaypointRecommendationPanel({ recommendationRoute, quoteStatus, selectedWaypoints, onAdd }) {
  const [items, setItems] = useState([]);
  const [state, setState] = useState('idle');
  const [expandedPlaceId, setExpandedPlaceId] = useState('');
  const [minutes, setMinutes] = useState('30');
  const [durationError, setDurationError] = useState('');

  useEffect(() => {
    let active = true;
    if (!recommendationRoute || selectedWaypoints.length >= 10) {
      setItems([]);
      setState('idle');
      return undefined;
    }
    setState('loading');
    M2WaypointRecommendationService.queryWaypointRecommendations({ recommendationRoute }, selectedWaypoints)
      .then((recommendations) => {
        if (!active) return;
        setItems(recommendations);
        setState('ready');
      })
      .catch(() => {
        if (active) { setItems([]); setState('error'); }
      });
    return () => { active = false; };
  }, [recommendationRoute, selectedWaypoints]);

  if (selectedWaypoints.length >= 10) return <p className="waypoint-recommendation-state">The 10-stop limit has been reached.</p>;
  if (!recommendationRoute && quoteStatus?.state === 'loading') return <p className="waypoint-recommendation-state" role="status">Finding culinary and cultural stops along your route…</p>;
  if (!recommendationRoute && quoteStatus?.state === 'error') return <p className="waypoint-recommendation-state">Suggestions need a verified route. You can still add your own confirmed stop below.</p>;
  if (state === 'error') return <p className="waypoint-recommendation-state">Suggested stops are unavailable. You can still add your own confirmed stop below.</p>;
  if (state === 'loading') return <p className="waypoint-recommendation-state" role="status">Finding culinary and cultural stops along your route…</p>;
  if (state === 'ready' && !items.length) return <p className="waypoint-recommendation-state">No culinary or cultural suggestions were found along this route. Add your own stop below.</p>;
  if (!items.length) return null;
  return <div className="waypoint-recommendations"><p className="waypoint-option-label">Suggested along your route</p><div className="waypoint-recommendation-list">{items.map((item) => {
    const expanded = expandedPlaceId === item.placeId;
    return <article className={`waypoint-recommendation${expanded ? ' expanded' : ''}`} key={item.placeId}><button type="button" className="waypoint-recommendation-open" aria-expanded={expanded} onClick={() => { setExpandedPlaceId(expanded ? '' : item.placeId); setMinutes(String(item.stopMinutes)); setDurationError(''); }} disabled={selectedWaypoints.length >= 10}><span><strong>{item.name}</strong><small>{item.category === 'culinary' ? 'Culinary' : 'Cultural'} · {item.stopMinutes} min default stop</small></span><IconPlus size={17} aria-hidden="true" /></button>{expanded && <div className="waypoint-recommendation-duration"><label htmlFor={`recommended-stop-${item.placeId}`}>Stop duration</label><div><input id={`recommended-stop-${item.placeId}`} type="number" min="0" max="180" step="5" value={minutes} aria-describedby={durationError ? `recommended-stop-error-${item.placeId}` : undefined} onChange={(event) => { setMinutes(event.target.value); setDurationError(''); }} /><span>minutes</span></div>{durationError && <small id={`recommended-stop-error-${item.placeId}`} className="error" role="alert">{durationError}</small>}<div className="waypoint-recommendation-actions"><button type="button" className="btn-link" onClick={() => { setExpandedPlaceId(''); setDurationError(''); }}>Cancel</button><button type="button" className="btn-secondary" onClick={() => { const parsed = validWaypointStopMinutes(minutes); if (parsed === null) { setDurationError('Enter a whole number from 0 to 180.'); return; } onAdd(item, parsed); setExpandedPlaceId(''); setDurationError(''); }}>Add stop</button></div></div>}</article>;
  })}</div><small>Choose a suggestion or add your own. Any stop change requires a fresh route quote.</small></div>;
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
