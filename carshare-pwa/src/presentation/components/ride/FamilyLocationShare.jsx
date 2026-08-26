import { useEffect, useState } from 'react';
import { FamilyLocationShareService } from '../../../business-logic/FamilyLocationShareService.js';
import { isPointStale } from '../../../business-logic/RideLiveTrackingService.js';
import { IconClock, IconMapPin, IconShield, IconUsers } from '../icons.jsx';
import FamilyLiveMapPanel from './FamilyLiveMapPanel.jsx';

function ageLabel(value, now) {
  const age = now - new Date(value || 0).getTime();
  if (!Number.isFinite(age) || age < 0) return 'just now';
  if (age < 60_000) return `${Math.max(1, Math.round(age / 1000))} seconds ago`;
  return `${Math.round(age / 60_000)} minutes ago`;
}

function statusPresentation(status, hasLocations) {
  if (status === 'active' && hasLocations) return { label: 'Live updates', tone: 'live' };
  if (status === 'scheduled') return { label: 'Scheduled', tone: 'neutral' };
  if (status === 'invalid') return { label: 'Unavailable', tone: 'danger' };
  if (status === 'loading') return { label: 'Connecting', tone: 'neutral' };
  return { label: 'Waiting for GPS', tone: 'waiting' };
}

export default function FamilyLocationShare() {
  const token = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('token') || '';
  const [locations, setLocations] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [mapPermit, setMapPermit] = useState(null);
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
    if (!token || !locations.length || mapPermit !== null) return undefined;
    let active = true;
    FamilyLocationShareService.consumeMapLoad(token, pageSessionId)
      .then((result) => { if (active) setMapPermit(result.allowed === true); })
      .catch(() => { if (active) setMapPermit(false); });
    return () => { active = false; };
  }, [locations.length, mapPermit, pageSessionId, token]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  const hasLocations = locations.length > 0;
  const mapStatus = statusPresentation(status, hasLocations);
  const mapPermitPending = hasLocations && mapPermit === null;

  return <main className="family-location-page family-share-page">
    <div className="family-location-shell">
      <header className="family-location-hero">
        <span className="family-location-hero-icon" aria-hidden="true"><IconShield size={28} /></span>
        <div><p className="eyebrow">FAMILY LIVE LOCATION</p><h1>Ride location</h1><p>See the latest location shared by your family member and their Driver. This private link never includes trip history.</p></div>
      </header>

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {status === 'invalid' && !error && <div className="alert alert-error" role="alert">This family link is invalid or expired.</div>}

      <FamilyLiveMapPanel
        points={locations}
        pageSessionId={pageSessionId}
        mapPermit={mapPermit}
        mapPermitPending={mapPermitPending}
        title="Current shared locations"
        statusLabel={mapStatus.label}
        statusTone={mapStatus.tone}
        emptyTitle={status === 'invalid' ? 'This link is no longer available' : status === 'scheduled' ? 'Live sharing has not opened yet' : 'Waiting for a shared location'}
        emptyCopy={status === 'invalid'
          ? 'Ask your family member to create a new link if location sharing is still needed.'
          : status === 'scheduled'
            ? 'The secure live map opens one hour before departure.'
            : 'The map will appear when the passenger or Driver starts sharing.'}
        ariaLabel="Family ride live location map"
      />

      <section className="family-location-details-card" aria-labelledby="family-shared-people-title">
        <div className="family-location-section-heading"><div><p className="eyebrow">LOCATION DETAILS</p><h2 id="family-shared-people-title">People currently sharing</h2></div><IconUsers size={22} aria-hidden="true" /></div>
        {hasLocations ? <ul className="family-location-list">
          {locations.map((item) => {
            const stale = isPointStale(item, clock);
            const label = item.role === 'Driver' ? 'Driver’s current location' : 'Shared passenger location';
            return <li key={item.markerId}>
              <span className={`family-location-marker ${item.role === 'Driver' ? 'is-driver' : 'is-passenger'}`} aria-hidden="true"><IconMapPin size={18} /></span>
              <span className="family-location-person"><strong>{label}</strong><small><IconClock size={13} aria-hidden="true" /> Updated {ageLabel(item.serverUpdatedAt || item.capturedAt, clock)} · GPS ±{Math.round(item.accuracyM)} m{stale ? ' · stale' : ''}</small></span>
              <a className="outline-action" href={`https://www.google.com/maps/search/?api=1&query=${item.lat},${item.lng}`} target="_blank" rel="noreferrer">Open in Google Maps</a>
            </li>;
          })}
        </ul> : <p className="family-location-empty-copy">{status === 'invalid' ? 'No location is available from this link.' : 'No one is sharing a GPS point yet. This page refreshes automatically.'}</p>}
      </section>

      <aside className="family-location-privacy-note"><IconShield size={20} aria-hidden="true" /><div><strong>Privacy protected</strong><p>Only the shared passenger and Driver can appear here. Other passengers, account IDs and route history are never shown.</p></div></aside>
    </div>
  </main>;
}
