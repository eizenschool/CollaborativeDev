// ===== PRESENTATION LAYER (SafetyRoutes) =====
// Module 2's ride-verification sub-router, mounted at /safety/* by the shared app
// composition root. The screens originated in the former Module 6 Trust & Safety
// scope before that responsibility moved to Module 2.
import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { TripConfirmationService } from '../../../../business-logic/m2-rides/verification/TripConfirmationService.js';
import { TripContractAdapter } from '../../../../business-logic/m2-rides/verification/TripContractAdapter.js';
import TripVerificationPanel from './TripVerificationPanel.jsx';
import VerificationDemoConsole from './VerificationDemoConsole.jsx';
import { IconShield, IconMapPin } from '../../../shared/components/icons.jsx';
import '../../styles/safety.css';

function SafetyHub() {
  const [rows, setRows] = useState(null);

  const load = useCallback(async () => {
    const verifications = await TripConfirmationService.listAllVerifications();
    const withRides = await Promise.all(
      verifications.map(async (v) => ({ verification: v, ride: await TripContractAdapter.getRideSnapshot(v.rideId) }))
    );
    setRows(withRides);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="safety-page">
      <div className="safety-page-head">
        <div>
          <h2><IconShield size={18} style={{ verticalAlign: -3, marginRight: 6 }} />Safety Centre</h2>
          <p>Trip verification, exchange settlement and dispute resolution (Module 2).</p>
        </div>
      </div>

      <VerificationDemoConsole onAdvanced={load} />

      {rows === null && <p>Loading…</p>}

      <div className="safety-trip-list">
        {rows && rows.map(({ verification, ride }) => (
          <Link to={`/safety/trip/${verification.rideId}`} className="safety-trip-card" key={verification.rideId}>
            <div>
              <div className="safety-trip-route">
                <IconMapPin size={13} style={{ verticalAlign: -2 }} /> {ride?.pickup || verification.rideId}
                <span className="arrow">→</span>{ride?.destination || ''}
              </div>
              <div className="safety-trip-sub">Host: {ride?.host?.fullName || verification.hostId}</div>
            </div>
            <span className={'status-pill status-' + verification.verificationStatus.toLowerCase().replace(/\s+/g, '-')}>
              {verification.verificationStatus}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function SafetyRoutes() {
  return (
    <Routes>
      <Route index element={<SafetyHub />} />
      <Route path="trip/:rideId" element={<TripVerificationPanel />} />
      <Route path="*" element={<Navigate to="/safety" replace />} />
    </Routes>
  );
}
