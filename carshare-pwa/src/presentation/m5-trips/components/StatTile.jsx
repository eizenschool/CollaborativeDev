// ===== PRESENTATION LAYER (StatTile) =====
// One figure, presented the same way on every screen in this module.
//
// History, Impact and Monthly Report each had their own version: 22px, 30px and
// 24px values, one styled by class, one by class plus inline overrides, one
// entirely inline. Three treatments for the same idea is what made moving
// between the tabs feel like moving between three products.
//
// `accent` marks the headline figure of a group - typically the CO₂ saved - so
// each screen has exactly one tile that draws the eye.
//
// A numeric `value` counts up from zero on arrival. That is not decoration:
// this module is about a total that accumulated over months, and watching it
// climb says so more directly than the finished number sitting there. Pass a
// string instead and it renders as-is. `delay` staggers a row of tiles.
import React from 'react';
import useCountUp from './useCountUp.js';

export default function StatTile({ icon = null, value, unit = null, label, accent = false, delay = 0 }) {
  const isNumber = typeof value === 'number' && Number.isFinite(value);
  // Carbon arrives as 40.8, counts as 12.7. Trips arrive as 3 and must never
  // count as 1.4, so the precision follows the figure rather than the caller.
  const decimals = isNumber && !Number.isInteger(value) ? 1 : 0;
  const counted = useCountUp(isNumber ? value : null, { duration: 850, delay, decimals });
  const shown = isNumber ? counted : value;

  return (
    <div className={'m5-stat' + (accent ? ' accent' : '')} style={{ '--m5-delay': `${delay}ms` }}>
      {icon && <span className="m5-stat-icon" aria-hidden="true">{icon}</span>}
      <p className="m5-stat-value">{unit ? `${shown} ${unit}` : shown}</p>
      <p className="m5-stat-label">{label}</p>
    </div>
  );
}
