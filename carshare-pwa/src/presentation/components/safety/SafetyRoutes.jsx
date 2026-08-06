// ===== PRESENTATION LAYER (SafetyRoutes) =====
// Module 6's own sub-router, mounted at /safety/* by a single line in App.jsx.
// Everything under this path is Module 6's own screens - App.jsx does not need to
// know what routes exist beneath it, and Module 6 does not touch any other
// module's route.
import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { TripConfirmationService } from '../../../business-logic/verification/TripConfirmationService.js';
import { TripContractAdapter } from '../../../business-logic/verification/TripContractAdapter.js';
import { DISPUTE_STATUS } from '../../../business-logic/verification/constants.js';
import TripVerificationPanel from './TripVerificationPanel.jsx';
import AdminDisputeConsole from './AdminDisputeConsole.jsx';
import VerificationDemoConsole from './VerificationDemoConsole.jsx';
import { IconShield, IconMapPin } from '../icons.jsx';
import '../../styles/safety.css';

function SafetyHub() {
  const [rows, setRows] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);

  const load = useCallback(async () => {
    const verifications = await TripConfirmationService.listAllVerifications();
    const withRides = await Promise.all(
      verifications.map(async (v) => ({ verification: v, ride: await TripContractAdapter.getRideSnapshot(v.rideId) }))
    );
    setRows(withRides);
    setPendingCount(withRides.filter((r) => r.verification.dispute?.status === DISPUTE_STATUS.PENDING_REVIEW).length);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="safety-page">
      <div className="safety-page-head">
        <div>
          <h2><IconShield size={18} style={{ verticalAlign: -3, marginRight: 6 }} />Safety Centre</h2>
          <p>Trip verification, exchange settlement and dispute resolution (Module 6).</p>
        </div>
        {pendingCount > 0 && (
          <Link to="/safety/admin" className="admin-link-chip">{pendingCount} awaiting review</Link>
        )}
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
      <Route path="admin" element={<AdminDisputeConsole />} />
      <Route path="*" element={<Navigate to="/safety" replace />} />
    </Routes>
  );
}
