// ===== PRESENTATION LAYER (AchievementGrid) =====
// Module 5 - milestone wall on the Impact dashboard. Locked milestones stay
// visible with their progress: docs/ai/UI.md asks for honest empty states, and
// "7 of 10 passengers" tells a new user what the module is for far better than
// an empty grid does.
import React from 'react';
import { COLORS } from './tripTheme.js';

const TONES = {
  primary: { fg: COLORS.primaryDark, bg: COLORS.primaryTint, bar: COLORS.primary },
  teal: { fg: '#0F766E', bg: COLORS.tealTint, bar: COLORS.teal },
  gold: { fg: '#A16207', bg: '#FEF9C3', bar: '#EAB308' }
};

export default function AchievementGrid({ achievements }) {
  const { milestones, earnedCount, total, nextUp } = achievements;

  return (
    <div className="m5-card" style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
        <h3 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 600, fontSize: 15, margin: 0, color: COLORS.textPrimary }}>
          Milestones
        </h3>
        <span style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 700, fontSize: 14, color: COLORS.primaryDark }}>
          {earnedCount} / {total}
        </span>
      </div>

      <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, color: COLORS.textSecondary, margin: '0 0 18px' }}>
        {nextUp
          ? `Next up: ${nextUp.name} - ${Math.round(nextUp.current)} of ${nextUp.target} ${nextUp.targetLabel}.`
          : 'Every milestone earned. Nicely done.'}
      </p>

      <div className="m5-badge-grid">
        {milestones.map((milestone) => (
          <Badge key={milestone.id} milestone={milestone} />
        ))}
      </div>
    </div>
  );
}

function Badge({ milestone }) {
  const tone = TONES[milestone.tone] || TONES.primary;
  const { earned } = milestone;

  return (
    <div
      className={'m5-badge' + (earned ? ' earned' : '')}
      style={{ borderColor: earned ? tone.bar : COLORS.border }}
      title={milestone.description}
    >
      <span
        className="m5-badge-icon"
        style={{
          background: earned ? tone.bg : '#F3F4F6',
          // A locked milestone still shows its symbol, just drained of colour,
          // so the grid reads as "not yet" rather than "unavailable".
          filter: earned ? 'none' : 'grayscale(1)',
          opacity: earned ? 1 : 0.55
        }}
        aria-hidden="true"
      >
        {milestone.icon}
      </span>

      <p
        style={{
          fontFamily: 'Poppins, sans-serif',
          fontWeight: 600,
          fontSize: 12,
          margin: '8px 0 0',
          color: earned ? COLORS.textPrimary : COLORS.textSecondary
        }}
      >
        {milestone.name}
      </p>

      {earned ? (
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 700, color: tone.fg, margin: '3px 0 0' }}>
          Earned
        </p>
      ) : (
        <>
          <div className="m5-badge-track" aria-hidden="true">
            <span style={{ width: `${Math.round(milestone.ratio * 100)}%`, background: tone.bar }} />
          </div>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, color: COLORS.textSecondary, margin: '4px 0 0' }}>
            {Math.round(milestone.current)} / {milestone.target} {milestone.targetLabel}
          </p>
        </>
      )}
    </div>
  );
}
