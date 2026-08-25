import { useEffect, useState } from 'react';
import { FamilyLocationShareService } from '../../../business-logic/FamilyLocationShareService.js';
import { isPointStale } from '../../../business-logic/RideLiveTrackingService.js';
import LiveRideMap from '../maps/LiveRideMap.jsx';

export default function FamilyLocationShare() {
  const token = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('token') || '';
  const [locations, setLocations] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [mapPermit, setMapPermit] = useState(false);
  const [mapPermitChecked, setMapPermitChecked] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const [pageSessionId] = useState(() => globalThis.crypto?.randomUUID?.() || `family-${Date.now()}`);

  useEffect(() => {
    if (!token) { setStatus('invalid'); return undefined; }
    let active = true;
    let timer;
    const refresh = async () => {
      try {
        const result = await FamilyLocationShareService.getSnapshot(token);
        if (!active) return;
        setLocations((result.locations || []).map((item) => ({
          ...item,
          markerId: item.markerId || (item.role === 'Driver' ? 'driver' : 'shared-passenger'),
          role: item.role,
          lat: Number(item.lat),
          lng: Number(item.lng),
          accuracyM: Number(item.accuracyM)
        })).sort((left, right) => (left.role === 'Driver' ? -1 : 0) - (right.role === 'Driver' ? -1 : 0)));
        setStatus(result.status || 'waiting');
        setError('');
      } catch (refreshError) {
        if (!active) return;
        if (refreshError.status === 404) {
          setStatus('invalid');
          setError('This family link is invalid or expired.');
          return;
        }
        setError(refreshError.message || 'Live location is temporarily unavailable.');
      }
      if (active) timer = window.setTimeout(refresh, 10_000);
    };
    refresh();
    return () => { active = false; window.clearTimeout(timer); };
  }, [pageSessionId, token]);

  useEffect(() => {
    if (!token || !locations.length || mapPermitChecked) return undefined;
    let active = true;
    setMapPermitChecked(true);
    FamilyLocationShareService.consumeMapLoad(token, pageSessionId)
      .then((result) => { if (active) setMapPermit(result.allowed === true); })
      .catch(() => { if (active) setMapPermit(false); });
    return () => { active = false; };
  }, [locations.length, mapPermitChecked, pageSessionId, token]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  return <main className="phone-ride-page ride-detail-page family-share-page"><div className="ride-detail-content"><p className="eyebrow">FAMILY LIVE LOCATION</p><h1>Ride location</h1><p>Only the shared passenger and Driver location are shown. This link does not include trip history.</p>{error && status !== 'invalid' && <div className="alert alert-error" role="alert">{error}</div>}{status === 'scheduled' && <div className="alert" role="status">This ride is scheduled. Live sharing opens one hour before departure.</div>}{status === 'waiting' && <div className="alert" role="status">The share is valid. Waiting for the passenger or Driver to start sharing.</div>}{status === 'invalid' && <div className="alert alert-error" role="alert">This family link is invalid or expired.</div>}{locations.length > 0 && mapPermit && <LiveRideMap ride={{ pickupLocation: null }} points={locations} pageSessionId={pageSessionId} mapPermit />}{locations.length > 0 && <div className="live-location-list">{locations.map((item) => <div key={item.markerId}><span><strong>{item.role === 'Driver' ? 'Driver’s current location' : 'Shared passenger location'}</strong><small>{isPointStale(item, clock) ? 'Stale location' : `GPS ±${Math.round(item.accuracyM)} m`}</small></span><a href={`https://www.google.com/maps/search/?api=1&query=${item.lat},${item.lng}`} target="_blank" rel="noreferrer">Open in Google Maps</a></div>)}</div>}</div></main>;
}
