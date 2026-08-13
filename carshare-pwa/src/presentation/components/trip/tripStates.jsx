// ===== PRESENTATION LAYER (Module 5 shared states) =====
// docs/ai/UI.md requires every screen to cover loading, empty, error, and
// offline. All five Module 5 screens load through TripHistoryEngine and need
// the same failure treatment, so the error/not-found surfaces live here
// instead of being copied into each one.
import React from 'react';
import { COLORS } from './tripTheme.js';
import { IconAlertSmall } from './tripIcons.jsx';

function StateCard({ tone, icon, title, message, action }) {
  return (
    <div className="m5-card m5-empty" role="status">
      <span className="m5-icon-circle" style={{ background: tone.bg, color: tone.fg }}>
        {icon}
      </span>
      <p
        style={{
          fontFamily: 'Poppins, sans-serif',
          fontWeight: 600,
          fontSize: 16,
          color: COLORS.textPrimary,
          margin: 0
        }}
      >
        {title}
      </p>
      <p style={{ fontSize: 14, marginTop: 6, maxWidth: 360, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6 }}>
        {message}
      </p>
      {action}
    </div>
  );
}

// UI.md: "Do not use dummy success content to hide an unavailable service."
// State plainly what failed and offer a way back.
export function ErrorState({ message, onRetry }) {
  return (
    <StateCard
      tone={{ bg: '#FEE2E2', fg: COLORS.error }}
      icon={<IconAlertSmall size={20} />}
      title="We couldn't load this"
      message={message || 'Something went wrong on our side. Check your connection and try again.'}
      action={
        onRetry ? (
          <button
            onClick={onRetry}
            className="m5-chip"
            style={{
              marginTop: 16,
              padding: '10px 20px',
              minHeight: 44,
              borderColor: COLORS.primary,
              color: COLORS.primaryDark,
              fontWeight: 600
            }}
          >
            Try again
          </button>
        ) : null
      }
    />
  );
}

// UC5.3 A1 / M1: "Trip not found." Also shown when the signed-in user is not a
// participant, so the screen never confirms that someone else's trip exists.
export function NotFoundState({ onBack }) {
  return (
    <StateCard
      tone={{ bg: COLORS.bg, fg: COLORS.textSecondary }}
      icon={<IconAlertSmall size={20} />}
      title="Trip not found."
      message="This trip either no longer exists or isn't one you hosted or joined."
      action={
        onBack ? (
          <button
            onClick={onBack}
            className="m5-chip"
            style={{
              marginTop: 16,
              padding: '10px 20px',
              minHeight: 44,
              borderColor: COLORS.primary,
              color: COLORS.primaryDark,
              fontWeight: 600
            }}
          >
            Back to my trips
          </button>
        ) : null
      }
    />
  );
}
