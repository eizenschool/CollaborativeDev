// ===== PRESENTATION LAYER (Leaderboard) =====
// Module 5, Screen 5 - FR-5.10 / FR-5.11 (UC5.10, UC5.11)
import React, { useEffect, useState } from 'react';
import { TripHistoryEngine } from '../../../business-logic/TripHistoryEngine.js';
import { COLORS, TIER_COLORS } from './tripTheme.js';
import { IconTrophySmall } from './tripIcons.jsx';
import { ErrorState } from './tripStates.jsx';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

// Deterministic gradient per host, purely cosmetic (podium/list avatars) -
// picks from a small fixed palette based on the name, so the same host
// always gets the same color without needing a photo.
const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #16A34A, #0D9488)',
  'linear-gradient(135deg, #3B82F6, #7C3AED)',
  'linear-gradient(135deg, #F59E0B, #EF4444)',
  'linear-gradient(135deg, #0EA5E9, #16A34A)',
  'linear-gradient(135deg, #EC4899, #F59E0B)'
];

function gradientFor(name) {
  const hash = (name || '?').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length];
}

export default function Leaderboard({ userId }) {
  const [state, setState] = useState({ phase: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;
    if (!userId) return;
    setState({ phase: 'loading' });
    TripHistoryEngine.getLeaderboard(userId)
      .then((data) => {
        if (active) setState({ phase: 'ready', board: data });
      })
      .catch((error) => {
        if (active) setState({ phase: 'error', message: error.message });
      });
    return () => {
      active = false;
    };
  }, [userId, reloadToken]);

  if (state.phase === 'error') {
    return <ErrorState message={state.message} onRetry={() => setReloadToken((n) => n + 1)} />;
  }

  if (state.phase === 'loading') {
    return <p style={{ color: COLORS.textSecondary, fontFamily: 'Inter, sans-serif' }}>Loading leaderboard…</p>;
  }

  // The heading used to print today's month while getLeaderboard() ranked
  // all-time scores. Both now describe the same period the engine queried.
  const { year, month, entries } = state.board;

  if (entries.length === 0) {
    return (
      <div className="m5-card m5-empty">
        <p style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 600, fontSize: 15, color: COLORS.textPrimary, margin: 0 }}>No leaderboard data available yet</p>
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: COLORS.textSecondary, marginTop: 6 }}>
          Check back once more hosts have completed rides in {MONTH_NAMES[month]} {year}.
        </p>
      </div>
    );
  }

  // A podium is a claim about first, second and third. With one or two hosts
  // ranked it reads as a broken chart, so the plain ranking list carries the
  // whole board until there is an actual top three.
  const hasPodium = entries.length >= 3;
  const podium = hasPodium ? entries.slice(0, 3) : [];
  const rest = hasPodium ? entries.slice(3) : entries;
  const currentUserEntry = entries.find((e) => e.isCurrentUser);

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <h2 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 700, fontSize: 22, margin: 0, color: COLORS.textPrimary }}>Community Leaderboard</h2>
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: COLORS.textSecondary, margin: '4px 0 0' }}>
          {MONTH_NAMES[month]} {year} · {entries.length} host{entries.length === 1 ? '' : 's'} with a completed trip
        </p>
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: COLORS.textSecondary, margin: '6px 0 0' }}>
          Ranked by Composite Host Impact Score
        </p>
      </div>

      {podium.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 20, marginBottom: 32 }}>
          {podium[1] && <PodiumCard entry={podium[1]} height={84} rank={2} />}
          {podium[0] && <PodiumCard entry={podium[0]} height={116} rank={1} highlight />}
          {podium[2] && <PodiumCard entry={podium[2]} height={64} rank={3} />}
        </div>
      )}

      <div>
        {rest.map((entry) => (
          <LeaderboardRow key={entry.id} entry={entry} />
        ))}
      </div>

      {/* Only pin the viewer's row when a podium pushed it out of the list's
          natural reading order - without one the list already holds everyone. */}
      {hasPodium && currentUserEntry && currentUserEntry.rank > 3 && (
        <div style={{ marginTop: 16, position: 'sticky', bottom: 0 }}>
          <LeaderboardRow entry={currentUserEntry} />
        </div>
      )}
    </div>
  );
}

function PodiumCard({ entry, height, highlight, rank }) {
  const tierColor = TIER_COLORS[entry.badge?.name] || COLORS.textSecondary;
  const rankBadgeColor = rank === 1 ? '#EAB308' : rank === 2 ? '#9CA3AF' : '#CD7F32';
  return (
    <div style={{ textAlign: 'center', width: 128 }}>
      <div style={{ position: 'relative', display: 'inline-block' }}>
        <div className="m5-podium-avatar" style={{ background: gradientFor(entry.name) }}>
          {entry.name?.[0] || '?'}
        </div>
        <span
          style={{
            position: 'absolute',
            bottom: 4,
            right: -2,
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: rankBadgeColor,
            color: '#FFFFFF',
            fontSize: 11,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '2px solid #FFFFFF'
          }}
        >
          {rank}
        </span>
      </div>
      <p style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 600, fontSize: 13, margin: '4px 0 0', color: COLORS.textPrimary }}>{entry.name}</p>
      <p style={{ fontSize: 11, color: tierColor, fontWeight: 700, margin: '2px 0 8px' }}>{entry.badge?.name}</p>
      <div
        className="m5-podium-bar"
        style={{
          height,
          background: highlight ? `linear-gradient(180deg, ${COLORS.primary}, ${COLORS.primaryDark})` : COLORS.primaryTint,
          boxShadow: highlight ? '0px 4px 16px rgba(22,163,74,0.28)' : 'none'
        }}
      >
        {highlight && <IconTrophySmall size={22} color="#fff" />}
      </div>
      <p style={{ fontSize: 13, fontWeight: 700, color: COLORS.textPrimary, marginTop: 8 }}>{entry.compositeScore} pts</p>
    </div>
  );
}

function LeaderboardRow({ entry }) {
  const tierColor = TIER_COLORS[entry.badge?.name] || COLORS.textSecondary;
  return (
    <div
      className="m5-card m5-row"
      style={{
        padding: '12px 16px',
        background: entry.isCurrentUser ? COLORS.primaryTint : COLORS.surface,
        borderColor: entry.isCurrentUser ? COLORS.primary : COLORS.border
      }}
    >
      <span style={{ width: 24, textAlign: 'center', fontFamily: 'Poppins, sans-serif', fontWeight: 700, color: COLORS.textSecondary }}>{entry.rank}</span>
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: gradientFor(entry.name),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'Poppins, sans-serif',
          fontWeight: 700,
          fontSize: 14,
          color: '#FFFFFF',
          flexShrink: 0
        }}
      >
        {entry.name?.[0] || '?'}
      </div>
      <div style={{ flex: 1 }}>
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: 700, margin: 0, color: COLORS.textPrimary }}>
          {entry.name} {entry.isCurrentUser && <span style={{ color: COLORS.primaryDark, fontSize: 12, fontWeight: 600 }}>(You)</span>}
        </p>
        <p style={{ fontSize: 11, color: tierColor, margin: '2px 0 0', fontWeight: 600 }}>{entry.badge?.name}</p>
      </div>
      <span style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 700, fontSize: 14, color: COLORS.textPrimary }}>{entry.compositeScore} pts</span>
    </div>
  );
}