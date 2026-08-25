// ===== PRESENTATION LAYER (RideHub) =====
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import { RideService } from '../../../business-logic/RideService.js';
import { RideRequestService } from '../../../business-logic/RideRequestService.js';
import { RideReviewService } from '../../../business-logic/RideReviewService.js';
import { compareJourneyStates, formatJourneyCountdown, getRideJourneyState, journeyGroup } from '../../../business-logic/rideJourneyState.js';
import RideCard from './RideCard.jsx';
import { IconPlus, IconSearch, IconTrash, IconUsers } from '../icons.jsx';
import AdaptiveDialog from '../ui/AdaptiveDialog.jsx';
import { Button } from '../ui/Button.jsx';
import '../../styles/ride.css';

const HISTORY_PHASES = new Set(['completed', 'terminal']);

function compareWorkspaceDeparture(left, right) {
  const leftHistory = HISTORY_PHASES.has(left.state.phase);
  const rightHistory = HISTORY_PHASES.has(right.state.phase);
  if (leftHistory !== rightHistory) return leftHistory ? 1 : -1;
  const difference = new Date(left.ride.departureAt).getTime() - new Date(right.ride.departureAt).getTime();
  return leftHistory ? -difference : difference;
}

function WorkspaceGroup({ groupKey, eyebrow, title, items, now, collapsible = false, onOpenItem, onDeleteDraft }) {
  if (!items.length) return null;

  const heading = <div className="ride-hub-header"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div><span>{items.length}</span></div>;
  const cards = <div className={`ride-grid ride-grid-${groupKey}`}>{items.map((item) => <div className="ride-journey-card-wrap" key={`${item.state.role}-${item.request?.id || 'host'}-${item.ride.id}`}><RideCard ride={item.ride} statusChip roleLabel={item.state.role === 'driver' ? 'Driver' : 'Passenger'} journeyState={item.state} compact now={now} onClick={() => onOpenItem(item)} />{item.state.phase === 'draft' && <button type="button" className="ride-draft-delete" onClick={() => onDeleteDraft(item.ride)}><IconTrash size={14} /> Delete draft</button>}</div>)}</div>;

  if (!collapsible) return <section className={`ride-journey-group ride-journey-group-${groupKey}`} aria-labelledby={`ride-${groupKey}-heading`}><div id={`ride-${groupKey}-heading`}>{heading}</div>{cards}</section>;
  return <details className={`ride-journey-group ride-journey-group-${groupKey} ride-history-group`}><summary aria-labelledby={`ride-${groupKey}-heading`}><span id={`ride-${groupKey}-heading`}>{heading}</span></summary>{cards}</details>;
}

export default function RideHub() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [workspace, setWorkspace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draftToDelete, setDraftToDelete] = useState(null);
  const [deletingDraft, setDeletingDraft] = useState(false);
  const [clock, setClock] = useState(() => new Date());

  const loadWorkspace = useCallback(async ({ silent = false } = {}) => {
    if (!user) return;
    if (!silent) setLoading(true);
    setError('');
    try {
      const [rides, passengerRequests] = await Promise.all([RideService.listMyRides(user.id), RideRequestService.listMyRequests(user.id)]);
      const hosting = rides.hosting || [];
      const activeHosted = hosting.filter((ride) => !['Draft', 'Completed', 'Cancelled', 'Expired'].includes(ride.status));
      const requestPairs = await Promise.all(activeHosted.map(async (ride) => {
        try { return [ride.id, await RideRequestService.listRideRequests(ride.id)]; }
        catch { return [ride.id, []]; }
      }));
      const completedRideIds = [...new Set([
        ...hosting.filter((ride) => ride.status === 'Completed').map((ride) => ride.id),
        ...passengerRequests.filter((request) => request.ride?.status === 'Completed').map((request) => request.ride.id)
      ])];
      const reviewPairs = await Promise.all(completedRideIds.map(async (rideId) => {
        try { return [rideId, await RideReviewService.getEligibility(user.id, rideId)]; }
        catch { return [rideId, null]; }
      }));
      setWorkspace({ hosting, passengerRequests, requestsByRide: Object.fromEntries(requestPairs), reviewsByRide: Object.fromEntries(reviewPairs) });
    } catch (loadError) {
      setError(loadError.message || 'Unable to load your rides.');
    } finally { setLoading(false); }
  }, [user]);

  useEffect(() => { loadWorkspace(); }, [loadWorkspace]);
  useEffect(() => {
    const refreshVisible = () => {
      setClock(new Date());
      if (document.visibilityState === 'visible') loadWorkspace({ silent: true });
    };
    const timer = window.setInterval(() => setClock(new Date()), 1000);
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [loadWorkspace]);

  const driverItems = useMemo(() => (workspace?.hosting || []).map((ride) => ({
    ride, state: getRideJourneyState({ ride, role: 'driver', requests: workspace?.requestsByRide?.[ride.id] || [], reviewEligibility: workspace?.reviewsByRide?.[ride.id] ?? null, now: clock })
  })).sort(compareJourneyStates), [clock, workspace]);
  const passengerItems = useMemo(() => (workspace?.passengerRequests || []).filter((request) => request.ride).map((request) => ({
    ride: request.ride, request, state: getRideJourneyState({ ride: request.ride, role: 'passenger', request, reviewEligibility: workspace?.reviewsByRide?.[request.ride.id] ?? null, now: clock })
  })).sort(compareJourneyStates), [clock, workspace]);

  const priorityItems = useMemo(() => [...driverItems, ...passengerItems].sort(compareJourneyStates), [driverItems, passengerItems]);
  const items = useMemo(() => [...driverItems, ...passengerItems], [driverItems, passengerItems]);
  const groupedItems = useMemo(() => {
    const groups = { attention: [], upcoming: [], drafts: [], history: [] };
    items.forEach((item) => groups[journeyGroup(item.state)].push(item));
    groups.attention.sort(compareJourneyStates);
    groups.upcoming.sort(compareJourneyStates);
    groups.drafts.sort(compareJourneyStates);
    groups.history.sort(compareWorkspaceDeparture);
    return groups;
  }, [items]);
  const nextItem = priorityItems.find((item) => !HISTORY_PHASES.has(item.state.phase)) || priorityItems[0] || null;

  function openItem(item) {
    navigate(item.state.nextAction.path || `/ride/${item.ride.id}`, { state: { returnTo: '/ride' } });
  }

  async function deleteDraft() {
    if (!draftToDelete) return;
    setDeletingDraft(true);
    setError('');
    try {
      await RideService.deleteDraft(draftToDelete.id);
      setDraftToDelete(null);
      await loadWorkspace();
    } catch (deleteError) { setError(deleteError.message || 'Unable to delete this draft.'); }
    finally { setDeletingDraft(false); }
  }

  return (
    <main className="ride-hub ride-management-hub">
      <header className="ride-workspace-header"><div><p className="ride-workspace-kicker">Ride workspace</p><h1>My rides</h1><p>See what needs your attention first.</p></div><div className="ride-workspace-actions"><button className="btn-primary" type="button" onClick={() => navigate('/ride/publish')}><IconPlus size={17} /> Publish ride</button><button className="btn-secondary" type="button" onClick={() => navigate('/ride/requests')}><IconUsers size={17} /> Requests</button></div></header>

      <section className="ride-hub-right" aria-busy={loading}>
        {error && <div className="alert alert-error ride-management-error" role="alert"><span>{error}</span><button type="button" className="btn-link" onClick={loadWorkspace}>Retry</button></div>}
        {loading && <div className="ride-page-loading compact" role="status">Loading your ride workspace…</div>}
        {!loading && !error && workspace && <>
          {nextItem ? <section className={`ride-next-action urgency-${nextItem.state.urgency}`} aria-labelledby="ride-next-action-title"><div><p className="eyebrow">YOUR NEXT STEP</p><h2 id="ride-next-action-title">{nextItem.state.title}</h2><p>{nextItem.state.description}</p><div className="ride-next-action-meta"><span><small>Your role</small><b>{nextItem.state.role === 'driver' ? 'Driver' : 'Passenger'}</b></span><span><small>Timing</small><b>{nextItem.state.countdownAt ? formatJourneyCountdown(nextItem.state.countdownAt, clock, nextItem.state.countdownKind) : 'When you are ready'}</b></span><span><small>Responsible</small><b>You</b></span></div></div><button type="button" className="btn-primary" onClick={() => openItem(nextItem)}>{nextItem.state.nextAction.label}</button></section>
            : <section className="ride-empty-state compact"><IconSearch size={24} /><h3>No rides yet</h3><p>Publish a ride or use Search to request your first journey.</p><button className="btn-secondary" type="button" onClick={() => navigate('/search')}>Find rides</button></section>}
          {items.length > 0 && <div className="ride-inbox-groups"><WorkspaceGroup groupKey="attention" eyebrow="Next actions" title="Needs attention" items={groupedItems.attention} now={clock} onOpenItem={openItem} onDeleteDraft={setDraftToDelete} /><WorkspaceGroup groupKey="upcoming" eyebrow="Upcoming" title="Scheduled rides" items={groupedItems.upcoming} now={clock} onOpenItem={openItem} onDeleteDraft={setDraftToDelete} /><WorkspaceGroup groupKey="drafts" eyebrow="Drafts" title="Finish publishing" items={groupedItems.drafts} now={clock} onOpenItem={openItem} onDeleteDraft={setDraftToDelete} /><WorkspaceGroup groupKey="history" eyebrow="History" title="Past rides and requests" items={groupedItems.history} now={clock} collapsible onOpenItem={openItem} onDeleteDraft={setDraftToDelete} /></div>}
        </>}
      </section>

      <AdaptiveDialog
        open={Boolean(draftToDelete)}
        onClose={() => { if (!deletingDraft) setDraftToDelete(null); }}
        title="Delete this draft?"
        description="This unpublished ride cannot be recovered after deletion."
        footer={(
          <>
            <Button variant="secondary" disabled={deletingDraft} onClick={() => setDraftToDelete(null)}>Keep draft</Button>
            <Button variant="danger" loading={deletingDraft} loadingLabel="Deleting" onClick={deleteDraft}>Delete draft</Button>
          </>
        )}
      >
        <p className="ride-dialog-note">Only this draft will be removed. Your published and completed rides are not affected.</p>
      </AdaptiveDialog>
    </main>
  );
}
