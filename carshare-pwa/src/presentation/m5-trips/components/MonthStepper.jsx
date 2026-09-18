// ===== PRESENTATION LAYER (MonthStepper) =====
// Module 5 - the month control shared by Monthly Report, History and the
// Leaderboard. It started as one screen's inline markup; three screens stepping
// through months should not each own a copy of the arrows, the bounds and the
// labels.
import React from 'react';
import { IconChevronLeftSmall, IconChevronRightSmall } from './tripIcons.jsx';
import { COLORS } from './tripTheme.js';

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const monthIndex = (year, month) => year * 12 + month;

export function shiftMonth(year, month, delta) {
  const total = monthIndex(year, month) + delta;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

/**
 * @param earliest  optional { year, month } floor - stops the user paging back
 *                  through months that could never hold anything.
 * @param latest    optional ceiling; defaults to the current month, because a
 *                  month that has not happened has nothing to report.
 * @param trailing  rendered after the arrows (e.g. an "All time" toggle).
 */
export default function MonthStepper({ year, month, onChange, earliest = null, latest = null, label, trailing = null }) {
  const now = new Date();
  const ceiling = latest || { year: now.getFullYear(), month: now.getMonth() };

  const current = monthIndex(year, month);
  const canGoBack = !earliest || current > monthIndex(earliest.year, earliest.month);
  const canGoForward = current < monthIndex(ceiling.year, ceiling.month);

  const step = (delta) => {
    const next = shiftMonth(year, month, delta);
    onChange(next.year, next.month);
  };

  return (
    <div className="m5-month-stepper">
      <button
        className="m5-icon-btn"
        onClick={() => step(-1)}
        disabled={!canGoBack}
        aria-label="Previous month"
        style={{ opacity: canGoBack ? 1 : 0.4, cursor: canGoBack ? 'pointer' : 'not-allowed' }}
      >
        <IconChevronLeftSmall size={18} />
      </button>

      <p className="m5-month-label" aria-live="polite">
        {label || `${MONTH_NAMES[month]} ${year}`}
      </p>

      <button
        className="m5-icon-btn"
        onClick={() => step(1)}
        disabled={!canGoForward}
        aria-label="Next month"
        style={{ opacity: canGoForward ? 1 : 0.4, cursor: canGoForward ? 'pointer' : 'not-allowed' }}
      >
        <IconChevronRightSmall size={18} />
      </button>

      {trailing && <div style={{ marginLeft: 8, color: COLORS.textSecondary }}>{trailing}</div>}
    </div>
  );
}
