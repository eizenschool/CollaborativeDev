import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { RideSOSService } from '../../../business-logic/RideSOSService.js';
import { LIVE_STALE_AFTER_MS } from '../../../business-logic/RideLiveTrackingService.js';
import { IconAlertTriangle, IconCheckCircle, IconClock, IconMapPin, IconShield } from '../icons.jsx';
import FamilyLiveMapPanel from './FamilyLiveMapPanel.jsx';

function ageLabel(value, now) {
  const age = now - new Date(value || 0).getTime();
  if (!Number.isFinite(age) || age < 0) return 'just now';
  if (age < 60_000) return `${Math.max(1, Math.round(age / 1000))} seconds ago`;
  return `${Math.round(age / 60_000)} minutes ago`;
}

function signalPresentation(snapshot, stale, hasLocation) {
  if (!snapshot) return { label: 'Connecting', tone: 'neutral' };
  if (snapshot.status === 'resolved') return { label: 'Resolved', tone: 'resolved' };
  if (snapshot.locationState === 'lost') return { label: 'Signal lost', tone: 'danger' };
  if (stale) return { label: 'Location stale', tone: 'waiting' };
  if (hasLocation) return { label: 'Live updates', tone: 'live' };
  return { label: 'Waiting for GPS', tone: 'waiting' };
}

export default function SOSFamilyView() {
  const { eventId } = useParams();
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState('');
  const [clock, setClock] = useState(Date.now());
  const [pageSessionId] = useState(() => globalThis.crypto?.randomUUID?.() || `sos-family-${Date.now()}`);

  useEffect(() => {
    let active = true;
    let timer;
    const refresh = async () => {
      try {
        const result = await RideSOSService.getFamilySnapshot(eventId);
        if (active) { setSnapshot(result); setError(''); }
      } catch (refreshError) {
        if (active) setError(refreshError.message || 'This SOS alert is unavailable.');
      }
      if (active) timer = window.setTimeout(refresh, 10_000);
    };
    void refresh();
    const clockTimer = window.setInterval(() => setClock(Date.now()), 10_000);
    return () => { active = false; window.clearTimeout(timer); window.clearInterval(clockTimer); };
  }, [eventId]);

  const location = snapshot?.location;
  const updatedAt = location?.serverUpdatedAt || location?.capturedAt;
  const stale = Boolean(location) && clock - new Date(updatedAt).getTime() >= LIVE_STALE_AFTER_MS;
  const isActive = snapshot?.status === 'active';
  const isResolved = snapshot?.status === 'resolved';
  const personName = snapshot?.personName || 'Your trusted family member';
  const mapPoints = location ? [{
    ...location,
    markerId: 'sos-location',
    role: 'SOS',
    label: `${personName}’s ${snapshot?.locationState === 'lost' || stale ? 'last known' : 'current'} location`,
    lat: Number(location.lat),
    lng: Number(location.lng),
    accuracyM: Number(location.accuracyM)
  }] : [];
  const signal = signalPresentation(snapshot, stale, Boolean(location));

  return <main className="family-location-page sos-family-page">
    <div className="family-location-shell">
      <header className={`family-location-hero sos-family-hero ${isActive ? 'is-active' : isResolved ? 'is-resolved' : ''}`}>
        <span className="family-location-hero-icon" aria-hidden="true">{isResolved ? <IconCheckCircle size={28} /> : <IconAlertTriangle size={28} />}</span>
        <div><p className="eyebrow">TRUSTED FAMILY SOS</p><h1>{isResolved ? 'SOS resolved' : snapshot ? `${personName} needs help` : 'Loading SOS alert…'}</h1><p>{isResolved ? 'They marked themselves safe or the Ride ended.' : 'Check the latest available location and contact them as soon as you can.'}</p></div>
      </header>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {isActive && <>
        <FamilyLiveMapPanel
          points={mapPoints}
          pageSessionId={pageSessionId}
          title={snapshot?.locationState === 'lost' || stale ? `${personName}’s last known location` : `${personName}’s current location`}
          statusLabel={signal.label}
          statusTone={signal.tone}
          emptyTitle="No GPS point received"
          emptyCopy="The SOS is active, but a location has not reached the server yet."
          ariaLabel={`${personName} SOS location map`}
        />

        <section className="family-location-details-card sos-location-details" aria-labelledby="sos-location-status-title">
          <div className="family-location-section-heading"><div><p className="eyebrow">SOS LOCATION STATUS</p><h2 id="sos-location-status-title">Latest available signal</h2></div><IconMapPin size={22} aria-hidden="true" /></div>
          <div className={`sos-signal-banner signal-${snapshot.locationState}`} role="status" aria-atomic="true">Signal: {snapshot.locationState === 'lost' ? 'lost — showing the last known point' : snapshot.locationState}</div>
          {location ? <div className="sos-location-facts">
            <div><IconClock size={18} aria-hidden="true" /><span><small>Last updated</small><strong>{ageLabel(updatedAt, clock)}</strong></span></div>
            <div><IconMapPin size={18} aria-hidden="true" /><span><small>GPS accuracy</small><strong>±{Math.round(location.accuracyM)} m{stale ? ' · stale' : ''}</strong></span></div>
          </div> : <p className="family-location-empty-copy">No GPS point has been received. The SOS itself is active, but this is not live location.</p>}
          {location && <a className="outline-action full" href={`https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}`} target="_blank" rel="noreferrer">Open in Google Maps</a>}
        </section>

        <aside className="family-location-safety-note"><IconShield size={20} aria-hidden="true" /><div><strong>This page cannot end the SOS</strong><p>Call the person or local emergency services if appropriate. The map may show a stale or last known point when their device loses signal.</p></div></aside>
      </>}

      {isResolved && <section className="family-location-resolved-card"><IconCheckCircle size={34} aria-hidden="true" /><div><h2>Location access has ended</h2><p>The SOS is resolved, so its coordinates are no longer available to trusted family.</p></div></section>}
    </div>
  </main>;
}
