import { useCallback, useEffect, useState } from 'react';
import { RideLiveTrackingService } from '../../../business-logic/RideLiveTrackingService.js';
import LiveRideMap from '../maps/LiveRideMap.jsx';

const GAP_LIMIT_MS = 2 * 60 * 1000;
export const HISTORY_PAGE_SIZE = 500;

function timestamp(point) {
  const value = new Date(point?.capturedAt || 0).getTime();
  return Number.isFinite(value) ? value : 0;
}

export function buildReplay(points, selectedAt) {
  const visible = points.filter((point) => timestamp(point) <= selectedAt);
  const latestByUser = new Map();
  const groups = new Map();
  visible.forEach((point) => {
    const userId = point.userId || point.role || 'participant';
    latestByUser.set(userId, point);
    if (!groups.has(userId)) groups.set(userId, []);
    groups.get(userId).push(point);
  });
  const segments = [];
  groups.forEach((userPoints, userId) => {
    let current = [];
    userPoints.sort((a, b) => timestamp(a) - timestamp(b)).forEach((point, index) => {
      if (index > 0 && timestamp(point) - timestamp(userPoints[index - 1]) > GAP_LIMIT_MS) {
        if (current.length > 1) segments.push({ id: `${userId}-${segments.length}`, userId, role: point.role, points: current });
        current = [];
      }
      current.push(point);
    });
    if (current.length > 1) segments.push({ id: `${userId}-${segments.length}`, userId, role: current[0].role, points: current });
  });
  return { visible, latest: [...latestByUser.values()], segments };
}

function mergeHistory(current, incoming) {
  const merged = new Map();
  [...current, ...incoming].forEach((point) => {
    const key = `${point.userId || point.role}:${point.capturedAt}:${point.lat}:${point.lng}`;
    merged.set(key, point);
  });
  return [...merged.values()].sort((left, right) => timestamp(left) - timestamp(right));
}

function participantLabels(points) {
  const users = [...new Map(points.map((point) => [point.userId || point.role, point])).values()];
  let passengerNumber = 0;
  return users.map((point) => {
    if (point.role === 'Driver') return 'Driver';
    passengerNumber += 1;
    return `Passenger ${passengerNumber}`;
  });
}

export default function TripRouteReplay({ trip }) {
  const [points, setPoints] = useState([]);
  const [state, setState] = useState('loading');
  const [message, setMessage] = useState('');
  const [hidden, setHidden] = useState(false);
  const [selectedAt, setSelectedAt] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageSessionId] = useState(() => globalThis.crypto?.randomUUID?.() || `history-${Date.now()}`);

  const loadPage = useCallback(async ({ after = null, replace = false } = {}) => {
    const rows = await RideLiveTrackingService.getHistory(trip.id, { after, limit: HISTORY_PAGE_SIZE });
    setPoints((current) => replace ? rows : mergeHistory(current, rows));
    setSelectedAt((current) => rows.reduce((latest, point) => Math.max(latest, timestamp(point)), replace ? 0 : (current || 0)));
    setHasMore(rows.length === HISTORY_PAGE_SIZE);
    return rows;
  }, [trip.id]);

  useEffect(() => {
    let active = true;
    setState('loading');
    RideLiveTrackingService.getHistory(trip.id, { limit: HISTORY_PAGE_SIZE })
      .then((rows) => {
        if (!active) return;
        setPoints(rows);
        setSelectedAt(rows.reduce((latest, point) => Math.max(latest, timestamp(point)), 0));
        setHasMore(rows.length === HISTORY_PAGE_SIZE);
        setState('ready');
      })
      .catch((error) => { if (active) { setMessage(error.message); setState('error'); } });
    return () => { active = false; };
  }, [trip.id]);

  async function hideMine() {
    try {
      await RideLiveTrackingService.hideMyHistory(trip.id);
      setHidden(true);
      await loadPage({ replace: true });
      setMessage('Your own route is hidden from your playback. Other ride participants retain their view until retention expires.');
    } catch (error) { setMessage(error.message); }
  }

  async function loadMore() {
    const cursor = points.at(-1)?.capturedAt;
    if (!cursor) return;
    setLoadingMore(true);
    setMessage('');
    try {
      await loadPage({ after: cursor });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoadingMore(false);
    }
  }

  const times = points.map(timestamp).filter(Boolean);
  const firstAt = times.length ? Math.min(...times) : 0;
  const lastAt = times.length ? Math.max(...times) : 0;
  const replayAt = selectedAt == null ? lastAt : Math.min(lastAt, Math.max(firstAt, selectedAt));
  const replay = buildReplay(points, replayAt);
  const roleLabels = participantLabels(replay.visible);
  const latestAccuracy = replay.latest.length ? Math.max(...replay.latest.map((point) => Number(point.accuracyM) || 0)) : 0;

  return <section className="m5-card trip-route-replay" style={{ padding: 20, marginBottom: 16 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start' }}><div><h3 style={{ margin: 0 }}>Shared route history</h3><p style={{ color: '#64748b', fontSize: 13 }}>Only participants can view opted-in tracks. Family links never include history.</p></div>{!hidden && <button type="button" className="m5-chip" onClick={hideMine}>Hide my route</button>}</div>
    {state === 'loading' && <p>Loading opted-in location history…</p>}
    {state === 'error' && <p role="alert">{message}</p>}
    {state === 'ready' && !points.length && <p>No participant opted into location history for this ride.</p>}
    {state === 'ready' && points.length > 0 && <>
      <LiveRideMap ride={trip} points={replay.latest} segments={replay.segments} pageSessionId={pageSessionId} />
      <div className="trip-replay-controls">
        <label htmlFor="trip-replay-time">Playback time</label>
        <input id="trip-replay-time" type="range" min={firstAt} max={lastAt || firstAt + 1} step="1000" value={replayAt} onChange={(event) => setSelectedAt(Number(event.target.value))} disabled={firstAt === lastAt} />
        <time dateTime={new Date(replayAt || Date.now()).toISOString()}>{replayAt ? new Date(replayAt).toLocaleString() : 'No timestamp'}</time>
      </div>
      <div className="trip-replay-meta"><span>Participants: {roleLabels.join(', ') || 'None'}</span><span>Latest accuracy: ±{Math.round(latestAccuracy)} m</span><span>{replay.segments.length} route segment{replay.segments.length === 1 ? '' : 's'} · gaps over 2 minutes are split</span></div>
      {hasMore && <button type="button" className="m5-chip" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Loading more…' : 'Load more route history'}</button>}
    </>}
    {message && state !== 'error' && <p role="status" style={{ color: '#0f766e', fontSize: 12 }}>{message}</p>}
  </section>;
}
