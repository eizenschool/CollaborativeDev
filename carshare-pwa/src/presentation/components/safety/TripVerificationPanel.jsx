// ===== PRESENTATION LAYER (TripVerificationPanel) =====
// UC6.2-6.7 + UC6.22, all on one screen: PIN verification, GPS cross-check, trip
// status confirmation, exchange settlement, and (if it lands there) the dispute
// evidence breakdown.
//
// Real usage would have the Host and Client each open this screen on their own
// device, logged in as themselves. This is a single-user prototype, so a
// "Viewing as Host / Client" toggle lets one reviewer walk through both sides of
// the independent-confirmation flow that UC6.4/UC6.6 depend on - it is a demo
// affordance, not a role switch, and is labelled as such in the UI.
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import { TripContractAdapter } from '../../../business-logic/verification/TripContractAdapter.js';
import { TripConfirmationService } from '../../../business-logic/verification/TripConfirmationService.js';
import { ExchangeSettlementService } from '../../../business-logic/verification/ExchangeSettlementService.js';
import {
  EXCHANGE_OUTCOME,
  VERIFICATION_STATUS
} from '../../../business-logic/verification/constants.js';
import DisputeEvidenceCard from './DisputeEvidenceCard.jsx';
import VerificationDemoConsole from './VerificationDemoConsole.jsx';
import { IconArrowLeft, IconMapPin, IconCalendar, IconCheckCircle } from '../icons.jsx';

// Canned coordinate pairs so a reviewer can exercise all three UC6.3 branches on
// demand, rather than depending on real device geolocation permission/signal.
const GPS_PRESETS = {
  pass: { label: 'Same location', host: { lat: 3.1390, lng: 101.6869 }, client: { lat: 3.1391, lng: 101.6870 } },
  mismatch: { label: 'Far away', host: { lat: 3.1390, lng: 101.6869 }, client: { lat: 3.0500, lng: 101.7500 } },
  unavailable: { label: 'No GPS', host: null, client: null }
};

function formatDateTime(date, time) {
  if (!date) return '';
  const d = new Date(`${date}T${time || '00:00'}:00`);
  return d.toLocaleString(undefined, { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function TripVerificationPanel() {
  const { rideId } = useParams();
  const { user } = useAuth();

  const [ride, setRide] = useState(null);
  const [verification, setVerification] = useState(null);
  const [viewingAs, setViewingAs] = useState('client');
  const [error, setError] = useState('');
  const [enteredPin, setEnteredPin] = useState('');
  const [gpsPreset, setGpsPreset] = useState('pass');
  const [noShowResult, setNoShowResult] = useState(null);

  const load = useCallback(async () => {
    const [rideSnapshot, record] = await Promise.all([
      TripContractAdapter.getRideSnapshot(rideId),
      TripConfirmationService.getVerification(rideId)
    ]);
    setRide(rideSnapshot);
    setVerification(record);
    if (record && user) {
      setViewingAs(record.hostId === user.id ? 'host' : 'client');
    }
  }, [rideId, user]);

  useEffect(() => { load(); }, [load]);

  if (!verification || !ride) {
    return (
      <div className="safety-page">
        <Link to="/safety" className="safety-back-link"><IconArrowLeft size={14} /> Back to Safety Centre</Link>
        <p>Loading…</p>
      </div>
    );
  }

  async function handleVerifyPin() {
    setError('');
    const preset = GPS_PRESETS[gpsPreset];
    try {
      const result = await TripConfirmationService.confirmPickup(rideId, {
        enteredPin,
        hostCoords: preset.host,
        clientCoords: preset.client
      });
      if (!result.ok) {
        setError('PIN does not match. Please check with the client and try again.');
        return;
      }
      setEnteredPin('');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleConfirmStatus(phase) {
    setError('');
    try {
      await TripConfirmationService.confirmTripStatus(rideId, viewingAs, phase);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleExchange(outcome) {
    setError('');
    try {
      await ExchangeSettlementService.confirmExchange(rideId, viewingAs, outcome);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleCheckNoShow() {
    setError('');
    try {
      // No `now` passed - checkNoShow defaults to the shared demo clock itself
      // (module6Db.now()), which VerificationDemoConsole's buttons fast-forward.
      const result = await TripConfirmationService.checkNoShow(rideId);
      setNoShowResult(result);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleCheckDefaults() {
    setError('');
    try {
      await ExchangeSettlementService.applyDefaultConfirmations(rideId);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  const status = verification.verificationStatus;
  const visibleExchange = ExchangeSettlementService.getVisibleExchange(verification, viewingAs);

  return (
    <div className="safety-page">
      <Link to="/safety" className="safety-back-link"><IconArrowLeft size={14} /> Back to Safety Centre</Link>

      <div className="safety-page-head">
        <div>
          <h2><IconMapPin size={16} style={{ verticalAlign: -2, marginRight: 4 }} />{ride.pickup} → {ride.destination}</h2>
          <p><IconCalendar size={12} style={{ verticalAlign: -1 }} /> {formatDateTime(ride.date, ride.time)} · Host: {ride.host?.fullName}</p>
        </div>
        <span className={'status-pill status-' + status.toLowerCase().replace(/\s+/g, '-')}>{status}</span>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="viewing-as-toggle">
        <button type="button" className={viewingAs === 'client' ? 'active' : ''} onClick={() => setViewingAs('client')}>
          Viewing as Client
        </button>
        <button type="button" className={viewingAs === 'host' ? 'active' : ''} onClick={() => setViewingAs('host')}>
          Viewing as Host
        </button>
      </div>

      <VerificationDemoConsole onAdvanced={async () => { await handleCheckNoShow(); await handleCheckDefaults(); }} />

      {/* UC6.1/6.2/6.3 - PIN + GPS cross-check */}
      {status === VERIFICATION_STATUS.MATCHED && (
        <div className="verify-section card">
          <div className="verify-section-title"><span className="step-icon">1</span> Pickup verification</div>

          {viewingAs === 'client' ? (
            <div className="pin-display">
              <div className="pin-value">{verification.pin}</div>
              <div className="pin-hint">Show this PIN to your host</div>
            </div>
          ) : (
            <>
              <div className="pin-entry-row">
                <input
                  value={enteredPin}
                  onChange={(e) => setEnteredPin(e.target.value)}
                  placeholder="Enter client's PIN"
                  maxLength={4}
                />
                <button type="button" className="btn-primary" onClick={handleVerifyPin}>Verify PIN</button>
              </div>
              <div className="gps-sim-row">
                {Object.entries(GPS_PRESETS).map(([key, preset]) => (
                  <button
                    type="button"
                    key={key}
                    className={gpsPreset === key ? 'selected' : ''}
                    onClick={() => setGpsPreset(key)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </>
          )}

          <div style={{ marginTop: 14 }}>
            <button type="button" className="btn-secondary" onClick={handleCheckNoShow}>
              Check no-show (UC6.5)
            </button>
            {noShowResult && (
              <div className="alert alert-info" style={{ marginTop: 10 }}>
                {noShowResult.noShow
                  ? `No-show recorded against the client (${noShowResult.elapsedMin?.toFixed(1)} min after scheduled pickup).`
                  : `Not a no-show yet (${noShowResult.reason}).`}
              </div>
            )}
          </div>
        </div>
      )}

      {verification.pickup?.confirmedAt && (
        <div className="verify-section card">
          <div className="verify-section-title"><IconCheckCircle size={16} style={{ color: 'var(--success)' }} /> Pickup confirmed</div>
          <span className={'gps-pill gps-' + verification.pickup.gpsCheck?.toLowerCase().replace(/\s+/g, '-')}>
            {verification.pickup.gpsCheck}
            {verification.pickup.gpsDistanceM != null && ` · ${verification.pickup.gpsDistanceM}m`}
          </span>
        </div>
      )}

      {/* UC6.4 - independent start/completion confirmation */}
      {status !== VERIFICATION_STATUS.MATCHED && (
        <div className="verify-section card">
          <div className="verify-section-title"><span className="step-icon">2</span> Trip status</div>
          <div className="confirm-parties">
            {['host', 'client'].map((party) => {
              const started = Boolean(verification.startConfirm?.[party]);
              const completed = Boolean(verification.completeConfirm?.[party]);
              const canAct = viewingAs === party;
              return (
                <div className="confirm-party-card" key={party}>
                  <div className="party-label">{party}</div>
                  <div className={'party-state ' + (started ? 'done' : 'pending')}>
                    {started ? 'Started ✓' : 'Not started'}
                  </div>
                  {status === VERIFICATION_STATUS.IN_TRANSIT && (
                    <div className={'party-state ' + (completed ? 'done' : 'pending')}>
                      {completed ? 'Completed ✓' : 'Not completed'}
                    </div>
                  )}
                  {canAct && !started && (
                    <button type="button" className="btn-secondary" onClick={() => handleConfirmStatus('start')}>
                      Confirm start
                    </button>
                  )}
                  {canAct && started && status === VERIFICATION_STATUS.IN_TRANSIT && !completed && (
                    <button type="button" className="btn-secondary" onClick={() => handleConfirmStatus('completion')}>
                      Confirm completion
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* UC6.6/6.7/6.22 - exchange settlement */}
      {status === VERIFICATION_STATUS.COMPLETED && (
        <div className="verify-section card">
          <div className="verify-section-title"><span className="step-icon">3</span> Exchange confirmation</div>

          {!visibleExchange.yours ? (
            <div className="exchange-row">
              <button type="button" className="exchange-btn fulfilled" onClick={() => handleExchange(EXCHANGE_OUTCOME.FULFILLED)}>
                Fulfilled
              </button>
              <button type="button" className="exchange-btn not-fulfilled" onClick={() => handleExchange(EXCHANGE_OUTCOME.NOT_FULFILLED)}>
                Not Fulfilled
              </button>
            </div>
          ) : (
            <>
              <div className="exchange-result-row">
                <span>Your confirmation</span>
                <strong>{visibleExchange.yours}</strong>
              </div>
              <div className="exchange-result-row">
                <span>Other party</span>
                {visibleExchange.bothIn
                  ? <strong>{visibleExchange.theirs}</strong>
                  : <span className="exchange-withheld">Withheld until both submit</span>}
              </div>
              {!visibleExchange.bothIn && (
                <button type="button" className="btn-secondary" style={{ marginTop: 10 }} onClick={handleCheckDefaults}>
                  Check 48-hour default (UC6.22)
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* UC6.7/6.8/6.9 - dispute outcome, if any */}
      {verification.dispute?.status && verification.dispute.status !== 'None' && (
        <DisputeEvidenceCard dispute={verification.dispute} />
      )}
    </div>
  );
}
