import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { RideService } from '../../../business-logic/RideService.js';
import { IconArrowLeft, IconStar } from '../icons.jsx';
import '../../styles/ride.css';

export default function RateReview() {
  const { rideId } = useParams();
  const navigate = useNavigate();
  const [ride, setRide] = useState(null);
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [review, setReview] = useState('');
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => { RideService.getRide(rideId).then(setRide); }, [rideId]);
  const displayRating = hovered || rating;
  const labels = ['', 'Terrible', 'Poor', 'Average', 'Good', 'Excellent!'];
  function submit() { setSubmitted(true); window.setTimeout(() => navigate('/ride'), 1300); }
  if (submitted) return <main className="review-success"><span>🌿</span><h1>Review submitted!</h1><p>Thank you for helping build trust in the Let’s Tumpang community.</p></main>;
  const host = ride?.host || { fullName: 'Your host' };
  return (
    <main className="phone-ride-page review-page">
      <header className="mobile-page-header"><button className="round-icon-button" onClick={() => navigate(`/ride/${rideId}`)} aria-label="Go back"><IconArrowLeft size={18} /></button><h1>Rate & review</h1></header>
      <div className="review-content">
        <section className="review-host"><span className="host-avatar-large">{host.fullName.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span><h2>{host.fullName}</h2><p>{ride ? `${ride.pickup.split(',')[0]} → ${ride.destination.split(',')[0]}` : 'Your completed ride'}</p><b>Trip completed</b></section>
        <section className="ride-info-card rating-card"><p className="eyebrow">HOW WAS YOUR EXPERIENCE?</p><div className="rating-stars">{[1, 2, 3, 4, 5].map((value) => <button key={value} onClick={() => setRating(value)} onMouseEnter={() => setHovered(value)} onMouseLeave={() => setHovered(0)} aria-label={`${value} stars`}><IconStar size={36} fill={value <= displayRating ? '#f59e0b' : 'none'} /></button>)}</div>{displayRating > 0 && <strong>{labels[displayRating]}</strong>}</section>
        <section className="ride-info-card review-textarea"><label className="eyebrow" htmlFor="review">WRITE A REVIEW <span>(optional)</span></label><textarea id="review" maxLength="500" value={review} onChange={(event) => setReview(event.target.value)} placeholder="Share your experience — was the host punctual? Was the ride comfortable? Would you recommend them?" rows="5" /><small>{review.length}/500</small></section>
        <section className="eco-review-note"><span>🌱</span><div><strong>You saved ~12 kg CO₂</strong><p>by sharing this ride instead of driving solo</p></div></section>
      </div>
      <div className="ride-bottom-actions"><button className="primary-action full" disabled={!rating} onClick={submit}>Submit review</button></div>
    </main>
  );
}
