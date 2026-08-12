import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import { RideService } from '../../../business-logic/RideService.js';
import { RideReviewService } from '../../../business-logic/RideReviewService.js';
import { IconArrowLeft, IconStar } from '../icons.jsx';
import '../../styles/ride.css';

export default function RateReview() {
  const { rideId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [ride, setRide] = useState(null);
  const [targets, setTargets] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [review, setReview] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    setError('');
    try {
      const [nextRide, eligible] = await Promise.all([
        RideService.getRide(rideId),
        RideReviewService.getEligibility(user.id, rideId)
      ]);
      setRide(nextRide);
      setTargets(eligible);
      setSelectedId((current) => current || eligible[0]?.revieweeId || null);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [rideId, user]);

  useEffect(() => { load(); }, [load]);

  const target = targets.find((item) => item.revieweeId === selectedId) || null;
  const displayRating = hovered || rating;
  const labels = ['', 'Terrible', 'Poor', 'Average', 'Good', 'Excellent!'];

  async function submit() {
    setSaving(true);
    setError('');
    try {
      await RideReviewService.submitReview(user.id, { rideId, revieweeId: target.revieweeId, rating, comment: review });
      setRating(0);
      setReview('');
      await load();
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="ride-page-loading">Loading review eligibility…</div>;
  return (
    <main className="phone-ride-page review-page">
      <header className="mobile-page-header"><button className="round-icon-button" onClick={() => navigate(`/ride/${rideId}`)} aria-label="Go back"><IconArrowLeft size={18} /></button><h1>Rate & review</h1></header>
      <div className="review-content">
        {error && <div className="alert alert-error">{error}</div>}
        {targets.length > 1 && <div className="chip-select-row">{targets.map((item) => <button className={`chip-select ${selectedId === item.revieweeId ? 'active' : ''}`} key={item.revieweeId} onClick={() => { setSelectedId(item.revieweeId); setRating(0); setReview(''); }}>{item.revieweeName}</button>)}</div>}
        {!target ? <section className="empty-request-state"><strong>No review available</strong><p>Only the Host and accepted account holders can review one another after a Completed ride.</p></section> : <>
          <section className="review-host"><span className="host-avatar-large">{target.revieweeName.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span><h2>{target.revieweeName}</h2><p>{ride ? `${ride.pickup.split(',')[0]} → ${ride.destination.split(',')[0]}` : 'Your completed ride'}</p><b>{target.reviewerRole} review · Trip completed</b></section>
          {target.existingRating ? <section className="ride-info-card rating-card"><p className="eyebrow">YOUR REVIEW</p><div className="rating-stars">{[1, 2, 3, 4, 5].map((value) => <IconStar key={value} size={30} fill={value <= target.existingRating ? '#f59e0b' : 'none'} />)}</div><strong>{target.existingRating}/5</strong><p>{target.existingComment || 'No written comment'}</p><small>Submitted {new Date(target.reviewedAt).toLocaleDateString()}</small></section> : <>
            <section className="ride-info-card rating-card"><p className="eyebrow">HOW WAS YOUR EXPERIENCE?</p><div className="rating-stars">{[1, 2, 3, 4, 5].map((value) => <button key={value} onClick={() => setRating(value)} onMouseEnter={() => setHovered(value)} onMouseLeave={() => setHovered(0)} aria-label={`${value} stars`}><IconStar size={36} fill={value <= displayRating ? '#f59e0b' : 'none'} /></button>)}</div>{displayRating > 0 && <strong>{labels[displayRating]}</strong>}</section>
            <section className="ride-info-card review-textarea"><label className="eyebrow" htmlFor="review">WRITE A REVIEW <span>(optional)</span></label><textarea id="review" maxLength="500" value={review} onChange={(event) => setReview(event.target.value)} placeholder="Share your experience — punctuality, comfort and trust." rows="5" /><small>{review.length}/500</small></section>
            <section className="eco-review-note"><span>🌱</span><div><strong>Your review helps the community</strong><p>Only the account holder is reviewed; companion names are excluded.</p></div></section>
          </>}
        </>}
      </div>
      {target && !target.existingRating && <div className="ride-bottom-actions"><button className="primary-action full" disabled={!rating || saving} onClick={submit}>{saving ? 'Submitting…' : 'Submit review'}</button></div>}
    </main>
  );
}
