// ===== PRESENTATION LAYER (Leaderboard) =====
// Module 5, Screen 5 - FR-5.10 / FR-5.11 (UC5.10, UC5.11)
//
// Deliberately the one screen in the module that does not wear the app's green:
// a ranking should read as a contest, not as another report. The dark arena
// panel and the gold/silver/bronze podium carry that on their own.
//
// All three podium places are always drawn, even when nobody has claimed them.
// An empty plinth is an honest statement about a contest with room in it, and
// each is labelled "Open" so it can never be read as a competitor.
import React, { useEffect, useState } from 'react';
import { TripHistoryEngine } from '../../../business-logic/TripHistoryEngine.js';
import { COLORS, TIER_COLORS } from './tripTheme.js';
import { IconCrownSmall, IconSparkSmall, IconTrophySmall } from './tripIcons.jsx';
import { ErrorState } from './tripStates.jsx';
import MonthStepper, { MONTH_NAMES } from './MonthStepper.jsx';

// Deterministic gradient per host, purely cosmetic - the same host always gets
// the same colour without needing a photo.
const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #34D399, #059669)',
  'linear-gradient(135deg, #60A5FA, #7C3AED)',
  'linear-gradient(135deg, #FBBF24, #EF4444)',
  'linear-gradient(135deg, #22D3EE, #2563EB)',
  'linear-gradient(135deg, #F472B6, #F59E0B)'
];

function gradientFor(name) {
  const hash = (name || '?').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length];
}

// Podium order is 2 - 1 - 3, so first place stands in the middle.
const BOARD_SIZE = 10;

const PLACES = [
  { rank: 2, height: 96, tone: 'silver' },
  { rank: 1, height: 132, tone: 'gold' },
  { rank: 3, height: 72, tone: 'bronze' }
];

export default function Leaderboard({ userId }) {
  const now = new Date();
  const [period, setPeriod] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const [state, setState] = useState({ phase: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;
    if (!userId) return;
    setState({ phase: 'loading' });
    TripHistoryEngine.getLeaderboard(userId, period.year, period.month)
      .then((data) => {
        if (active) setState({ phase: 'ready', board: data });
      })
      .catch((error) => {
        if (active) setState({ phase: 'error', message: error.message });
      });
    return () => {
      active = false;
    };
  }, [userId, period.year, period.month, reloadToken]);

  // Kept outside the phase branches: paging months must not make the control
  // vanish under the reader's cursor while the next month loads.
  const header = (
    <div className="m5-lb-header">
      <p className="m5-lb-eyebrow"><IconSparkSmall size={13} /> Season standings</p>
      <h2>Community Leaderboard</h2>
      <MonthStepper
        year={period.year}
        month={period.month}
        onChange={(y, m) => setPeriod({ year: y, month: m })}
      />
    </div>
  );

  if (state.phase === 'error') {
    return (
      <div className="m5-lb">
        {header}
        <ErrorState message={state.message} onRetry={() => setReloadToken((n) => n + 1)} />
      </div>
    );
  }

  if (state.phase === 'loading') {
    return (
      <div className="m5-lb">
        {header}
        <p style={{ textAlign: 'center', color: COLORS.textSecondary, fontFamily: 'Inter, sans-serif' }}>
          Loading leaderboard…
        </p>
      </div>
    );
  }

  const { month, entries } = state.board;
  const podium = PLACES.map((place) => ({ ...place, entry: entries[place.rank - 1] || null }));
  // Ranks 4..BOARD_SIZE, filled where someone holds them and left open where
  // nobody does.
  const ladder = Array.from({ length: BOARD_SIZE - 3 }, (_, index) => {
    const rank = index + 4;
    return { rank, entry: entries[rank - 1] || null };
  });
  const you = entries.find((entry) => entry.isCurrentUser);
  const openPlaces = 3 - Math.min(3, entries.length);

  return (
    <div className="m5-lb">
      {header}

      <div className="m5-arena">
        <p className="m5-arena-caption">
          {entries.length === 0
            ? `No host has completed a trip in ${MONTH_NAMES[month]} yet - all three places are open.`
            : `${entries.length} host${entries.length === 1 ? '' : 's'} ranked` +
              (openPlaces > 0
                ? ` · ${openPlaces} podium place${openPlaces === 1 ? '' : 's'} still open`
                : ' · podium complete')}
        </p>

        <div className="m5-podium">
          {podium.map((place) => <PodiumPlace key={place.rank} {...place} />)}
        </div>
      </div>

      <div className="m5-lb-list">
        <p className="m5-lb-list-title">
          Chasing the podium
          <span>Places 4-{BOARD_SIZE}</span>
        </p>
        {ladder.map(({ rank, entry }) => (
          entry
            ? <RankRow key={entry.id} entry={entry} />
            : <OpenRow key={rank} rank={rank} />
        ))}
      </div>

      {you && (
        <div className="m5-lb-you">
          <span className="m5-lb-you-rank">#{you.rank}</span>
          <div className="m5-lb-you-body">
            <p className="m5-lb-you-name">Your position</p>
            <p className="m5-lb-you-meta">
              {you.badge?.name} · {you.compositeScore} pts
              {entries.length > 1 ? ` · of ${entries.length} ranked` : ''}
            </p>
          </div>
          <IconTrophySmall size={20} />
        </div>
      )}

      <p className="m5-lb-footnote">
        Ranked by Composite Host Impact Score - the same figure shown on a host's profile.
      </p>
    </div>
  );
}

function PodiumPlace({ rank, height, tone, entry }) {
  const open = !entry;
  return (
    <div className={`m5-place ${tone}` + (open ? ' open' : '')}>
      <div className="m5-place-who">
        {rank === 1 && !open && <span className="m5-place-crown"><IconCrownSmall size={20} /></span>}

        <div className="m5-place-avatar" style={open ? undefined : { background: gradientFor(entry.name) }}>
          {open ? '?' : entry.name?.[0] || '?'}
        </div>

        <p className="m5-place-name">{open ? 'Open' : entry.name}</p>
        <p className="m5-place-tier" style={open ? undefined : { color: TIER_COLORS[entry.badge?.name] }}>
          {open ? 'Unclaimed' : entry.badge?.name}
        </p>
      </div>

      <div className="m5-place-block" style={{ height }}>
        <span className="m5-place-rank">{rank}</span>
        <span className="m5-place-score">{open ? '—' : `${entry.compositeScore} pts`}</span>
      </div>
    </div>
  );
}

// An unclaimed rank: the number, and nothing pretending to be a competitor.
function OpenRow({ rank }) {
  return (
    <div className="m5-rank-row open" aria-label={`Rank ${rank}, unclaimed`}>
      <span className="m5-rank-num">{rank}</span>
      <div className="m5-rank-avatar open" aria-hidden="true" />
      <div className="m5-rank-body">
        <p className="m5-rank-name">Open</p>
      </div>
      <span className="m5-rank-score">—</span>
    </div>
  );
}

function RankRow({ entry }) {
  return (
    <div className={'m5-rank-row' + (entry.isCurrentUser ? ' you' : '')}>
      <span className="m5-rank-num">{entry.rank}</span>
      <div className="m5-rank-avatar" style={{ background: gradientFor(entry.name) }}>
        {entry.name?.[0] || '?'}
      </div>
      <div className="m5-rank-body">
        <p className="m5-rank-name">
          {entry.name}{entry.isCurrentUser && <span> (You)</span>}
        </p>
        <p className="m5-rank-tier" style={{ color: TIER_COLORS[entry.badge?.name] }}>{entry.badge?.name}</p>
      </div>
      <span className="m5-rank-score">{entry.compositeScore} pts</span>
    </div>
  );
}
