// ===== PRESENTATION LAYER (TripTimelineCard) =====
// Module 5 - the one screen in the app that shows a trip's whole story.
// Every instant comes from Module 2's own records; TripTimeline decides the
// order and which steps have happened.
import React from 'react';
import { STEP_STATE, timelineProgress } from '../../../business-logic/TripTimeline.js';
import { COLORS } from './tripTheme.js';

const TONE = {
  [STEP_STATE.DONE]: { dot: COLORS.primary, ring: COLORS.primaryTint, text: COLORS.textPrimary },
  [STEP_STATE.DUE]: { dot: COLORS.warning, ring: '#FEF3C7', text: COLORS.textPrimary },
  [STEP_STATE.UPCOMING]: { dot: COLORS.border, ring: 'transparent', text: COLORS.textSecondary },
  [STEP_STATE.SKIPPED]: { dot: COLORS.border, ring: 'transparent', text: COLORS.textSecondary }
};

// Module 2 stores instants in UTC; the rest of the module shows
// Asia/Kuala_Lumpur, so the timeline must too.
const FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kuala_Lumpur',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});

function formatInstant(at) {
  if (!at) return null;
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? null : FORMAT.format(date);
}

export default function TripTimelineCard({ timeline }) {
  if (!timeline || timeline.length === 0) return null;
  const { done, total } = timelineProgress(timeline);

  return (
    <div className="m5-card" style={{ padding: 20, marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
        <h3 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 600, fontSize: 15, margin: 0, color: COLORS.textPrimary }}>
          Trip timeline
        </h3>
        <span style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 700, fontSize: 13, color: COLORS.primaryDark }}>
          {done} / {total}
        </span>
      </div>
      <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: COLORS.textSecondary, margin: '0 0 16px' }}>
        Recorded by Module 2 as the trip progressed.
      </p>

      <ol className="m5-timeline">
        {timeline.map((item, index) => {
          const tone = TONE[item.state] || TONE[STEP_STATE.UPCOMING];
          const when = formatInstant(item.at);
          return (
            <li key={item.id} className="m5-timeline-step">
              <span className="m5-timeline-marker" aria-hidden="true">
                <span
                  className={'m5-timeline-dot' + (item.state === STEP_STATE.DUE ? ' pulsing' : '')}
                  style={{ background: tone.dot, boxShadow: `0 0 0 4px ${tone.ring}` }}
                />
                {index < timeline.length - 1 && (
                  <span
                    className="m5-timeline-line"
                    style={{ background: item.state === STEP_STATE.DONE ? COLORS.primaryTint : COLORS.border }}
                  />
                )}
              </span>

              <div className="m5-timeline-body">
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: item.state === STEP_STATE.DONE ? 600 : 500, color: tone.text, margin: 0 }}>
                  {item.label}
                </p>
                {when && (
                  <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: COLORS.textSecondary, margin: '2px 0 0' }}>
                    {when}
                  </p>
                )}
                {/* An awaited step has no instant, so say what it is waiting on
                    rather than leaving a bare label. */}
                {!when && item.state !== STEP_STATE.DONE && (
                  <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: COLORS.textSecondary, margin: '2px 0 0' }}>
                    {item.state === STEP_STATE.DUE ? 'Awaiting confirmation' : 'Not yet'}
                  </p>
                )}
                {item.detail && (
                  <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: COLORS.textSecondary, margin: '4px 0 0', lineHeight: 1.5 }}>
                    {item.detail}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
