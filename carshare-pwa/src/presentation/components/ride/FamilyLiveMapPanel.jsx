import LiveRideMap from '../maps/LiveRideMap.jsx';
import { IconMapPin } from '../icons.jsx';
import '../../styles/ride.css';

function hasValidPoint(point) {
  return Number.isFinite(Number(point?.lat))
    && Number.isFinite(Number(point?.lng))
    && Number.isFinite(Number(point?.accuracyM));
}

export default function FamilyLiveMapPanel({
  points = [],
  pageSessionId,
  mapPermit,
  mapPermitPending = false,
  title = 'Current shared location',
  statusLabel = 'Waiting for location',
  statusTone = 'neutral',
  emptyTitle = 'No location yet',
  emptyCopy = 'The map will appear when a shared GPS point is available.',
  ariaLabel = 'Shared live location map'
}) {
  const visiblePoints = points.filter(hasValidPoint);
  const usesExternalPermit = mapPermitPending || typeof mapPermit === 'boolean';
  const mapUnavailable = visiblePoints.length > 0 && usesExternalPermit && mapPermit === false && !mapPermitPending;
  const canRenderMap = visiblePoints.length > 0 && (!usesExternalPermit || mapPermit === true);

  return <section className="family-live-map-card" aria-label={title}>
    <header className="family-live-map-header">
      <div><p className="eyebrow">LIVE MAP</p><h2>{title}</h2></div>
      <span className={`family-map-status tone-${statusTone}`} role="status" aria-atomic="true">{statusLabel}</span>
    </header>
    {canRenderMap ? <LiveRideMap
      ride={{ pickupLocation: null }}
      points={visiblePoints}
      pageSessionId={pageSessionId}
      mapPermit={mapPermit === true}
      ariaLabel={ariaLabel}
    /> : <div className="family-map-placeholder">
      <span aria-hidden="true"><IconMapPin size={28} /></span>
      <strong>{mapPermitPending ? 'Preparing the secure map…' : mapUnavailable ? 'Interactive map unavailable' : emptyTitle}</strong>
      <p>{mapPermitPending
        ? 'Your shared location details will remain visible while the map loads.'
        : mapUnavailable
          ? 'Use the location details and Open in Google Maps link below.'
          : emptyCopy}</p>
    </div>}
  </section>;
}
