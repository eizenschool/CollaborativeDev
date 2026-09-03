import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  FriendshipService,
  groupFriendConnections,
} from '../../../business-logic/FriendshipService.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import {
  IconArrowLeft,
  IconCheck,
  IconMessage,
  IconTrash,
  IconUsers,
  IconX,
} from '../icons.jsx';
import AdaptiveDialog from '../ui/AdaptiveDialog.jsx';
import { Button } from '../ui/Button.jsx';
import '../../styles/message.css';

function initials(name = 'Member') {
  return name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase();
}

function FriendAvatar({ person }) {
  if (person.profilePhotoUrl) {
    return <img className="friend-center-avatar" src={person.profilePhotoUrl} alt={person.displayName} />;
  }
  return <span className="friend-center-avatar friend-center-avatar-fallback" aria-hidden="true">{initials(person.displayName)}</span>;
}

function requestDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-MY', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
}

function ConnectionRow({ connection, kind, pendingAction, onAction }) {
  const person = connection.otherUser;
  const busy = Boolean(pendingAction);
  return (
    <article className="friend-center-row">
      <Link className="friend-center-person" to={`/users/${person.id}`}>
        <FriendAvatar person={person} />
        <span>
          <strong>{person.displayName}</strong>
          <small>
            {kind === 'incoming' && `Requested ${requestDate(connection.requestedAt)}`}
            {kind === 'sent' && `Sent ${requestDate(connection.requestedAt)}`}
            {kind === 'friend' && 'Friend chat never expires'}
          </small>
        </span>
      </Link>
      <div className="friend-center-row-actions">
        <Link className="friend-center-profile-action" to={`/users/${person.id}`}>View profile</Link>
        {kind === 'incoming' && (
          <>
            <Button size="small" disabled={busy} loading={pendingAction === `accept:${person.id}`} onClick={() => onAction('accept', connection)}>
              <IconCheck size={15} aria-hidden="true" /> Accept
            </Button>
            <Button size="small" variant="secondary" disabled={busy} loading={pendingAction === `decline:${person.id}`} onClick={() => onAction('decline', connection)}>
              <IconX size={15} aria-hidden="true" /> Decline
            </Button>
          </>
        )}
        {kind === 'friend' && (
          <>
            <Button size="small" disabled={busy} loading={pendingAction === `message:${person.id}`} onClick={() => onAction('message', connection)}>
              <IconMessage size={15} aria-hidden="true" /> Message
            </Button>
            <Button size="small" variant="secondary" disabled={busy} onClick={() => onAction('remove', connection)}>
              Remove
            </Button>
          </>
        )}
        {kind === 'sent' && (
          <Button size="small" variant="secondary" disabled={busy} loading={pendingAction === `cancel:${person.id}`} onClick={() => onAction('cancel', connection)}>
            Cancel request
          </Button>
        )}
      </div>
    </article>
  );
}

function FriendSection({ title, count, emptyText, children }) {
  return (
    <section className="friend-center-section" aria-labelledby={`friend-section-${title.replace(/\s+/g, '-').toLowerCase()}`}>
      <header>
        <h2 id={`friend-section-${title.replace(/\s+/g, '-').toLowerCase()}`}>{title}</h2>
        <span>{count}</span>
      </header>
      {count ? children : <p className="friend-center-empty">{emptyText}</p>}
    </section>
  );
}

export default function FriendCenter() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const [pendingAction, setPendingAction] = useState('');
  const [removeTarget, setRemoveTarget] = useState(null);
  const removeTriggerRef = useRef(null);

  const refresh = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const next = await FriendshipService.listConnections();
      setConnections(next);
      setUnavailable(false);
    } catch (loadError) {
      setUnavailable(loadError.code === 'FRIENDSHIP_UNAVAILABLE');
      setError(loadError.message || 'Unable to load friends.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let timerId = null;
    void refresh();
    const unsubscribe = FriendshipService.subscribe(() => {
      window.clearTimeout(timerId);
      timerId = window.setTimeout(() => { void refresh({ silent: true }); }, 80);
    });
    return () => {
      window.clearTimeout(timerId);
      unsubscribe();
    };
  }, [refresh]);

  async function runAction(action, connection) {
    const otherUserId = connection.otherUser.id;
    if (action === 'remove') {
      removeTriggerRef.current = document.activeElement;
      setRemoveTarget(connection);
      return;
    }
    setPendingAction(`${action}:${otherUserId}`);
    setError('');
    try {
      if (action === 'accept') await FriendshipService.respondToRequest(otherUserId, true);
      if (action === 'decline') await FriendshipService.respondToRequest(otherUserId, false);
      if (action === 'cancel') await FriendshipService.cancelRequest(otherUserId);
      if (action === 'message') {
        const conversationId = await FriendshipService.openConversation(otherUserId);
        navigate(`/message/${conversationId}`);
        return;
      }
      await refresh({ silent: true });
    } catch (actionError) {
      setError(actionError.message || 'Unable to update this friendship.');
    } finally {
      setPendingAction('');
    }
  }

  async function confirmRemove() {
    if (!removeTarget) return;
    const otherUserId = removeTarget.otherUser.id;
    setPendingAction(`remove:${otherUserId}`);
    setError('');
    try {
      await FriendshipService.removeFriend(otherUserId);
      setRemoveTarget(null);
      await refresh({ silent: true });
    } catch (removeError) {
      setError(removeError.message || 'Unable to remove this friend.');
    } finally {
      setPendingAction('');
    }
  }

  const groups = groupFriendConnections(connections);

  return (
    <main className="friend-center-page">
      <header className="friend-center-header">
        <button type="button" className="friend-center-back" onClick={() => navigate('/message')}>
          <IconArrowLeft size={18} aria-hidden="true" /> Messages
        </button>
        <div className="friend-center-heading">
          <span><IconUsers size={22} aria-hidden="true" /></span>
          <div>
            <h1>Friends</h1>
            <p>Requests and permanent private chats</p>
          </div>
        </div>
      </header>

      <div className="friend-center-content" aria-busy={loading}>
        {error && (
          <div className={`message-inline-error ${unavailable ? 'friend-center-unavailable' : ''}`} role="alert">
            <p>{error}</p>
            {!unavailable && <button type="button" onClick={() => { void refresh(); }}>Try again</button>}
          </div>
        )}
        {loading ? (
          <div className="friend-center-loading" role="status">Loading friends…</div>
        ) : !unavailable && (
          <>
            <FriendSection title="Incoming requests" count={groups.incoming.length} emptyText="No friend requests are waiting for you.">
              {groups.incoming.map((connection) => <ConnectionRow key={connection.id} connection={connection} kind="incoming" pendingAction={pendingAction} onAction={runAction} />)}
            </FriendSection>
            <FriendSection title="Friends" count={groups.friends.length} emptyText="Share your public profile link to connect with someone you know.">
              {groups.friends.map((connection) => <ConnectionRow key={connection.id} connection={connection} kind="friend" pendingAction={pendingAction} onAction={runAction} />)}
            </FriendSection>
            <FriendSection title="Sent requests" count={groups.sent.length} emptyText="You have no pending sent requests.">
              {groups.sent.map((connection) => <ConnectionRow key={connection.id} connection={connection} kind="sent" pendingAction={pendingAction} onAction={runAction} />)}
            </FriendSection>
            <aside className="friend-center-discovery-note">
              <IconUsers size={18} aria-hidden="true" />
              <div>
                <strong>No public member search</strong>
                <p>For privacy, add people from a public profile or share <Link to={`/users/${user.id}`}>your profile link</Link>.</p>
              </div>
            </aside>
          </>
        )}
      </div>

      <AdaptiveDialog
        open={Boolean(removeTarget)}
        onClose={() => { if (!pendingAction) setRemoveTarget(null); }}
        title="Remove friend?"
        description={removeTarget ? `Your chat with ${removeTarget.otherUser.displayName} will remain in Messages as read-only.` : ''}
        triggerRef={removeTriggerRef}
        footer={(
          <>
            <Button variant="secondary" disabled={Boolean(pendingAction)} onClick={() => setRemoveTarget(null)}>Keep friend</Button>
            <Button variant="danger" loading={pendingAction?.startsWith('remove:')} loadingLabel="Removing" onClick={() => { void confirmRemove(); }}>
              <IconTrash size={16} aria-hidden="true" /> Remove friend
            </Button>
          </>
        )}
      >
        <p>You will both lose the ability to send messages or make calls until a new friend request is accepted. Existing history is not deleted.</p>
        {error && <p className="message-composer-error" role="alert">{error}</p>}
      </AdaptiveDialog>
    </main>
  );
}
