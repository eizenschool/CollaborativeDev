import { GoogleMapsEmbedService } from '../../../business-logic/GoogleMapsEmbedService.js';
import { IconMapPin } from '../icons.jsx';

export default function GoogleLocationMap({ latitude, longitude, compact = false }) {
  const src = GoogleMapsEmbedService.buildPlaceEmbedUrl({ latitude, longitude });
  const openUrl = GoogleMapsEmbedService.buildGoogleMapsLocationUrl({ latitude, longitude });
  const label = `Shared location at ${Number(latitude).toFixed(5)}, ${Number(longitude).toFixed(5)}`;

  return (
    <section className={`message-location-embed ${compact ? 'message-location-embed-compact' : ''}`}>
      {src ? (
        <iframe
          title={label}
          src={src}
          loading="lazy"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <div className="message-location-fallback" aria-label={label}>
          <IconMapPin size={28} />
          <span>{Number(latitude).toFixed(5)}, {Number(longitude).toFixed(5)}</span>
        </div>
      )}
      {openUrl && (
        <a href={openUrl} target="_blank" rel="noreferrer">
          Open in Google Maps
        </a>
      )}
    </section>
  );
}
