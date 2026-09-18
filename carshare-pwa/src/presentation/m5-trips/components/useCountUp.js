// ===== PRESENTATION LAYER (useCountUp) =====
// Counts a score up from zero when the podium first draws, so the reveal lands
// with the plinth instead of the final figure being there before it rises.
//
// Same technique as the car on the auth page: requestAnimationFrame with an
// eased progress, rather than a timer stepping fixed increments.
import { useEffect, useRef, useState } from 'react';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export default function useCountUp(target, { duration = 900, delay = 0, decimals = 1 } = {}) {
  const [value, setValue] = useState(target);
  const frame = useRef(null);

  useEffect(() => {
    if (typeof target !== 'number' || Number.isNaN(target)) return undefined;
    // Someone who has asked for less motion gets the number, not the journey.
    if (prefersReducedMotion()) {
      setValue(target);
      return undefined;
    }

    // A hidden document does not run animation frames. Zeroing the value up
    // front would then leave a real score reading "0 pts" for as long as the
    // tab stays in the background - a wrong number is worse than no animation,
    // so the figure is only lowered once a frame actually arrives.
    if (document.hidden) {
      setValue(target);
      return undefined;
    }

    const startedAt = performance.now() + delay;

    function tick(now) {
      const elapsed = now - startedAt;
      if (elapsed < 0) {
        setValue(0);
        frame.current = requestAnimationFrame(tick);
        return;
      }
      const linear = Math.min(1, elapsed / duration);
      // Ease out: fast at first, settling onto the final figure.
      const eased = 1 - Math.pow(1 - linear, 3);
      setValue(Number((target * eased).toFixed(decimals)));
      if (linear < 1) frame.current = requestAnimationFrame(tick);
    }

    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [target, duration, delay, decimals]);

  return value;
}
