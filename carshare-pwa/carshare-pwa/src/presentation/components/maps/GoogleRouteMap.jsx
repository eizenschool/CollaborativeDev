import { useEffect, useState } from 'react';
import { GoogleMapsEmbedService } from '../../../business-logic/GoogleMapsEmbedService.js';

export default function GoogleRouteMap({
  pickup,
  destination,
  waypoints = [],
  className = '',
  children
}) {
  const [route, setRoute] = useState({ pickup, destination, waypoints });

  useEffect(() => {
    const timer = window.setTimeout(() => setRoute({ pickup, destination, waypoints }), 500);
    return () => window.clearTimeout(timer);
  }, [pickup, destination, waypoints]);

  const src = GoogleMapsEmbedService.buildDirectionsEmbedUrl(route);
  const label = pickup && destination ? `Route from ${pickup} to ${destination}` : 'Route preview';

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
