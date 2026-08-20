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
import React from 'react';

export default function StatTile({ icon = null, value, label, accent = false }) {
  return (
    <div className={'m5-stat' + (accent ? ' accent' : '')}>
      {icon && <span className="m5-stat-icon" aria-hidden="true">{icon}</span>}
      <p className="m5-stat-value">{value}</p>
      <p className="m5-stat-label">{label}</p>
    </div>
  );
}
