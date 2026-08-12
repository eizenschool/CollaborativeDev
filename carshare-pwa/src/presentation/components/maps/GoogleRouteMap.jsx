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

  const directionsSrc = GoogleMapsEmbedService.buildDirectionsEmbedUrl(route);
  const src = directionsSrc || GoogleMapsEmbedService.buildViewEmbedUrl({ location: route.previewLocation });
  const label = directionsSrc
    ? `Route from ${pickup} to ${destination}`
    : src ? 'Map centred on your current location' : 'Route preview';

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
