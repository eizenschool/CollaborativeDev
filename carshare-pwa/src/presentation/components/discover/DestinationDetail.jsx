// ===== PRESENTATION LAYER (DestinationDetail) =====
// UC6.2 - one destination examined closely.
//
// Presentation falls through the data-sufficiency tiers in order: photograph
// carousel with attribution, then Street View where coverage exists, then a
// category illustration. The fixture carries references rather than live images,
// so it lands on the illustration tier - which is exactly the fallback the tier
// list requires, not a placeholder standing in for missing work.
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import { DestinationDiscoveryService } from '../../../business-logic/discovery/DestinationDiscoveryService.js';
import { REVIEW_CONFIDENCE_SATURATION, CATEGORY } from '../../../business-logic/discovery/constants.js';
import { IconArrowLeft, IconStar, IconMapPin, IconCar, IconUsers } from '../icons.jsx';

const CATEGORY_ART = {
  [CATEGORY.CULINARY]: '🍜',
  [CATEGORY.HERITAGE]: '🏛️',
  [CATEGORY.NATURE]: '🌿',
  [CATEGORY.EVENT]: '🎪'
};

const today = () => new Date().toISOString().slice(0, 10);

export default function DestinationDetail() {
  const { placeId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const detail = await DestinationDiscoveryService.getDestination(placeId, { travelDate: today() });
      if (!cancelled) { setData(detail); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [placeId]);

  if (loading) return <div className="dsc-page"><p className="dsc-empty">Loading…</p></div>;
  if (!data) {
    return (
      <div className="dsc-page">
        <p className="dsc-empty">That destination is no longer available.</p>
        <button className="dsc-btn" onClick={() => navigate('/discover')} type="button">Back</button>
      </div>
    );
  }

  const { place, rides, interestedUsers } = data;
  const photos = place.photoReferences || [];
  const seatsLeft = rides.reduce((best, r) => Math.max(best, r.seatsAvailable || 0), 0);
  const showRating = place.rating && place.reviewCount >= REVIEW_CONFIDENCE_SATURATION;

  const notifyMe = async () => {
    const { alreadyExisted } = await DestinationDiscoveryService
      .registerForNotification(user?.id, place.id, today());
    setNotice(alreadyExisted ? 'You are already registered for this destination.' : 'We will let you know.');
  };

  return (
    <div className="dsc-page dsc-detail">
      <button className="dsc-back" onClick={() => navigate('/discover')} type="button">
        <IconArrowLeft size={16} /> Back to destinations
      </button>

      <div className="dsc-detail-media">
        {photos.length > 0 ? (
          <>
            <span className="dsc-card-art dsc-detail-art" aria-hidden="true">
              {CATEGORY_ART[place.category]}
            </span>
            {/* FR-6.14: the photographer is credited wherever a photograph is shown. */}
            <span className="dsc-photo-credit">Photo: {photos[photoIndex]?.attribution}</span>
            {photos.length > 1 && (
              <div className="dsc-carousel-dots">
                {photos.map((p, index) => (
                  <button
                    key={p.reference}
                    type="button"
                    className={'dsc-dot' + (index === photoIndex ? ' active' : '')}
                    onClick={() => setPhotoIndex(index)}
                    aria-label={`Photo ${index + 1} of ${photos.length}`}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          // Neither photograph nor Street View coverage: the illustration tier.
          <span className="dsc-card-art dsc-detail-art" aria-hidden="true">
            {CATEGORY_ART[place.category]}
          </span>
        )}
      </div>

      <h1>{place.name}</h1>
      <div className="dsc-card-meta">
        <span className={`dsc-chip dsc-chip-${place.category}`}>{place.category}</span>
        <span className="dsc-meta-item"><IconMapPin size={13} /> {place.state}</span>
        {showRating ? (
          <span className="dsc-rating">
            <IconStar size={13} /> {place.rating.toFixed(1)}
            <span className="dsc-review-count">({place.reviewCount.toLocaleString()})</span>
          </span>
        ) : (
          <span className="dsc-rating dsc-rating-low">Too few reviews to rate</span>
        )}
      </div>

      <p className="dsc-detail-desc">{place.description}</p>
      {place.descriptionIsTemplate && (
        <p className="dsc-template-note">
          This description is a category template — the source holds too few
          reviews to summarise.
        </p>
      )}

      {rides.length > 0 ? (
        <div className="dsc-availability dsc-served">
          <IconCar size={14} />
          <span><strong>{rides.length}</strong> ride{rides.length > 1 ? 's' : ''} going, <strong>{seatsLeft}</strong> seat{seatsLeft === 1 ? '' : 's'} left</span>
        </div>
      ) : (
        <div className="dsc-availability dsc-unserved">
          <IconUsers size={14} />
          <span>
            {interestedUsers > 0
              ? <><strong>{interestedUsers}</strong> {interestedUsers === 1 ? 'person wants' : 'people want'} to go — nobody is driving yet</>
              : 'No ride goes here yet'}
          </span>
        </div>
      )}

      {notice && <p className="dsc-notice">{notice}</p>}

      <div className="dsc-card-actions">
        {rides.length > 0 ? (
          <button className="dsc-btn dsc-btn-primary" onClick={() => navigate('/ride')} type="button">
            Find a ride
          </button>
        ) : (
          <>
            <button className="dsc-btn dsc-btn-primary" onClick={() => navigate('/ride/publish')} type="button">
              I will drive
            </button>
            <button className="dsc-btn" onClick={notifyMe} type="button">
              Tell me when there is a ride
            </button>
          </>
        )}
      </div>
    </div>
  );
}
