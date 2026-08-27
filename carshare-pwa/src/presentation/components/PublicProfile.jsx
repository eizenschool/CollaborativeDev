import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ProfileService } from '../../business-logic/ProfileService.js';
import { reputationStanding, REPUTATION_POLICY } from '../../business-logic/ReputationPolicy.js';
import { spokenLanguageLabel } from '../../business-logic/CompatibilityOptions.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { IconArrowLeft, IconCar, IconLeaf, IconMedal, IconShield, IconStar, IconUser } from './icons.jsx';
import { PageShell } from './ui/Primitives.jsx';

function initials(name = 'Member') {
  return name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase();
}

export default function PublicProfile() {
  const { userId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    ProfileService.getPublicProfile(userId)
      .then((result) => active && setProfile(result))
      .catch((loadError) => active && setError(loadError.message || 'This profile could not be loaded.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [userId]);

  if (loading) return <main className="public-profile-state" role="status">Loading member profile…</main>;

  if (error || !profile) {
    return (
      <PageShell as="main" className="public-profile-page" size="narrow">
        <section className="public-profile-state" role={error ? 'alert' : undefined}>
          <IconUser size={28} aria-hidden="true" />
          <h1>{error ? 'Profile unavailable' : 'Profile not found'}</h1>
          <p>{error || 'This account is inactive or no longer available.'}</p>
          <button className="btn-secondary" type="button" onClick={() => navigate(-1)}>Go back</button>
        </section>
      </PageShell>
    );
  }

  const provisional = profile.provisional ?? ((profile.completedTrips ?? 0) < REPUTATION_POLICY.minEvidenceRides);
  const standing = reputationStanding(profile.reputationScore, { provisional });
  const joined = profile.createdAt
    ? new Intl.DateTimeFormat('en-MY', { month: 'long', year: 'numeric' }).format(new Date(profile.createdAt))
    : null;

  return (
    <PageShell as="main" className="public-profile-page" size="narrow">
      <button className="public-profile-back" type="button" onClick={() => navigate(-1)}>
        <IconArrowLeft size={17} aria-hidden="true" /> Back
      </button>

      <section className="public-profile-hero" aria-labelledby="public-profile-name">
        <div
          className="public-profile-avatar"
          style={profile.profilePhotoUrl ? { backgroundImage: `url(${profile.profilePhotoUrl})` } : undefined}
          role={profile.profilePhotoUrl ? 'img' : undefined}
          aria-label={profile.profilePhotoUrl ? `${profile.displayName}'s profile photo` : undefined}
        >
          {!profile.profilePhotoUrl && initials(profile.displayName)}
        </div>
        <div className="public-profile-identity">
          <p className="eyebrow">LET&apos;S TUMPANG MEMBER</p>
          <h1 id="public-profile-name">{profile.displayName}</h1>
          <p>{joined ? `Member since ${joined}` : 'Community member'}</p>
          <div className="public-profile-badges">
            <span className={`reputation-standing standing-${standing.key}`}><IconShield size={13} />{standing.label}</span>
            {profile.rating != null && <span><IconStar size={13} />{profile.rating.toFixed(1)} from {profile.reviewCount} review{profile.reviewCount === 1 ? '' : 's'}</span>}
          </div>
        </div>
        {user?.id === profile.id && <Link className="btn-secondary public-profile-edit" to="/profile">Manage profile</Link>}
      </section>

      <section className="public-profile-grid" aria-label="Member trust summary">
        <article className="card public-profile-stat">
          <IconMedal size={18} aria-hidden="true" />
          <strong>{provisional ? 'New' : profile.reputationScore}</strong>
          <span>{provisional ? 'Building reputation' : 'Reputation / 100'}</span>
        </article>
        {profile.completedTrips != null && (
          <article className="card public-profile-stat">
            <IconCar size={18} aria-hidden="true" />
            <strong>{profile.completedTrips}</strong>
            <span>Completed trips</span>
          </article>
        )}
        {profile.co2SavedKg != null && (
          <article className="card public-profile-stat">
            <IconLeaf size={18} aria-hidden="true" />
            <strong>{profile.co2SavedKg}</strong>
            <span>CO₂ saved (kg)</span>
          </article>
        )}
      </section>

      {profile.spokenLanguages.length > 0 && (
        <section className="card public-profile-section">
          <h2>Spoken languages</h2>
          <div className="public-profile-languages">
            {profile.spokenLanguages.map((language) => <span key={language}>{spokenLanguageLabel(language)}</span>)}
          </div>
        </section>
      )}

      <section className="card public-profile-section">
        <h2>How reputation works</h2>
        <p>Only verified ride outcomes, participant reviews, cancellations, no-shows, and confirmed conduct decisions change this standing. Opening the app or editing a profile does not award trust points.</p>
      </section>
    </PageShell>
  );
}
