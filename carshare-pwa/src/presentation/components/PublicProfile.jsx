import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ProfileService } from '../../business-logic/ProfileService.js';
import { reputationStanding, REPUTATION_POLICY } from '../../business-logic/ReputationPolicy.js';
import { spokenLanguageLabel } from '../../business-logic/CompatibilityOptions.js';
import {
  FRIENDSHIP_STATUS,
  FriendshipService,
} from '../../business-logic/FriendshipService.js';
import { IdentityVerificationService } from '../../business-logic/IdentityVerificationService.js';
import { sharePublicProfile } from '../../business-logic/ProfileShareService.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { IconArrowLeft, IconCar, IconLeaf, IconMedal, IconMessage, IconShield, IconStar, IconUser, IconUsers } from './icons.jsx';
import { PageShell } from './ui/Primitives.jsx';
import { Button } from './ui/Button.jsx';

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
  const [relationship, setRelationship] = useState(null);
  const [relationshipLoading, setRelationshipLoading] = useState(false);
  const [relationshipError, setRelationshipError] = useState('');
  const [friendsUnavailable, setFriendsUnavailable] = useState(false);
  const [relationshipAction, setRelationshipAction] = useState('');
  const [shareFeedback, setShareFeedback] = useState('');

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

  useEffect(() => {
    let active = true;
    if (!user?.id || user.id === userId) {
      setRelationship(null);
      setRelationshipLoading(false);
      return () => { active = false; };
    }
    setRelationshipLoading(true);
    setRelationshipError('');
    FriendshipService.getRelationship(userId)
      .then((result) => {
        if (!active) return;
        setRelationship(result);
        setFriendsUnavailable(false);
      })
      .catch((loadError) => {
        if (!active) return;
        setFriendsUnavailable(loadError.code === 'FRIENDSHIP_UNAVAILABLE');
        setRelationshipError(loadError.message || 'Unable to load this friendship.');
      })
      .finally(() => active && setRelationshipLoading(false));
    return () => { active = false; };
  }, [user?.id, userId]);

  async function updateRelationship(action) {
    if (!user?.id) {
      navigate('/auth', {
        state: { from: `/users/${userId}`, reason: 'Sign in to send a friend request.' },
      });
      return;
    }
    setRelationshipAction(action);
    setRelationshipError('');
    try {
      let next;
      if (action === 'add') next = await FriendshipService.sendRequest(userId);
      if (action === 'cancel') next = await FriendshipService.cancelRequest(userId);
      if (action === 'accept') next = await FriendshipService.respondToRequest(userId, true);
      if (action === 'decline') next = await FriendshipService.respondToRequest(userId, false);
      if (action === 'message') {
        await IdentityVerificationService.requireVerifiedIdentity(user.id);
        const conversationId = await FriendshipService.openConversation(userId);
        navigate(`/message/${conversationId}`);
        return;
      }
      setRelationship(next);
    } catch (actionError) {
      setRelationshipError(actionError.message || 'Unable to update this friendship.');
    } finally {
      setRelationshipAction('');
    }
  }

  async function shareProfile() {
    setShareFeedback('');
    try {
      const result = await sharePublicProfile({ userId, displayName: profile.displayName });
      if (result.method === 'copied') setShareFeedback('Profile link copied.');
      if (result.method === 'shared') setShareFeedback('Profile shared.');
    } catch (shareError) {
      setShareFeedback(shareError.message || 'Unable to share this profile.');
    }
  }

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
  const isOwnProfile = user?.id === profile.id;
  const relationshipStatus = relationship?.status || FRIENDSHIP_STATUS.NONE;

  function relationshipActions() {
    if (!user) {
      return <Button onClick={() => { void updateRelationship('add'); }}><IconUsers size={16} aria-hidden="true" /> Sign in to add friend</Button>;
    }
    if (relationshipLoading) return <Button loading loadingLabel="Loading friendship" disabled />;
    if (friendsUnavailable) return <Button disabled>Friends unavailable</Button>;
    if (relationshipStatus === FRIENDSHIP_STATUS.OUTGOING_PENDING) {
      return (
        <>
          <Button disabled>Request sent</Button>
          <Button variant="secondary" loading={relationshipAction === 'cancel'} onClick={() => { void updateRelationship('cancel'); }}>Cancel request</Button>
        </>
      );
    }
    if (relationshipStatus === FRIENDSHIP_STATUS.INCOMING_PENDING) {
      return (
        <>
          <Button disabled={Boolean(relationshipAction)} loading={relationshipAction === 'accept'} onClick={() => { void updateRelationship('accept'); }}>Accept</Button>
          <Button variant="secondary" disabled={Boolean(relationshipAction)} loading={relationshipAction === 'decline'} onClick={() => { void updateRelationship('decline'); }}>Decline</Button>
        </>
      );
    }
    if (relationshipStatus === FRIENDSHIP_STATUS.ACCEPTED) {
      return <Button loading={relationshipAction === 'message'} onClick={() => { void updateRelationship('message'); }}><IconMessage size={16} aria-hidden="true" /> Message</Button>;
    }
    return (
      <Button loading={relationshipAction === 'add'} onClick={() => { void updateRelationship('add'); }}>
        <IconUsers size={16} aria-hidden="true" /> {relationshipStatus === FRIENDSHIP_STATUS.REMOVED ? 'Add friend again' : 'Add friend'}
      </Button>
    );
  }

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
        <div className="public-profile-actions">
          {isOwnProfile ? (
            <>
              <Button variant="secondary" onClick={() => { void shareProfile(); }}>Share profile</Button>
              <Link className="btn-secondary public-profile-edit" to="/profile">Manage profile</Link>
            </>
          ) : relationshipActions()}
          {shareFeedback && <small role="status">{shareFeedback}</small>}
          {relationshipError && <small className="public-profile-action-error" role="alert">{relationshipError}</small>}
        </div>
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
