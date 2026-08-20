// ===== PRESENTATION LAYER (ImpactEntryCard) =====
// Module 5's entry point, rendered by Module 1's profile overview.
//
// It lives here rather than inside MyProfile so this module owns how it is
// described and what it loads; Module 1 only has to place it. The previous
// version was a static link that described the feature - "View CO₂ saved, ride
// history & monthly leaderboard" - which says what the screen contains but
// gives no reason to open it. Showing the actual figures is the reason.
import React, { useEffect, useState } from 'react';
import { TripHistoryEngine } from '../../../business-logic/TripHistoryEngine.js';
import { IconLeafSmall } from './tripIcons.jsx';
import './tripStyles.css';

export default function ImpactEntryCard({ userId, onOpen }) {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    let active = true;
    if (!userId) return;

    (async () => {
      const summary = await TripHistoryEngine.getImpactSummary(userId);
      // The leaderboard is unavailable on some backends; a missing rank should
      // cost the rank, not the whole card.
      const rank = await TripHistoryEngine.getLeaderboard(userId)
        .then((board) => board.entries.find((entry) => entry.isCurrentUser)?.rank ?? null)
        .catch(() => null);

      if (active) {
        setStats({
          carbonKg: summary.totalCarbonSavedKg,
          trips: summary.completedTrips,
          milestones: summary.achievements
            ? `${summary.achievements.earnedCount}/${summary.achievements.total}`
            : null,
          rank
        });
      }
    })().catch(() => {
      // A failed read must not remove the way into the module.
      if (active) setStats({ carbonKg: null, trips: null, milestones: null, rank: null });
    });

    return () => { active = false; };
  }, [userId]);

  // Dashes while loading, so the card keeps its height instead of jumping.
  const show = (value, suffix = '') => (value === null || value === undefined ? '—' : `${value}${suffix}`);

  return (
    <button className="m5-entry" onClick={onOpen} type="button">
      <span className="m5-entry-top">
        <span className="m5-entry-icon"><IconLeafSmall size={22} /></span>
        <span className="m5-entry-title">
          My Impact &amp; Trip History
          <span className="m5-entry-tag">Eco</span>
        </span>
        <svg className="m5-entry-chevron" width="20" height="20" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 18l6-6-6-6" />
        </svg>
      </span>

      <span className="m5-entry-stats">
        <span className="m5-entry-stat">
          <span className="m5-entry-value">{show(stats?.carbonKg, ' kg')}</span>
          <span className="m5-entry-label">CO₂ saved</span>
        </span>
        <span className="m5-entry-stat">
          <span className="m5-entry-value">{show(stats?.trips)}</span>
          <span className="m5-entry-label">completed trips</span>
        </span>
        {/* Rank and milestones are each shown only when they exist, so the row
            never carries a placeholder for something this backend cannot give. */}
        {stats?.rank != null && (
          <span className="m5-entry-stat">
            <span className="m5-entry-value">#{stats.rank}</span>
            <span className="m5-entry-label">on the leaderboard</span>
          </span>
        )}
        {stats?.milestones && (
          <span className="m5-entry-stat">
            <span className="m5-entry-value">{stats.milestones}</span>
            <span className="m5-entry-label">milestones</span>
          </span>
        )}
      </span>
    </button>
  );
}
