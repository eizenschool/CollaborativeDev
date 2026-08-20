import { useEffect, useState } from 'react';
import { GoogleMapsEmbedService } from '../../../business-logic/GoogleMapsEmbedService.js';

export default function GoogleRouteMap({
  pickup,
  pickupLocation,
  destination,
  destinationLocation,
  previewLocation,
  waypoints = [],
  className = '',
  children
}) {
  const [route, setRoute] = useState({ pickup, pickupLocation, destination, destinationLocation, previewLocation, waypoints });

  useEffect(() => {
    const timer = window.setTimeout(() => setRoute({ pickup, pickupLocation, destination, destinationLocation, previewLocation, waypoints }), 500);
    return () => window.clearTimeout(timer);
  }, [pickup, pickupLocation, destination, destinationLocation, previewLocation, waypoints]);

  // Directions Embed owns the viewport when a complete route is available,
  // keeping the whole journey visible as its distance changes. Before that,
  // Place mode gives the one-shot device preview a visible map marker.
  const directionsSrc = GoogleMapsEmbedService.buildDirectionsEmbedUrl(route);
  const currentLocationSrc = GoogleMapsEmbedService.buildPlaceEmbedUrl({
    latitude: route.previewLocation?.latitude,
    longitude: route.previewLocation?.longitude
  });
  const src = directionsSrc || currentLocationSrc;
  const label = directionsSrc
    ? `Route from ${pickup} to ${destination}`
    : src ? 'Map marker showing your current location' : 'Route preview';

  if (!src) {
    return <div className={`${className} google-map-fallback`} aria-label={label}>{children}</div>;
  }

  return (
    <div className={`${className} google-map-embed`}>
      <iframe
        title={label}
        src={src}
        loading="lazy"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
}
