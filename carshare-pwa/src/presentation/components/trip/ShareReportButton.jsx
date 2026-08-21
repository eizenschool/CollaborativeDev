// ===== PRESENTATION LAYER (ShareReportButton) =====
// Module 5 - the entry point to the monthly card's export panel. The button
// stays here so MonthlyReport does not need to know about dialog state; the
// panel itself lives in ShareReportDialog.jsx.
import React, { useState } from 'react';
import { buildShareContent } from '../../../business-logic/TripShareCard.js';
import ShareReportDialog from './ShareReportDialog.jsx';
import { COLORS } from './tripTheme.js';

export default function ShareReportButton({ report, userName }) {
  const [open, setOpen] = useState(false);

  // A month with no completed trips has nothing to put on a card.
  const content = buildShareContent(report, { userName });
  if (!content) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{
          width: '100%',
          minHeight: 48,
          marginBottom: 20,
          borderRadius: 12,
          border: 'none',
          cursor: 'pointer',
          background: `linear-gradient(135deg, ${COLORS.primary} 0%, ${COLORS.teal} 100%)`,
          color: '#FFFFFF',
          fontFamily: 'Poppins, sans-serif',
          fontWeight: 600,
          fontSize: 15,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          boxShadow: '0px 4px 14px rgba(22,163,74,0.28)'
        }}
      >
        <span aria-hidden="true">📤</span>
        Share this month
      </button>

      {open && <ShareReportDialog content={content} onClose={() => setOpen(false)} />}
    </>
  );
}
