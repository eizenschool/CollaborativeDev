// ===== PRESENTATION LAYER (VerificationDemoConsole) =====
// Fast-forwards Module 6's shared demo clock so a reviewer can see UC6.5's
// 15-minute no-show window and UC6.22's 48-hour default confirmation resolve live,
// without actually waiting. `onAdvanced` lets the parent screen re-run whatever
// check (checkNoShow / applyDefaultConfirmations) should react to the new time.
import { useEffect, useState } from 'react';
import { DemoClockService } from '../../../business-logic/verification/DemoClockService.js';
import { IconBolt } from '../icons.jsx';

const MINUTE_MS = 60000;
const HOUR_MS = 3600000;

function formatOffset(ms) {
  if (!ms) return 'No time advanced yet';
  const hours = Math.floor(ms / HOUR_MS);
  const minutes = Math.round((ms % HOUR_MS) / MINUTE_MS);
  const parts = [];
  if (hours) parts.push(`${hours}h`);
  if (minutes || !hours) parts.push(`${minutes}m`);
  return `Clock advanced by ${parts.join(' ')}`;
}

export default function VerificationDemoConsole({ onAdvanced }) {
  const [offsetMs, setOffsetMs] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    DemoClockService.getOffsetMs().then(setOffsetMs);
  }, []);

  async function advance(ms) {
    setError('');
    try {
      const next = await DemoClockService.advanceBy(ms);
      setOffsetMs(next);
      await onAdvanced?.();
    } catch (err) {
      setError(err.message);
    }
  }

  async function reset() {
    setError('');
    try {
      const next = await DemoClockService.reset();
      setOffsetMs(next);
      await onAdvanced?.();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="demo-clock-card">
      <div className="demo-clock-head"><IconBolt size={14} /> Demo clock</div>
      <div className="demo-clock-offset">{formatOffset(offsetMs)}</div>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="demo-clock-row">
        <button type="button" onClick={() => advance(16 * MINUTE_MS)}>+16 min (no-show)</button>
        <button type="button" onClick={() => advance(49 * HOUR_MS)}>+49 hrs (default)</button>
      </div>
      <button type="button" className="demo-clock-reset" onClick={reset}>Reset clock</button>
    </div>
  );
}
